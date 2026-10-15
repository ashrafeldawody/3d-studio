import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { Diagnostic, linter, lintGutter, setDiagnostics } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import type { RenderMessage } from '@shared/types'
import { scadHighlight, scadLanguage } from '../lib/scadLanguage'

interface Props {
  value: string
  onChange(value: string): void
  onSave(): void
  onRender(): void
  errors: RenderMessage[]
  warnings: RenderMessage[]
}

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: '#15171a', color: '#e6edf3' },
    '.cm-content': { fontFamily: 'Cascadia Code, Consolas, monospace', caretColor: '#f39200' },
    '.cm-gutters': { backgroundColor: '#15171a', color: '#545d68', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#1f2328' },
    '.cm-activeLineGutter': { backgroundColor: '#1f2328' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#2d4a6b !important' },
    '.cm-cursor': { borderLeftColor: '#f39200' }
  },
  { dark: true }
)

export function CodeEditor({ value, onChange, onSave, onRender, errors, warnings }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave, onRender })
  callbacks.current = { onChange, onSave, onRender }

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentUnit.of('    '),
        scadLanguage,
        scadHighlight,
        lintGutter(),
        linter(() => [], { delay: 1e9 }),
        theme,
        keymap.of([
          { key: 'Mod-s', run: () => (callbacks.current.onSave(), true) },
          { key: 'Mod-Enter', run: () => (callbacks.current.onRender(), true) },
          { key: 'F5', run: () => (callbacks.current.onRender(), true) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
        })
      ]
    })
    view.current = new EditorView({ state, parent: host.current! })
    return () => view.current?.destroy()
  }, [])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const current = editor.state.doc.toString()
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const doc = editor.state.doc
    const toDiagnostic = (message: RenderMessage, severity: 'error' | 'warning'): Diagnostic | null => {
      if (!message.line || message.line < 1 || message.line > doc.lines) return null
      const line = doc.line(message.line)
      return { from: line.from, to: line.to, severity, message: message.text }
    }
    const diagnostics = [
      ...errors.map((message) => toDiagnostic(message, 'error')),
      ...warnings.map((message) => toDiagnostic(message, 'warning'))
    ].filter((item): item is Diagnostic => item !== null)
    editor.dispatch(setDiagnostics(editor.state, diagnostics))
  }, [errors, warnings, value])

  return <div className="code-editor" ref={host} />
}
