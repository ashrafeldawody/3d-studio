export interface PrinterPreset {
  name: string
  size: [number, number, number]
}

export const PRINTER_PRESETS: PrinterPreset[] = [
  { name: 'Snapmaker U1', size: [270, 270, 270] },
  { name: 'Snapmaker J1 / J1s', size: [300, 200, 200] },
  { name: 'Snapmaker Artisan', size: [400, 400, 400] },
  { name: 'Bambu Lab A1', size: [256, 256, 256] },
  { name: 'Bambu Lab A1 mini', size: [180, 180, 180] },
  { name: 'Bambu Lab P1S / P1P / X1C', size: [256, 256, 256] },
  { name: 'Bambu Lab H2D', size: [325, 320, 325] },
  { name: 'Prusa MK4 / MK4S / Core One', size: [250, 210, 220] },
  { name: 'Prusa MINI+', size: [180, 180, 180] },
  { name: 'Prusa XL', size: [360, 360, 360] },
  { name: 'Creality Ender-3 V3', size: [220, 220, 250] },
  { name: 'Creality K1 / K1C', size: [220, 220, 250] },
  { name: 'Creality K1 Max', size: [300, 300, 300] },
  { name: 'Creality K2 Plus', size: [350, 350, 350] },
  { name: 'Elegoo Neptune 4 / 4 Pro', size: [225, 225, 265] },
  { name: 'Anycubic Kobra 3', size: [250, 250, 260] },
  { name: 'Voron 2.4 (350)', size: [350, 350, 340] }
]

export function plateFitProblem(size: [number, number, number], plate: [number, number, number]): string | null {
  const [width, depth, height] = size
  const [plateX, plateY, plateZ] = plate
  const fitsFlat = (width <= plateX && depth <= plateY) || (width <= plateY && depth <= plateX)
  if (fitsFlat && height <= plateZ) return null
  const over: string[] = []
  if (!fitsFlat) over.push(`${Math.round(Math.max(width, depth))} mm wide`)
  if (height > plateZ) over.push(`${Math.round(height)} mm tall`)
  return `Too big for the ${plateX} x ${plateY} x ${plateZ} mm build plate (${over.join(', ')})`
}
