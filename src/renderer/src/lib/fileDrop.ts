import { useEffect, useRef, useState } from 'react'

const isImageType = (type: string): boolean => type.startsWith('image/') && type !== 'image/svg+xml'

const carriesFiles = (event: DragEvent): boolean => Boolean(event.dataTransfer?.types.includes('Files'))

const onlyImages = (event: DragEvent): boolean => {
  const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file')
  return items.length > 0 && items.every((item) => isImageType(item.type))
}

const overChat = (event: DragEvent): boolean => Boolean((event.target as Element | null)?.closest?.('[data-chat-drop]'))

export function useFileDrop(onOpen: (paths: string[]) => void, onHint: (text: string) => void): boolean {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const handlers = useRef({ onOpen, onHint })
  handlers.current = { onOpen, onHint }

  useEffect(() => {
    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth.current++
      if (!onlyImages(event) && !overChat(event)) setActive(true)
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setActive(!onlyImages(event) && !overChat(event))
    }
    const onDrop = (event: DragEvent): void => {
      depth.current = 0
      setActive(false)
      if (!carriesFiles(event) || event.defaultPrevented) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      const files = [...(event.dataTransfer?.files ?? [])]
      const models = files.filter((file) => !isImageType(file.type))
      if (!models.length) {
        if (files.length) handlers.current.onHint('To show the AI a photo, drop it into the chat box.')
        return
      }
      const paths = models.map((file) => window.studio.project.pathForFile(file)).filter(Boolean)
      if (paths.length) handlers.current.onOpen(paths)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return active
}
