import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const KEYWORDS = new Set(['module', 'function', 'if', 'else', 'for', 'let', 'each', 'include', 'use', 'true', 'false', 'undef', 'intersection_for', 'assert', 'echo'])
const BUILTINS = new Set([
  'cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text', 'import', 'surface', 'projection',
  'translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color', 'offset', 'hull', 'minkowski', 'resize',
  'union', 'difference', 'intersection', 'linear_extrude', 'rotate_extrude', 'render', 'children',
  'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'floor', 'round', 'ceil', 'ln', 'log', 'pow',
  'sqrt', 'exp', 'min', 'max', 'norm', 'cross', 'len', 'concat', 'lookup', 'str', 'chr', 'ord', 'search', 'rands',
  'version', 'version_num', 'parent_module', 'is_undef', 'is_bool', 'is_num', 'is_string', 'is_list', 'is_function'
])

interface State {
  inComment: boolean
}

export const scadLanguage = StreamLanguage.define<State>({
  name: 'openscad',
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.next()
        stream.next()
        state.inComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      return 'comment'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)) return 'number'
    if (stream.match(/^\$[A-Za-z_]\w*/)) return 'atom'
    const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null
    if (word) {
      if (KEYWORDS.has(word[0])) return 'keyword'
      if (BUILTINS.has(word[0])) return 'builtin'
      return 'variableName'
    }
    if (stream.match(/^[+\-*/%<>=!&|?:^#]+/)) return 'operator'
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } }
})

export const scadHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.comment, color: '#768390', fontStyle: 'italic' },
    { tag: tags.string, color: '#96d0ff' },
    { tag: tags.number, color: '#f69d50' },
    { tag: tags.keyword, color: '#f47067' },
    { tag: tags.standard(tags.variableName), color: '#dcbdfb' },
    { tag: tags.atom, color: '#6cb6ff' },
    { tag: tags.operator, color: '#adbac7' },
    { tag: tags.variableName, color: '#e6edf3' }
  ])
)
