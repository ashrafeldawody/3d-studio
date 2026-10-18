export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'tube' | 'text'

export const SHAPES: { shape: ShapeKind; label: string; icon: string }[] = [
  { shape: 'box', label: 'Box', icon: '▢' },
  { shape: 'cylinder', label: 'Cylinder', icon: '◯' },
  { shape: 'sphere', label: 'Sphere', icon: '●' },
  { shape: 'cone', label: 'Cone', icon: '△' },
  { shape: 'tube', label: 'Tube (ring)', icon: '◎' },
  { shape: 'text', label: 'Text', icon: 'T' }
]
