import type { ChatFile, ChatImage } from '@shared/types'
import { isSvgFile, readImageFile } from './images'

const MAX_FILE_SIZE = 200 * 1024 * 1024

const isPicture = (file: File): boolean => file.type.startsWith('image/') || isSvgFile(file)

async function toChatFile(file: File): Promise<ChatFile> {
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is larger than 200 MB.`)
  const path = window.studio.project.pathForFile(file)
  if (path) return { name: file.name || 'file', size: file.size, path }
  return { name: file.name || 'pasted file', size: file.size, data: new Uint8Array(await file.arrayBuffer()) }
}

export async function readChatFiles(files: File[]): Promise<{ images: ChatImage[]; files: ChatFile[]; errors: string[] }> {
  const errors: string[] = []
  const images: ChatImage[] = []
  const others: ChatFile[] = []
  for (const file of files) {
    try {
      if (isPicture(file)) images.push(await readImageFile(file))
      else others.push(await toChatFile(file))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Could not read ${file.name}`)
    }
  }
  return { images, files: others, errors }
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
