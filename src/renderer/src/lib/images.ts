const THUMBNAIL_SIZE = 220
const MAX_IMAGE_SIZE = 1600

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

async function resized(source: string, limit: number, type: 'image/jpeg' | 'image/png', quality = 0.85): Promise<string> {
  const image = await loadImage(source)
  const scale = Math.min(1, limit / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  const context = canvas.getContext('2d')!
  context.fillStyle = '#1b1e22'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL(type, quality)
}

export const makeThumbnail = (dataUrl: string): Promise<string> => resized(dataUrl, THUMBNAIL_SIZE, 'image/jpeg', 0.75)

export async function prepareImage(name: string, dataUrl: string): Promise<{ name: string; dataUrl: string; thumbnail: string }> {
  const full = await resized(dataUrl, MAX_IMAGE_SIZE, 'image/jpeg', 0.88)
  return { name, dataUrl: full, thumbnail: await makeThumbnail(full) }
}

export function readImageFile(file: File): Promise<{ name: string; dataUrl: string; thumbnail: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => prepareImage(`Photo from the user (${file.name || 'pasted image'})`, reader.result as string).then(resolve, reject)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
