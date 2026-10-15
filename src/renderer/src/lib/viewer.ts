import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { ChatPin, Operation, Vector3, ViewName } from '@shared/types'

export type ViewerMode = 'orbit' | 'measure' | 'pin' | 'draw'
export type BoxGizmoMode = 'translate' | 'scale'

export interface MeasureResult {
  points: THREE.Vector3[]
  distance: number | null
}

export interface PinHit {
  point: Vector3
  normal: Vector3
  screenX: number
  screenY: number
}

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const toVector3 = (vector: THREE.Vector3, digits = 2): Vector3 => [round(vector.x, digits), round(vector.y, digits), round(vector.z, digits)]

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

export class ModelViewer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private gizmo: TransformControls
  private modelRoot = new THREE.Group()
  private mesh: THREE.Mesh | null = null
  private edges: THREE.LineSegments | null = null
  private bed = new THREE.Group()
  private helpers = new THREE.Group()
  private pinsGroup = new THREE.Group()
  private measureGroup = new THREE.Group()
  private measurePoints: THREE.Vector3[] = []
  private frame = 0
  private resizeObserver: ResizeObserver
  private raycaster = new THREE.Raycaster()
  private bedSize: [number, number] = [270, 270]
  private wireframe = false
  private mode: ViewerMode = 'orbit'
  private editing: { operation: Operation; target: THREE.Object3D; start: THREE.Matrix4; startScale: THREE.Vector3; base: THREE.Matrix4 } | null = null
  private boxMode: BoxGizmoMode = 'translate'
  private ops: Operation[] = []
  private pointerDown: { x: number; y: number } | null = null
  clickToPin = false
  onMeasure: ((result: MeasureResult) => void) | null = null
  onPin: ((hit: PinHit) => void) | null = null
  onEditCommit: ((operation: Operation) => void) | null = null

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(0x1b1e22)
    container.appendChild(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(160, -220, 180)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.15
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement)
    this.gizmo.setSize(0.9)
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !(event as unknown as { value: boolean }).value && this.mode !== 'draw'
    })
    this.gizmo.addEventListener('objectChange', () => this.previewEdit())
    this.gizmo.addEventListener('mouseUp', () => this.commitEdit())
    this.scene.add(this.gizmo.getHelper())
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(1, -1.5, 2)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(-1.5, 1, 0.5)
    this.scene.add(fill)
    this.scene.add(this.bed, this.modelRoot, this.helpers, this.pinsGroup, this.measureGroup)
    this.buildBed()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.resize()
    this.loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.gizmo.detach()
    this.gizmo.dispose()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  setBedSize(x: number, y: number): void {
    this.bedSize = [x, y]
    this.buildBed()
  }

  private buildBed(): void {
    this.bed.clear()
    const [x, y] = this.bedSize
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(x, y),
      new THREE.MeshBasicMaterial({ color: 0x23272d, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    )
    plate.position.set(x / 2, y / 2, -0.02)
    this.bed.add(plate)
    const lines: number[] = []
    for (let gx = 0; gx <= x; gx += 10) lines.push(gx, 0, 0, gx, y, 0)
    for (let gy = 0; gy <= y; gy += 10) lines.push(0, gy, 0, x, gy, 0)
    const grid = new THREE.BufferGeometry()
    grid.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    this.bed.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0x343a42 })))
    const axis = (to: [number, number, number], color: number): THREE.Line => {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(...to)])
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }))
    }
    this.bed.add(axis([30, 0, 0], 0xe5534b), axis([0, 30, 0], 0x57ab5a), axis([0, 0, 30], 0x539bf5))
  }

  private resize(): void {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.renderer.setSize(width, height, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  showStl(data: Uint8Array, keepCamera: boolean): void {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const geometry = new STLLoader().parse(buffer)
    geometry.computeVertexNormals()
    const firstModel = !this.mesh
    this.clearModel()
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xf39200, roughness: 0.55, metalness: 0.05, wireframe: this.wireframe })
    )
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), new THREE.LineBasicMaterial({ color: 0x6b3b00 }))
    this.modelRoot.add(this.mesh, this.edges)
    this.modelRoot.position.set(0, 0, 0)
    this.modelRoot.quaternion.identity()
    this.modelRoot.scale.set(1, 1, 1)
    if (!keepCamera || firstModel) this.setView('iso')
    this.rebuildHelpers()
  }

  clearModel(): void {
    for (const object of [this.mesh, this.edges]) {
      if (!object) continue
      this.modelRoot.remove(object)
      object.geometry.dispose()
      ;(object.material as THREE.Material).dispose()
    }
    this.mesh = null
    this.edges = null
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled
    if (this.mesh) (this.mesh.material as THREE.MeshStandardMaterial).wireframe = enabled
  }

  bounds(): THREE.Box3 {
    if (this.mesh) return new THREE.Box3().setFromObject(this.mesh)
    return new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(this.bedSize[0], this.bedSize[1], 20))
  }

  modelCenter(): Vector3 {
    return toVector3(this.bounds().getCenter(new THREE.Vector3()))
  }

  setView(view: ViewName): void {
    const box = this.bounds()
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 5)
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.1
    const directions: Record<ViewName, [number, number, number]> = {
      iso: [0.9, -1.2, 0.9],
      top: [0, -0.0001, 1],
      bottom: [0, 0.0001, -1],
      front: [0, -1, 0],
      back: [0, 1, 0],
      right: [1, 0, 0],
      left: [-1, 0, 0]
    }
    const direction = new THREE.Vector3(...directions[view]).normalize()
    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.near = Math.max(distance / 1000, 0.01)
    this.camera.far = distance * 20
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.controls.update()
  }

  snapshot(): string {
    const gizmoVisible = this.gizmo.getHelper().visible
    this.gizmo.getHelper().visible = false
    this.renderer.render(this.scene, this.camera)
    const dataUrl = this.renderer.domElement.toDataURL('image/png')
    this.gizmo.getHelper().visible = gizmoVisible
    return dataUrl
  }

  capture(view?: ViewName, width = 1024, height = 768): string {
    const savedPosition = this.camera.position.clone()
    const savedTarget = this.controls.target.clone()
    const savedSize = this.renderer.getSize(new THREE.Vector2())
    const savedAspect = this.camera.aspect
    const gizmoVisible = this.gizmo.getHelper().visible
    this.gizmo.getHelper().visible = false
    if (view) this.setView(view)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.scene, this.camera)
    const dataUrl = this.renderer.domElement.toDataURL('image/png')
    this.gizmo.getHelper().visible = gizmoVisible
    this.renderer.setSize(savedSize.x, savedSize.y, false)
    this.camera.aspect = savedAspect
    this.camera.position.copy(savedPosition)
    this.controls.target.copy(savedTarget)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    return dataUrl
  }

  setMode(mode: ViewerMode): void {
    this.mode = mode
    this.controls.enabled = mode !== 'draw'
    this.renderer.domElement.style.cursor = mode === 'measure' || mode === 'pin' ? 'crosshair' : ''
    if (mode !== 'measure') {
      this.measurePoints = []
      this.measureGroup.clear()
    }
  }

  setOperations(ops: Operation[], editId: string | null): void {
    this.ops = ops
    const editOp = ops.find((op) => op.id === editId && op.enabled) ?? null
    const sameTarget = this.editing && editOp && this.editing.operation.id === editOp.id && this.editing.operation.kind === editOp.kind
    if (sameTarget && this.gizmo.dragging) return
    this.rebuildHelpers(editOp)
  }

  setBoxGizmoMode(mode: BoxGizmoMode): void {
    this.boxMode = mode
    if (this.editing && (this.editing.operation.kind === 'addBox' || this.editing.operation.kind === 'removeBox')) this.gizmo.setMode(mode)
  }

  private rebuildHelpers(editOp: Operation | null = this.editing?.operation ?? null): void {
    this.gizmo.detach()
    this.editing = null
    this.helpers.clear()
    const box = this.bounds()
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    for (const operation of this.ops) {
      if (!operation.enabled) continue
      const isEditing = editOp?.id === operation.id
      if (operation.kind === 'cut') {
        const span = Math.max(size.x, size.y, size.z, 20) * 1.4
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(span, span),
          new THREE.MeshBasicMaterial({ color: 0x539bf5, transparent: true, opacity: isEditing ? 0.32 : 0.16, side: THREE.DoubleSide, depthWrite: false })
        )
        if (operation.axis === 'x') {
          plane.rotation.y = Math.PI / 2
          plane.position.set(operation.position, center.y, center.z)
        } else if (operation.axis === 'y') {
          plane.rotation.x = Math.PI / 2
          plane.position.set(center.x, operation.position, center.z)
        } else {
          plane.position.set(center.x, center.y, operation.position)
        }
        this.helpers.add(plane)
        if (isEditing) {
          this.attachGizmo(operation, plane, 'translate')
          this.gizmo.showX = operation.axis === 'x'
          this.gizmo.showY = operation.axis === 'y'
          this.gizmo.showZ = operation.axis === 'z'
        }
      }
      if (operation.kind === 'removeBox' || operation.kind === 'addBox') {
        const min = new THREE.Vector3(...operation.min)
        const max = new THREE.Vector3(...operation.max)
        const low = min.clone().min(max)
        const high = max.clone().max(min)
        const extent = high.clone().sub(low).max(new THREE.Vector3(0.01, 0.01, 0.01))
        const color = operation.kind === 'addBox' ? 0x57ab5a : 0xe5534b
        const solid = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isEditing ? 0.35 : 0.18, depthWrite: false })
        )
        solid.position.copy(low.clone().add(high).multiplyScalar(0.5))
        solid.scale.copy(extent)
        solid.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color })))
        this.helpers.add(solid)
        if (isEditing) this.attachGizmo(operation, solid, this.boxMode)
      }
      if (isEditing && (operation.kind === 'translate' || operation.kind === 'rotate' || operation.kind === 'scale')) {
        const pivot = new THREE.Object3D()
        const pivotPoint = operation.kind === 'translate' ? center : new THREE.Vector3(...(operation.center ?? toVector3(center)))
        pivot.position.copy(pivotPoint)
        this.helpers.add(pivot)
        this.attachGizmo(operation, pivot, operation.kind === 'translate' ? 'translate' : operation.kind)
      }
    }
  }

  private attachGizmo(operation: Operation, target: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale'): void {
    this.gizmo.showX = true
    this.gizmo.showY = true
    this.gizmo.showZ = true
    this.gizmo.setSpace(mode === 'rotate' ? 'local' : 'world')
    this.gizmo.setMode(mode)
    this.gizmo.attach(target)
    target.updateMatrixWorld()
    this.modelRoot.updateMatrix()
    this.editing = { operation, target, start: target.matrixWorld.clone(), startScale: target.scale.clone(), base: this.modelRoot.matrix.clone() }
  }

  private previewEdit(): void {
    const editing = this.editing
    if (!editing) return
    const { operation, target, start, base } = editing
    let change: THREE.Matrix4 | null = null
    if (operation.kind === 'translate') {
      const delta = target.position.clone().sub(new THREE.Vector3().setFromMatrixPosition(start))
      change = new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z)
    }
    if (operation.kind === 'rotate' || operation.kind === 'scale') {
      const pivot = target.position.clone()
      const startRotation = new THREE.Quaternion().setFromRotationMatrix(start)
      const relativeRotation = target.quaternion.clone().multiply(startRotation.invert())
      const relativeScale = target.scale.clone().divide(editing.startScale)
      change = new THREE.Matrix4()
        .makeTranslation(pivot.x, pivot.y, pivot.z)
        .multiply(new THREE.Matrix4().compose(new THREE.Vector3(), relativeRotation, relativeScale))
        .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
    }
    if (!change) return
    change.multiply(base).decompose(this.modelRoot.position, this.modelRoot.quaternion, this.modelRoot.scale)
  }

  private commitEdit(): void {
    const editing = this.editing
    if (!editing || !this.onEditCommit) return
    const { operation, target, start, startScale } = editing
    let next: Operation | null = null
    if (operation.kind === 'translate') {
      const delta = target.position.clone().sub(new THREE.Vector3().setFromMatrixPosition(start))
      next = { ...operation, x: round(operation.x + delta.x), y: round(operation.y + delta.y), z: round(operation.z + delta.z) }
    } else if (operation.kind === 'rotate') {
      const previous = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(operation.x), THREE.MathUtils.degToRad(operation.y), THREE.MathUtils.degToRad(operation.z), 'ZYX')
      )
      const startRotation = new THREE.Quaternion().setFromRotationMatrix(start)
      const relativeRotation = target.quaternion.clone().multiply(startRotation.invert())
      const combined = new THREE.Matrix4().makeRotationFromQuaternion(relativeRotation).multiply(previous)
      const euler = new THREE.Euler().setFromRotationMatrix(combined, 'ZYX')
      next = {
        ...operation,
        center: operation.center ?? toVector3(target.position),
        x: round(THREE.MathUtils.radToDeg(euler.x), 1),
        y: round(THREE.MathUtils.radToDeg(euler.y), 1),
        z: round(THREE.MathUtils.radToDeg(euler.z), 1)
      }
    } else if (operation.kind === 'scale') {
      const factor = target.scale.clone().divide(startScale)
      next = {
        ...operation,
        center: operation.center ?? toVector3(target.position),
        x: round(operation.x * factor.x, 3),
        y: round(operation.y * factor.y, 3),
        z: round(operation.z * factor.z, 3)
      }
    } else if (operation.kind === 'cut') {
      next = { ...operation, position: round(target.position.getComponent(AXIS_INDEX[operation.axis])) }
    } else if (operation.kind === 'addBox' || operation.kind === 'removeBox') {
      const half = target.scale.clone().multiplyScalar(0.5)
      next = {
        ...operation,
        min: toVector3(target.position.clone().sub(half)),
        max: toVector3(target.position.clone().add(half))
      }
    }
    if (next) {
      this.editing = { ...editing, operation: next }
      this.onEditCommit(next)
    }
  }

  setPins(pins: ChatPin[]): void {
    this.pinsGroup.clear()
    const size = this.bounds().getSize(new THREE.Vector3()).length()
    for (const pin of pins) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTexture(pin.id), depthTest: false, sizeAttenuation: false }))
      sprite.scale.set(0.045, 0.045, 1)
      sprite.center.set(0.5, 0)
      sprite.position.set(...pin.point)
      sprite.renderOrder = 20
      this.pinsGroup.add(sprite)
      const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(size / 250, 0.12), 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false }))
      dot.position.set(...pin.point)
      dot.renderOrder = 19
      this.pinsGroup.add(dot)
    }
  }

  private hitModel(event: PointerEvent): THREE.Intersection | null {
    if (!this.mesh) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    return this.raycaster.intersectObject(this.mesh)[0] ?? null
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY }
  }

  private handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown
    this.pointerDown = null
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
    if (this.gizmo.dragging || this.gizmo.axis) return
    if (this.mode === 'measure') this.measureClick(event)
    if (this.mode === 'pin' || (this.mode === 'orbit' && this.clickToPin && !this.editing)) {
      const hit = this.hitModel(event)
      if (!hit) return
      const normal = hit.face ? hit.face.normal.clone().transformDirection(this.mesh!.matrixWorld) : new THREE.Vector3(0, 0, 1)
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.onPin?.({ point: toVector3(hit.point), normal: toVector3(normal), screenX: event.clientX - rect.left, screenY: event.clientY - rect.top })
    }
  }

  private measureClick(event: PointerEvent): void {
    const hit = this.hitModel(event)
    if (!hit) return
    if (this.measurePoints.length >= 2) {
      this.measurePoints = []
      this.measureGroup.clear()
    }
    this.measurePoints.push(hit.point.clone())
    const size = Math.max(this.bounds().getSize(new THREE.Vector3()).length() / 150, 0.15)
    const marker = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }))
    marker.position.copy(hit.point)
    marker.renderOrder = 10
    this.measureGroup.add(marker)
    if (this.measurePoints.length === 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.measurePoints), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }))
      line.renderOrder = 10
      this.measureGroup.add(line)
    }
    this.onMeasure?.({
      points: [...this.measurePoints],
      distance: this.measurePoints.length === 2 ? this.measurePoints[0].distanceTo(this.measurePoints[1]) : null
    })
  }
}

const textureCache = new Map<number, THREE.Texture>()

function pinTexture(id: number): THREE.Texture {
  const cached = textureCache.get(id)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ff3b30'
  context.beginPath()
  context.arc(32, 26, 22, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.moveTo(20, 42)
  context.lineTo(44, 42)
  context.lineTo(32, 63)
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = 'bold 26px Segoe UI, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(String(id), 32, 27)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  textureCache.set(id, texture)
  return texture
}
