/**
 * Motor da receita 3D: desenha cada peça (arroz, feijão, bife...) com three.js
 * e cuida do visualizador (girar, zoom, "ver ingredientes", capa).
 * Só é baixado quando um prato com receita 3D abre — o cardápio em si não carrega 3D.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { partLabel, type PartType, type PlateKind, type Scene, PART_CATALOG } from './types'

/* ============================== helpers ============================== */
type Place = (i: number, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, c: THREE.Color) => void

const C = (h: THREE.ColorRepresentation) => new THREE.Color(h)
const V2 = (x: number, y: number) => new THREE.Vector2(Math.max(x, 0.0001), y)
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function mat(color: THREE.ColorRepresentation, rough = 0.6, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: rough, side: THREE.DoubleSide, ...extra })
}
function rng(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
type Rand = ReturnType<typeof rng>

function colorize(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, c: THREE.Color) => void) {
  const p = geo.attributes.position
  const a = new Float32Array(p.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c)
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3))
}

/** Texturas desenhadas em canvas ficam em cache: o admin reconstrói a cena a cada ajuste. */
const textureCache = new Map<string, THREE.CanvasTexture>()
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const hit = textureCache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.userData.cached = true
  textureCache.set(key, t)
  return t
}

function inst(geo: THREE.BufferGeometry, m: THREE.Material, n: number, place: Place) {
  const im = new THREE.InstancedMesh(geo, m, n)
  const mx = new THREE.Matrix4()
  const p = V3(0, 0, 0)
  const q = new THREE.Quaternion()
  const s = V3(1, 1, 1)
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    p.set(0, 0, 0)
    q.identity()
    s.set(1, 1, 1)
    c.set(0xffffff)
    place(i, p, q, s, c)
    mx.compose(p, q, s)
    im.setMatrixAt(i, mx)
    im.setColorAt(i, c)
  }
  return im
}
const randQ = (q: THREE.Quaternion, r: Rand) => q.setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28))

function domePt(R: number, H: number, r: Rand, maxT = 0.95) {
  const ct = 1 - r() * (1 - Math.cos((maxT * Math.PI) / 2))
  const th = Math.acos(ct)
  const ph = r() * Math.PI * 2
  const x = R * Math.sin(th) * Math.cos(ph)
  const z = R * Math.sin(th) * Math.sin(ph)
  const y = H * ct
  return { p: V3(x, y, z), n: V3(x / (R * R), y / (H * H), z / (R * R)).normalize() }
}
function domeGeo(R: number, H: number, seed = 1, bump = 0.02, seg = 64) {
  const pts = [V2(0, 0)]
  for (let i = 24; i >= 0; i--) {
    const t = ((i / 24) * Math.PI) / 2
    pts.push(V2(R * Math.sin(t), H * Math.cos(t)))
  }
  const g = new THREE.LatheGeometry(pts, seg)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    if (y > 0.004) {
      const k = 1 + bump * (Math.sin(x * 23 + seed) * Math.cos(z * 19 + seed) + 0.5 * Math.sin((x + z) * 41 + seed))
      p.setXYZ(i, x * k, y * k, z * k)
    }
  }
  g.computeVertexNormals()
  return g
}
function leafGeo(L = 0.2, W = 0.085, curl = 0.5) {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.quadraticCurveTo(W, L * 0.42, 0, L)
  s.quadraticCurveTo(-W, L * 0.42, 0, 0)
  const g = new THREE.ShapeGeometry(s, 14)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    p.setZ(i, Math.abs(x) * curl * 0.6 - Math.pow(y / L, 2) * 0.05)
  }
  g.rotateX(-Math.PI / 2)
  g.computeVertexNormals()
  return g
}
const leafMat = () => mat('#3f8a37', 0.45, { clearcoat: 0.4, sheen: 0.5, sheenColor: C('#a8e07a') })
const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group()
  if (children.length) g.add(...children)
  return g
}

/* ============================== louça ============================== */
const PLATE_FLOOR: Record<PlateKind, number> = { raso: 0.06, fundo: 0.065, sobremesa: 0.06 }
const PLATE_RADIUS: Record<PlateKind, number> = { raso: 1.47, fundo: 1.43, sobremesa: 1.2 }

function plate(kind: PlateKind) {
  const pts =
    kind === 'fundo'
      ? [V2(0, 0.03), V2(0.6, 0.03), V2(0.63, 0), V2(0.68, 0), V2(0.72, 0.04), V2(0.96, 0.21), V2(1.3, 0.27), V2(1.42, 0.29), V2(1.43, 0.305), V2(1.28, 0.292), V2(0.93, 0.225), V2(0.7, 0.075), V2(0.62, 0.065), V2(0, 0.065)]
      : [V2(0, 0.03), V2(0.7, 0.03), V2(0.73, 0), V2(0.78, 0), V2(0.82, 0.035), V2(1.3, 0.12), V2(1.46, 0.16), V2(1.47, 0.175), V2(1.33, 0.165), V2(0.98, 0.075), V2(0.92, 0.06), V2(0, 0.06)]
  const dark = kind === 'sobremesa'
  const m = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 96),
    mat(dark ? '#2b2a2e' : '#f6f2ea', dark ? 0.35 : 0.18, { clearcoat: 1, clearcoatRoughness: 0.12 }),
  )
  if (dark) m.scale.set(0.82, 1, 0.82)
  return m
}
function ramekin(R = 0.31, H = 0.18, color = '#8b4a2b') {
  const pts = [V2(0, 0), V2(R * 0.8, 0), V2(R * 0.9, 0.02), V2(R, H * 0.94), V2(R * 1.05, H), V2(R * 1.02, H * 1.06), V2(R * 0.94, H), V2(R * 0.84, H * 0.25), V2(0, H * 0.2)]
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 64), mat(color, 0.4, { clearcoat: 0.6 }))
}
function steelBowl(R: number, H: number) {
  const pts = [V2(0, 0), V2(R * 0.6, 0), V2(R * 0.82, H * 0.35), V2(R * 0.97, H * 0.92), V2(R, H), V2(R * 0.96, H * 0.97), V2(R * 0.8, H * 0.4), V2(R * 0.58, H * 0.07), V2(0, H * 0.07)]
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 72), mat('#dfe3e8', 0.28, { metalness: 0.75, clearcoat: 0.6 }))
}
function placematMesh(w: number, h: number) {
  const s = new THREE.Shape()
  const rr = 0.12
  s.moveTo(-w + rr, -h)
  s.lineTo(w - rr, -h)
  s.quadraticCurveTo(w, -h, w, -h + rr)
  s.lineTo(w, h - rr)
  s.quadraticCurveTo(w, h, w - rr, h)
  s.lineTo(-w + rr, h)
  s.quadraticCurveTo(-w, h, -w, h - rr)
  s.lineTo(-w, -h + rr)
  s.quadraticCurveTo(-w, -h, -w + rr, -h)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 8 })
  geo.rotateX(-Math.PI / 2)
  return new THREE.Mesh(geo, mat('#1c1a19', 0.62, { sheen: 0.4, sheenColor: C('#5a514b') }))
}

/* ============================== peças ============================== */
function rice() {
  const R = 0.37
  const H = 0.21
  const g = group(new THREE.Mesh(domeGeo(R, H, 3, 0.03), mat('#d9ccae', 0.7)))
  const r = rng(21)
  const up = V3(0, 1, 0)
  const q2 = new THREE.Quaternion()
  g.add(
    inst(new THREE.SphereGeometry(0.03, 10, 6), mat(0xffffff, 0.35, { clearcoat: 0.4, sheen: 0.3 }), 420, (_i, p, q, s, c) => {
      const d = domePt(R * 1.01, H * 1.01, r, 0.98)
      p.copy(d.p)
      q.setFromUnitVectors(up, d.n).multiply(q2.setFromAxisAngle(up, r() * 6.28))
      s.set(1.25, 0.42, 0.45)
      c.set('#fffdf6').lerp(C('#ede3cb'), r() * 0.5)
    }),
  )
  return g
}
function beansBowl() {
  const g = group(ramekin(0.31, 0.18, '#7b3f22'))
  const broth = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.02, 48), mat('#3a2016', 0.18, { clearcoat: 1 }))
  broth.position.y = 0.15
  g.add(broth)
  const r = rng(41)
  g.add(
    inst(new THREE.SphereGeometry(0.034, 10, 8), mat(0xffffff, 0.3, { clearcoat: 0.8 }), 46, (_i, p, q, s, c) => {
      const a = r() * 6.28
      const d = Math.sqrt(r()) * 0.24
      p.set(Math.cos(a) * d, 0.155 + r() * 0.012, Math.sin(a) * d)
      randQ(q, r)
      s.set(1.45, 0.8, 0.9)
      c.set('#4d2a1c').lerp(C('#6b3a24'), r())
    }),
  )
  return g
}
function beansPool() {
  const geo = new THREE.CylinderGeometry(0.44, 0.47, 0.035, 64, 1)
  geo.scale(1, 1, 0.86)
  const sauce = new THREE.Mesh(geo, mat('#8c5128', 0.2, { clearcoat: 1, clearcoatRoughness: 0.15 }))
  sauce.position.y = 0.017
  const g = group(sauce)
  const r = rng(57)
  g.add(
    inst(new THREE.SphereGeometry(0.042, 12, 8), mat(0xffffff, 0.28, { clearcoat: 0.9 }), 95, (_i, p, q, s, c) => {
      const a = r() * 6.28
      const d = Math.sqrt(r()) * 0.4
      p.set(Math.cos(a) * d, 0.04 + r() * 0.02 + (1 - d / 0.4) * 0.02, Math.sin(a) * d * 0.84)
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5))
      s.set(1.4, 0.78, 0.92)
      c.set('#b8743f').lerp(C('#87502b'), r())
    }),
  )
  return g
}
function steak() {
  const s = new THREE.Shape()
  const n = 48
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rx = 0.4 * (1 + 0.06 * Math.sin(3 * a + 0.5) + 0.04 * Math.sin(7 * a))
    const rz = 0.26 * (1 + 0.08 * Math.sin(2 * a + 1) + 0.04 * Math.sin(5 * a))
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * rz
    if (i) s.lineTo(x, y)
    else s.moveTo(x, y)
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.03, bevelSegments: 4, curveSegments: 40 })
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    p.setY(i, p.getY(i) + 0.022 + Math.sin(x * 9) * 0.008 + Math.cos(z * 11) * 0.006)
  }
  geo.computeVertexNormals()
  const t = canvasTex('steak', 512, 512, (c, w, h) => {
    const r = rng(61)
    c.fillStyle = '#6e3a20'
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${(120 + r() * 60) | 0},${(55 + r() * 30) | 0},${(25 + r() * 20) | 0},${0.15 + r() * 0.25})`
      c.beginPath()
      c.arc(r() * w, r() * h, 2 + r() * 9, 0, 7)
      c.fill()
    }
    c.save()
    c.translate(w / 2, h / 2)
    c.rotate(-0.55)
    for (let k = -6; k <= 6; k++) {
      const y = k * 42
      const gr = c.createLinearGradient(0, y - 9, 0, y + 9)
      gr.addColorStop(0, 'rgba(30,14,6,0)')
      gr.addColorStop(0.5, 'rgba(30,14,6,.92)')
      gr.addColorStop(1, 'rgba(30,14,6,0)')
      c.fillStyle = gr
      for (let x = -w; x < w; x += 6) c.fillRect(x, y - 9 + Math.sin(x * 0.05 + k) * 2, 7, 18)
    }
    c.restore()
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1.2, 1.2)
  t.offset.set(0.5, 0.5)
  return new THREE.Mesh(geo, [mat(0xffffff, 0.48, { map: t, clearcoat: 0.55, clearcoatRoughness: 0.35 }), mat('#4a2412', 0.55, { clearcoat: 0.4 })])
}
function picanhaSlices() {
  const g = group()
  const fat = C('#f1e2c6')
  const fatG = C('#c98f4e')
  const crust = C('#4e2612')
  const grey = C('#8a5a44')
  const pink = C('#c06a5c')
  const red = C('#a9473f')
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.BoxGeometry(0.5, 0.05, 0.27, 18, 3, 10)
    const p = geo.attributes.position
    for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) + Math.sin(p.getX(k) * 6 + i) * 0.008)
    colorize(geo, (x, y, z, c) => {
      if (z > 0.095) {
        c.copy(fat).lerp(fatG, Math.min(1, (z - 0.095) / 0.04))
        return
      }
      const edge = Math.min(0.25 - Math.abs(x), z + 0.135, 0.1 - z + 0.06)
      if (edge < 0.022 || Math.abs(y) < 0.018) c.copy(crust)
      else if (edge < 0.055) c.copy(crust).lerp(grey, (edge - 0.022) / 0.033)
      else
        c.copy(grey)
          .lerp(pink, Math.min(1, (edge - 0.055) / 0.03))
          .lerp(red, Math.max(0, (edge - 0.09) / 0.06) * 0.5)
    })
    geo.computeVertexNormals()
    const s = new THREE.Mesh(geo, mat(0xffffff, 0.55, { vertexColors: true, clearcoat: 0.35 }))
    s.position.set(0, 0.035 + i * 0.02, i * 0.11 - 0.22)
    s.rotation.x = 0.14
    g.add(s)
  }
  const r = rng(99)
  g.add(
    inst(new THREE.BoxGeometry(0.012, 0.012, 0.012), mat('#ffffff', 0.3, { transmission: 0.4 }), 40, (_i, p, q) => {
      p.set((r() - 0.5) * 0.5, 0.22 + r() * 0.03, (r() - 0.5) * 0.45)
      randQ(q, r)
    }),
  )
  return g
}
function fries() {
  const r = rng(19)
  return inst(new RoundedBoxGeometry(0.085, 0.075, 0.72, 2, 0.02), mat(0xffffff, 0.45, { clearcoat: 0.35 }), 15, (i, p, q, s, c) => {
    p.set((r() - 0.5) * 0.36, 0.05 + i * 0.015, (r() - 0.5) * 0.62)
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.12, 0.55 + (r() - 0.5) * 0.9, (r() - 0.5) * 0.15, 'YXZ'))
    s.set(1, 1, 0.75 + r() * 0.4)
    c.set('#f4b43c').lerp(C('#df8f24'), r() * 0.8)
  })
}
function farofaPile() {
  const r = rng(13)
  return inst(new THREE.BoxGeometry(0.02, 0.016, 0.02), mat(0xffffff, 0.85), 476, (_i, p, q, _s, c) => {
    const a = r() * 6.28
    const d = Math.sqrt(r())
    p.set(Math.cos(a) * d * 0.3, (1 - d * d) * 0.085 * r() + 0.01, Math.sin(a) * d * 0.3 * 0.75)
    randQ(q, r)
    c.set('#e2b465').lerp(C('#a8742f'), r())
  })
}
function vinagrete() {
  const r = rng(23)
  const cols = ['#c9392b', '#c9392b', '#4f8f3a', '#f1ead8']
  return inst(new THREE.BoxGeometry(0.045, 0.04, 0.045), mat(0xffffff, 0.3, { clearcoat: 0.8 }), 55, (i, p, q, _s, c) => {
    const a = r() * 6.28
    const d = Math.sqrt(r()) * 0.16
    p.set(Math.cos(a) * d, (1 - d / 0.16) * 0.06 * r() + 0.02, Math.sin(a) * d)
    randQ(q, r)
    c.set(cols[i % 4])
  })
}
function friedEgg() {
  const s = new THREE.Shape()
  const n = 40
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = 0.3 * (1 + 0.12 * Math.sin(3 * a + 1) + 0.07 * Math.sin(5 * a))
    if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 2, curveSegments: 30 })
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    p.setY(i, p.getY(i) - (x * x + z * z) * 0.9)
  }
  geo.computeVertexNormals()
  const y = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 20), mat('#f4a10c', 0.15, { clearcoat: 1 }))
  y.scale.set(1, 0.55, 1)
  y.position.set(0.03, 0.02, -0.02)
  return group(new THREE.Mesh(geo, mat('#fbfaf4', 0.3, { clearcoat: 0.8 })), y)
}
function pastaNest() {
  const g = group()
  const m = mat('#e3b763', 0.35, { clearcoat: 0.5 })
  const r = rng(5)
  const h = (rr: number) => 0.27 * Math.max(0, 1 - Math.pow(rr / 0.66, 2)) + 0.025
  for (let k = 0; k < 58; k++) {
    const pts: THREE.Vector3[] = []
    const a0 = r() * 6.28
    const turns = 1.1 + r() * 0.9
    const r0 = 0.6 * (0.72 + r() * 0.28)
    const dir = r() > 0.5 ? 1 : -1
    for (let j = 0; j <= 42; j++) {
      const t = j / 42
      const a = a0 + dir * t * turns * 6.28
      const rr = r0 * (1 - t * 0.88) + 0.03
      pts.push(V3(Math.cos(a) * rr, h(rr) + (r() - 0.5) * 0.03 + k * 0.0015, Math.sin(a) * rr))
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 110, 0.015, 5), m))
  }
  return g
}
function ragu() {
  const R = 0.32
  const H = 0.13
  const g = group(new THREE.Mesh(domeGeo(R, H, 7, 0.06), mat('#9e2a17', 0.28, { clearcoat: 1, clearcoatRoughness: 0.2 })))
  const r = rng(77)
  g.add(
    inst(new THREE.IcosahedronGeometry(0.03, 0), mat(0xffffff, 0.5, { clearcoat: 0.6 }), 60, (_i, p, q, s, c) => {
      p.copy(domePt(R, H, r, 0.9).p)
      randQ(q, r)
      s.setScalar(0.7 + r() * 0.8)
      c.set('#5e2a18').lerp(C('#8a3b1f'), r())
    }),
  )
  return g
}
function parmesan() {
  const r = rng(31)
  const yfn = (d: number) => 0.27 * Math.max(0, 1 - Math.pow(d / 0.66, 2)) + 0.05
  return inst(new THREE.BoxGeometry(0.022, 0.01, 0.022), mat(0xffffff, 0.7), 110, (_i, p, q, _s, c) => {
    const a = r() * 6.28
    const d = Math.sqrt(r()) * 0.5
    p.set(Math.cos(a) * d, yfn(d) + r() * 0.02, Math.sin(a) * d)
    randQ(q, r)
    c.set('#f6eed6').lerp(C('#e8d7a6'), r() * 0.6)
  })
}
function basil() {
  const g = group()
  const m = leafMat()
  ;[
    [0, 0.4, 0],
    [2.2, 0.5, 0.18],
    [4.3, 0.45, 0.1],
  ].forEach(([ry, tilt, o], i) => {
    const l = new THREE.Mesh(leafGeo(0.22 - i * 0.02, 0.09, 0.6), m)
    l.rotation.set(-tilt * 0.3, ry, 0)
    l.position.set(Math.cos(ry) * o * 0.3, 0, Math.sin(ry) * o * 0.3)
    g.add(l)
  })
  return g
}
function burrata() {
  const geo = new THREE.SphereGeometry(0.2, 48, 32)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + 0.04 * Math.sin(x * 20) * Math.cos(z * 17)
    p.setXYZ(i, x * k, Math.max(y * 0.8, -0.1), z * k)
  }
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, mat('#fbf9f2', 0.35, { clearcoat: 0.6, sheen: 0.6, sheenColor: C('#fff') }))
}
function risottoBase() {
  const R = 0.78
  const pts = [V2(0, 0), V2(R, 0), V2(R + 0.02, 0.03), V2(R - 0.03, 0.09), V2(R * 0.75, 0.115), V2(0, 0.125)]
  const geo = new THREE.LatheGeometry(pts, 80)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    if (y > 0.02) p.setY(i, y + 0.012 * Math.sin(x * 14) * Math.cos(z * 12))
  }
  geo.computeVertexNormals()
  const g = group(new THREE.Mesh(geo, mat('#eedab0', 0.5, { clearcoat: 0.5 })))
  const r = rng(8)
  const up = V3(0, 1, 0)
  g.add(
    inst(new THREE.SphereGeometry(0.03, 10, 6), mat(0xffffff, 0.3, { clearcoat: 0.6 }), 300, (_i, p2, q, s, c) => {
      const a = r() * 6.28
      const d = Math.sqrt(r()) * 0.74
      p2.set(Math.cos(a) * d, 0.122 + 0.012 * Math.sin(Math.cos(a) * d * 14) * Math.cos(Math.sin(a) * d * 12), Math.sin(a) * d)
      q.setFromAxisAngle(up, r() * 6.28)
      s.set(1.3, 0.42, 0.5)
      c.set('#f7ecd2').lerp(C('#e7d3a8'), r() * 0.6)
    }),
  )
  return g
}
function mushrooms() {
  const g = group()
  const s = new THREE.Shape()
  s.moveTo(0.12, 0)
  s.absarc(0, 0, 0.12, 0, Math.PI, false)
  s.lineTo(-0.045, 0)
  s.lineTo(-0.04, -0.11)
  s.lineTo(0.04, -0.11)
  s.lineTo(0.045, 0)
  s.lineTo(0.12, 0)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2, curveSegments: 20 })
  const mats = [mat('#dcc8a0', 0.6), mat('#6e4628', 0.5, { clearcoat: 0.4 })]
  const r = rng(19)
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(geo, mats)
    const a = r() * 6.28
    const d = 0.1 + r() * 0.42
    m.position.set(Math.cos(a) * d, 0.01 + r() * 0.02, Math.sin(a) * d)
    m.rotation.set(-Math.PI / 2 + (r() - 0.5) * 0.3, 0, r() * 6.28)
    m.scale.setScalar(0.85 + r() * 0.35)
    g.add(m)
  }
  return g
}
function shavings() {
  const g = group()
  const m = mat('#f1e0a8', 0.55)
  const r = rng(29)
  for (let i = 0; i < 6; i++) {
    const geo = new THREE.PlaneGeometry(0.2, 0.11, 8, 3)
    geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    for (let k = 0; k < p.count; k++) p.setY(k, p.getX(k) * p.getX(k) * 1.6)
    geo.computeVertexNormals()
    const sh = new THREE.Mesh(geo, m)
    const a = r() * 6.28
    const d = r() * 0.35
    sh.position.set(Math.cos(a) * d, r() * 0.03, Math.sin(a) * d)
    sh.rotation.y = r() * 6.28
    g.add(sh)
  }
  return g
}
function herbs() {
  const r = rng(61)
  return inst(new THREE.BoxGeometry(0.03, 0.006, 0.022), mat(0xffffff, 0.5), 70, (_i, p, q, _s, c) => {
    const a = r() * 6.28
    const d = Math.sqrt(r()) * 0.6
    p.set(Math.cos(a) * d, r() * 0.02, Math.sin(a) * d)
    randQ(q, r)
    c.set('#3f8a2f').lerp(C('#6cb34a'), r())
  })
}
function truffle() {
  const g = group()
  const r = rng(51)
  const geo = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 24)
  const tex = canvasTex('truffle', 128, 128, (c, w, h) => {
    const t = rng(5)
    c.fillStyle = '#2b201b'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = 'rgba(220,200,180,.35)'
    c.lineWidth = 2
    for (let i = 0; i < 14; i++) {
      c.beginPath()
      c.moveTo(t() * w, t() * h)
      c.bezierCurveTo(t() * w, t() * h, t() * w, t() * h, t() * w, t() * h)
      c.stroke()
    }
  })
  const m = [mat('#241a15', 0.6), mat(0xffffff, 0.6, { map: tex }), mat(0xffffff, 0.6, { map: tex })]
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(geo, m)
    const a = r() * 6.28
    const dd = 0.1 + r() * 0.35
    d.position.set(Math.cos(a) * dd, r() * 0.02, Math.sin(a) * dd)
    d.rotation.set((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3)
    g.add(d)
  }
  return g
}
function salmon() {
  const geo = new RoundedBoxGeometry(0.92, 0.24, 0.44, 6, 0.07)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    p.setY(i, y + (y > 0 ? 0.03 * Math.cos(x * 3) : 0))
  }
  geo.computeVertexNormals()
  const flesh = C('#ef8456')
  const line = C('#fbd8c4')
  const sear = C('#b5582a')
  const mark = C('#3a1c0e')
  colorize(geo, (x, y, z, c) => {
    c.copy(flesh)
    const t = Math.sin((x * 1.1 + z * 0.55) * 30)
    if (t > 0.82) c.lerp(line, ((t - 0.82) / 0.18) * 0.85)
    if (y > 0.09) {
      c.lerp(sear, Math.min(1, (y - 0.09) / 0.05))
      if (Math.sin((x - z * 0.9) * 15) > 0.9) c.lerp(mark, 0.8)
    }
  })
  return new THREE.Mesh(geo, mat(0xffffff, 0.42, { vertexColors: true, clearcoat: 0.55 }))
}
function asparagus() {
  const g = group()
  const sm = mat('#6c9a34', 0.4, { clearcoat: 0.5 })
  const tm = mat('#4c7428', 0.55)
  for (let i = 0; i < 5; i++) {
    const sp = group()
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.8, 12), sm)
    st.rotation.z = Math.PI / 2
    sp.add(st)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), tm)
    tip.scale.set(1.9, 0.85, 0.85)
    tip.position.x = 0.43
    sp.add(tip)
    for (let k = 0; k < 4; k++) {
      const sc = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 6), tm)
      sc.rotation.z = -Math.PI / 2
      sc.position.set(-0.2 + k * 0.15, 0.026, 0)
      sp.add(sc)
    }
    sp.position.set(i * 0.012, 0.035 + (i % 2) * 0.035, i * 0.075)
    sp.rotation.y = (i - 2) * 0.05
    g.add(sp)
  }
  return g
}
function cherryTomatoes() {
  const g = group()
  const m = mat('#d8321f', 0.15, { clearcoat: 1 })
  const st = mat('#3d6e26', 0.5)
  ;[
    [0, 0],
    [0.17, -0.1],
    [0.06, -0.2],
  ].forEach(([x, z]) => {
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 18), m)
    t.scale.y = 0.9
    t.position.set(x, 0.067, z)
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 6), st)
    s.position.set(x, 0.15, z)
    g.add(t, s)
  })
  return g
}
function lemon() {
  const tex = canvasTex('lemon', 256, 256, (c, w) => {
    const cx = w / 2
    c.fillStyle = '#f2d63a'
    c.fillRect(0, 0, w, w)
    c.fillStyle = '#fbf6dc'
    c.beginPath()
    c.arc(cx, cx, cx * 0.9, 0, 7)
    c.fill()
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.283
      c.fillStyle = i % 2 ? '#f6e070' : '#f3da5c'
      c.beginPath()
      c.moveTo(cx, cx)
      c.arc(cx, cx, cx * 0.82, a + 0.06, a + 6.283 / 9 - 0.06)
      c.closePath()
      c.fill()
    }
    c.fillStyle = '#fbf6dc'
    c.beginPath()
    c.arc(cx, cx, cx * 0.12, 0, 7)
    c.fill()
  })
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 48), [
    mat('#f1d22f', 0.4, { clearcoat: 0.6 }),
    mat(0xffffff, 0.25, { map: tex, clearcoat: 1 }),
    mat(0xffffff, 0.25, { map: tex }),
  ])
  m.position.y = 0.02
  m.rotation.x = 0.12
  return group(m)
}
function herbDots() {
  const g = group()
  const m = mat('#5e8a2e', 0.2, { clearcoat: 1 })
  for (let i = 0; i < 7; i++) {
    const a = 2.6 + i * 0.17
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (i % 3) * 0.01, 16, 10), m)
    d.scale.y = 0.35
    d.position.set(Math.cos(a) * 0.78, 0.01, Math.sin(a) * 0.78)
    g.add(d)
  }
  return g
}
function puree() {
  const rf = (t: number) => 0.3 * Math.pow(1 - t, 0.6) * (1 + 0.06 * Math.sin(t * Math.PI * 8))
  const pts = [V2(0, 0)]
  for (let i = 0; i <= 60; i++) pts.push(V2(rf(i / 60), (i / 60) * 0.2))
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), mat('#f3e2b4', 0.5, { clearcoat: 0.3 }))
  m.scale.set(1.15, 1, 1)
  return m
}
function cake() {
  const pts = [V2(0, 0), V2(0.3, 0), V2(0.31, 0.02), V2(0.3, 0.27), V2(0.28, 0.32), V2(0.16, 0.355), V2(0, 0.36)]
  const geo = new THREE.LatheGeometry(pts, 64)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + 0.015 * Math.sin(y * 40 + x * 10)
    p.setXYZ(i, x * k, y, z * k)
  }
  geo.computeVertexNormals()
  const g = group(new THREE.Mesh(geo, mat('#3b1d12', 0.75)))
  const r = rng(71)
  g.add(
    inst(new THREE.SphereGeometry(0.009, 5, 4), mat('#ffffff', 0.9), 220, (_i, p2) => {
      const a = r() * 6.28
      const d = Math.sqrt(r()) * 0.27
      p2.set(Math.cos(a) * d, 0.36 - Math.pow(d / 0.3, 2) * 0.045, Math.sin(a) * d)
    }),
  )
  return g
}
function lava() {
  const s = new THREE.Shape()
  const n = 40
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = 0.2 * (1 + 0.22 * Math.sin(3 * a + 0.5) + 0.1 * Math.sin(5 * a))
    const x = Math.cos(a) * rr * 0.9
    const y = Math.sin(a) * rr * 1.25
    if (i) s.lineTo(x, y)
    else s.moveTo(x, y)
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 3, curveSegments: 30 })
  geo.rotateX(-Math.PI / 2)
  return new THREE.Mesh(geo, mat('#2c120a', 0.1, { clearcoat: 1, clearcoatRoughness: 0.05 }))
}
function scoop() {
  const geo = new THREE.SphereGeometry(0.19, 48, 32)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + 0.06 * Math.sin(x * 28) * Math.cos(z * 25) + 0.04 * Math.sin(y * 35)
    p.setXYZ(i, x * k, Math.max(y * k, -0.12), z * k)
  }
  geo.computeVertexNormals()
  const g = group(new THREE.Mesh(geo, mat('#fbf1dc', 0.55, { sheen: 0.6, sheenColor: C('#fff') })))
  const mint = group()
  const lm = mat('#3f9a45', 0.4, { clearcoat: 0.5 })
  ;[0, 2.3].forEach((ry) => {
    const l = new THREE.Mesh(leafGeo(0.13, 0.065, 0.4), lm)
    l.rotation.set(-0.4, ry, 0)
    mint.add(l)
  })
  mint.position.y = 0.17
  g.add(mint)
  return g
}
function strawberries() {
  const g = group()
  const pts = [V2(0, 0), V2(0.05, 0.01), V2(0.085, 0.06), V2(0.08, 0.11), V2(0.045, 0.15), V2(0, 0.16)]
  const geo = new THREE.LatheGeometry(pts, 32)
  const m = mat('#c8202b', 0.25, { clearcoat: 1 })
  const lf = mat('#3e7d2c', 0.5)
  ;[
    [0, 0, 0.2],
    [0.16, -0.05, -0.5],
  ].forEach(([x, z, ry]) => {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.03, 6), lf)
    cap.position.y = 0.165
    const s = group(new THREE.Mesh(geo, m), cap)
    s.rotation.set(0, ry, Math.PI / 2)
    s.position.set(x, 0.085, z)
    g.add(s)
  })
  return g
}
function drizzle(color: string, pts: [number, number][]) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V3(x, 0.005, z)))
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.016, 8), mat(color, 0.12, { clearcoat: 1 }))
  m.scale.y = 0.45
  return m
}
function berries() {
  const g = group()
  const r = rng(91)
  const dm = mat('#a8143a', 0.25, { clearcoat: 0.8 })
  for (const [x, z] of [
    [-0.5, -0.35],
    [0.62, 0.15],
    [-0.15, -0.62],
  ]) {
    const rb = inst(new THREE.SphereGeometry(0.026, 10, 8), dm, 30, (_i, p) => {
      p.copy(domePt(0.065, 0.08, r, 1).p)
    })
    rb.position.set(x, 0.01, z)
    g.add(rb)
  }
  g.add(
    drizzle('#9e1230', [
      [-0.65, 0.1],
      [-0.45, 0.45],
      [-0.1, 0.6],
      [0.25, 0.62],
      [0.5, 0.45],
    ]),
  )
  return g
}

/** Bife empanado: formato irregular, crosta dourada com farelo. */
function cutletShape(w = 0.5, d = 0.34, seed = 0) {
  const s = new THREE.Shape()
  const n = 56
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = 1 + 0.07 * Math.sin(3 * a + seed) + 0.05 * Math.sin(5 * a + seed * 2) + 0.03 * Math.sin(9 * a)
    const x = Math.cos(a) * w * k
    const y = Math.sin(a) * d * k
    if (i) s.lineTo(x, y)
    else s.moveTo(x, y)
  }
  return s
}
function breadedTex() {
  return canvasTex('breaded', 512, 512, (c, w, h) => {
    const r = rng(87)
    c.fillStyle = '#a95c1a'
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 3200; i++) {
      const v = r()
      c.fillStyle = v < 0.45 ? 'rgba(110,52,14,.6)' : v < 0.8 ? 'rgba(206,132,52,.6)' : 'rgba(236,178,92,.55)'
      c.beginPath()
      c.ellipse(r() * w, r() * h, 1.5 + r() * 5, 1 + r() * 3, r() * 3, 0, 7)
      c.fill()
    }
  })
}
function cutlet(w = 0.5, d = 0.34) {
  const geo = new THREE.ExtrudeGeometry(cutletShape(w, d, 1), {
    depth: 0.03,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.03,
    bevelSegments: 4,
    curveSegments: 48,
  })
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    p.setY(i, p.getY(i) + 0.02 + Math.sin(x * 13 + z * 4) * 0.006 + Math.cos(z * 15) * 0.005)
  }
  geo.computeVertexNormals()
  const t = breadedTex()
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1.6, 1.6)
  const m = mat(0xffffff, 0.8, { map: t, sheen: 0.25, sheenColor: C('#e0a050') })
  return new THREE.Mesh(geo, [m, m])
}
function milanesa() {
  const g = group(cutlet())
  const r = rng(43)
  g.add(
    inst(new THREE.IcosahedronGeometry(0.012, 0), mat(0xffffff, 0.8), 140, (_i, p, q, s, c) => {
      const a = r() * 6.28
      const d = Math.sqrt(r()) * 0.9
      p.set(Math.cos(a) * d * 0.5, 0.075 + r() * 0.006, Math.sin(a) * d * 0.33)
      randQ(q, r)
      s.setScalar(0.6 + r() * 0.9)
      c.set('#c97a2c').lerp(C('#8a4812'), r())
    }),
  )
  const lemonSlice = lemon()
  lemonSlice.scale.setScalar(0.6)
  lemonSlice.position.set(0.36, 0.05, 0.2)
  g.add(lemonSlice)
  return g
}
function parmegiana() {
  const g = group(cutlet(0.52, 0.36))
  const sauceGeo = new THREE.ExtrudeGeometry(cutletShape(0.46, 0.31, 4), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.03, bevelSegments: 3, curveSegments: 40 })
  sauceGeo.rotateX(-Math.PI / 2)
  const sauce = new THREE.Mesh(sauceGeo, mat('#b8321c', 0.22, { clearcoat: 1, clearcoatRoughness: 0.15 }))
  sauce.position.y = 0.075
  g.add(sauce)
  const cheeseTex = canvasTex('cheese', 256, 256, (c, w, h) => {
    const r = rng(9)
    c.fillStyle = '#f6dc8e'
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 40; i++) {
      const gr = c.createRadialGradient(0, 0, 0, 0, 0, 14 + r() * 18)
      gr.addColorStop(0, 'rgba(176,104,38,.85)')
      gr.addColorStop(1, 'rgba(176,104,38,0)')
      c.save()
      c.translate(r() * w, r() * h)
      c.fillStyle = gr
      c.fillRect(-40, -40, 80, 80)
      c.restore()
    }
  })
  cheeseTex.wrapS = cheeseTex.wrapT = THREE.RepeatWrapping
  cheeseTex.repeat.set(2, 2)
  const cheeseGeo = new THREE.ExtrudeGeometry(cutletShape(0.4, 0.26, 7), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.05, bevelSegments: 4, curveSegments: 40 })
  cheeseGeo.rotateX(-Math.PI / 2)
  const cp = cheeseGeo.attributes.position
  for (let i = 0; i < cp.count; i++) cp.setY(i, cp.getY(i) + Math.sin(cp.getX(i) * 11) * Math.cos(cp.getZ(i) * 13) * 0.008)
  cheeseGeo.computeVertexNormals()
  const cm = mat(0xffffff, 0.35, { map: cheeseTex, clearcoat: 0.7 })
  const cheese = new THREE.Mesh(cheeseGeo, [cm, cm])
  cheese.position.y = 0.09
  g.add(cheese)
  const b = basil()
  b.scale.setScalar(0.7)
  b.position.set(0.05, 0.13, -0.02)
  g.add(b)
  return g
}
function medallions() {
  const g = group()
  const t = canvasTex('medallion', 256, 256, (c, w, h) => {
    const r = rng(17)
    c.fillStyle = '#5a2c16'
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(${(110 + r() * 50) | 0},${(50 + r() * 25) | 0},${(22 + r() * 15) | 0},.3)`
      c.beginPath()
      c.arc(r() * w, r() * h, 2 + r() * 7, 0, 7)
      c.fill()
    }
    c.save()
    c.translate(w / 2, h / 2)
    c.rotate(0.7)
    c.fillStyle = 'rgba(28,12,5,.85)'
    for (let k = -3; k <= 3; k++) c.fillRect(-w, k * 34 - 6, 2 * w, 12)
    c.restore()
  })
  const top = mat(0xffffff, 0.5, { map: t, clearcoat: 0.5 })
  const side = mat('#4d2513', 0.6, { clearcoat: 0.3 })
  ;[
    [-0.15, 0.04, 0.2],
    [0.17, -0.06, -0.4],
  ].forEach(([x, z, ry]) => {
    const geo = new THREE.CylinderGeometry(0.2, 0.21, 0.15, 48, 3)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i))
      const k = 1 + 0.05 * Math.sin(3 * a + x * 9) + 0.03 * Math.sin(7 * a)
      p.setX(i, p.getX(i) * k)
      p.setZ(i, p.getZ(i) * k)
    }
    geo.computeVertexNormals()
    const m = new THREE.Mesh(geo, [side, top, top])
    m.position.set(x, 0.075, z)
    m.rotation.y = ry
    g.add(m)
  })
  const pepper = inst(new THREE.IcosahedronGeometry(0.008, 0), mat('#1d1712', 0.6), 40, (_i, p, q) => {
    const r2 = rng(_i + 3)
    const a = r2() * 6.28
    const d = Math.sqrt(r2()) * 0.17
    p.set((_i % 2 ? 0.17 : -0.15) + Math.cos(a) * d, 0.152, (_i % 2 ? -0.06 : 0.04) + Math.sin(a) * d)
    randQ(q, r2)
  })
  g.add(pepper)
  return g
}
function vegetables() {
  const g = group()
  const r = rng(73)
  // brócolis: talo + buquê de bolinhas
  const stemM = mat('#8bb35a', 0.5)
  const budM = mat('#2f6b2a', 0.6, { sheen: 0.5, sheenColor: C('#9fd36a') })
  for (let k = 0; k < 3; k++) {
    const b = group()
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.12, 10), stemM)
    stem.position.y = 0.06
    b.add(stem)
    b.add(
      inst(new THREE.SphereGeometry(0.03, 10, 8), budM, 26, (_i, p, _q, s) => {
        p.copy(domePt(0.09, 0.07, r, 1).p).add(V3(0, 0.11, 0))
        s.setScalar(0.8 + r() * 0.5)
      }),
    )
    b.position.set(-0.15 + k * 0.16, 0, -0.1 + (k % 2) * 0.12)
    b.rotation.set((r() - 0.5) * 0.6, r() * 6, (r() - 0.5) * 0.8)
    g.add(b)
  }
  // cenoura em rodelas
  const carrot = mat('#f07a1e', 0.35, { clearcoat: 0.6 })
  for (let k = 0; k < 5; k++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 24), carrot)
    c.position.set(-0.2 + r() * 0.45, 0.02 + r() * 0.03, 0.12 + r() * 0.14)
    c.rotation.set((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6)
    g.add(c)
  }
  // abobrinha em meia-lua
  const zTex = canvasTex('zucchini', 128, 128, (c, w) => {
    c.fillStyle = '#3d7a2a'
    c.fillRect(0, 0, w, w)
    c.fillStyle = '#e8eec0'
    c.beginPath()
    c.arc(w / 2, w / 2, w * 0.42, 0, 7)
    c.fill()
    c.fillStyle = 'rgba(190,200,120,.7)'
    for (let i = 0; i < 6; i++) {
      c.beginPath()
      c.arc(w / 2 + Math.cos(i) * w * 0.12, w / 2 + Math.sin(i) * w * 0.12, 3, 0, 7)
      c.fill()
    }
  })
  const zm = [mat('#3d7a2a', 0.4, { clearcoat: 0.5 }), mat(0xffffff, 0.4, { map: zTex }), mat(0xffffff, 0.4, { map: zTex })]
  for (let k = 0; k < 4; k++) {
    const z = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 28), zm)
    z.position.set(0.14 + r() * 0.2, 0.025 + r() * 0.02, -0.18 + r() * 0.2)
    z.rotation.set((r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7)
    g.add(z)
  }
  return g
}

function saladBowl() {
  const g = group(steelBowl(0.72, 0.3))
  g.add(saladMix(0.5, 0.12, 1))
  return g
}
/** Folhas, tomate, cebola e cenoura. `base` = altura do fundo; `k` = escala do conjunto. */
function saladMix(R: number, base: number, k: number) {
  const g = group()
  const r = rng(33)
  const greens = ['#6cb33f', '#86c24f', '#9bd15a', '#5aa336', '#4f9a33', '#a9d96b', '#86c24f', '#6e2b42']
  g.add(
    inst(leafGeo(0.3, 0.16, 1.1), mat(0xffffff, 0.45, { clearcoat: 0.4, sheen: 0.5, sheenColor: C('#c8f09a') }), 150, (_i, p, q, s, c) => {
      const a = r() * 6.28
      const d = Math.sqrt(r()) * R
      p.set(Math.cos(a) * d, base + r() * 0.12 * k + (1 - d / R) * 0.1 * k, Math.sin(a) * d)
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7))
      s.setScalar(0.75 + r() * 0.5)
      c.set(greens[(r() * greens.length) | 0])
    }),
  )
  const tomTop = canvasTex('tomato', 256, 256, (c, w, h) => {
    c.fillStyle = '#d8321f'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#f0563c'
    c.beginPath()
    c.arc(w / 2, h / 2, w * 0.4, 0, 7)
    c.fill()
    c.fillStyle = '#e8402a'
    for (let k = 0; k < 4; k++) {
      c.save()
      c.translate(w / 2, h / 2)
      c.rotate((k * Math.PI) / 2)
      c.fillRect(-6, -w * 0.4, 12, w * 0.4)
      c.restore()
    }
    c.fillStyle = '#f6d36a'
    for (let k = 0; k < 4; k++)
      for (let j = 0; j < 5; j++) {
        const a = (k * Math.PI) / 2 + 0.45 + j * 0.15
        const d = w * (0.18 + (j % 2) * 0.08)
        c.beginPath()
        c.ellipse(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 5, 3, a, 0, 7)
        c.fill()
      }
  })
  const tomMats = [mat('#c42a1a', 0.3, { clearcoat: 0.8 }), mat(0xffffff, 0.25, { map: tomTop, clearcoat: 1 }), mat(0xffffff, 0.25, { map: tomTop, clearcoat: 1 })]
  ;[
    [-0.05, 0.38, 0.05, 0.3],
    [0.2, 0.36, -0.15, -0.4],
  ].forEach(([x, y, z, t]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.035, 40), tomMats)
    m.position.set(x * k, base + (y - 0.12) * k, z * k)
    m.rotation.set(t, 0, t * 0.6)
    g.add(m)
  })
  const onion = mat('#f3eedf', 0.3, { clearcoat: 1, sheen: 0.4, sheenColor: C('#ffffff') })
  // Posições fixas: ficam sempre sobre as folhas, dentro da cumbuca.
  ;[
    [-0.14, 0.05, 0.1, 0.3],
    [0.12, -0.1, 0.12, -0.25],
    [0.02, 0.17, 0.09, 0.15],
    [-0.2, -0.16, 0.11, -0.1],
  ].forEach(([x, z, radius, tilt]) => {
    const tor = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.011, 8, 40), onion)
    tor.position.set(x * k, base + 0.25 * k, z * k)
    tor.rotation.set(Math.PI / 2 + tilt, 0, tilt * 0.6)
    tor.userData.noShadow = true
    g.add(tor)
  })
  g.add(
    inst(new THREE.BoxGeometry(0.016, 0.014, 0.2), mat(0xffffff, 0.35, { clearcoat: 0.6 }), 70, (_i, p, q, _s, c) => {
      const a = r() * 6.28
      const d = (0.2 + Math.sqrt(r()) * 0.35) * (R / 0.5)
      p.set(Math.cos(a) * d, base + (0.18 + r() * 0.08) * k, Math.sin(a) * d)
      randQ(q, r)
      c.set('#ffa53a').lerp(C('#f07d1c'), r())
    }),
  )
  return g
}
function plateSalad() {
  const g = saladMix(0.32, 0.0, 0.7)
  g.scale.setScalar(0.85)
  return g
}
function farofaBowl() {
  const g = group(steelBowl(0.42, 0.24))
  const r = rng(71)
  g.add(
    inst(new THREE.BoxGeometry(0.022, 0.016, 0.022), mat(0xffffff, 0.85), 1500, (_i, p, q, _s, c) => {
      const a = r() * 6.28
      const d = Math.sqrt(r())
      p.set(Math.cos(a) * d * 0.36, 0.06 + (1 - d * d) * 0.17 * (0.55 + r() * 0.45), Math.sin(a) * d * 0.36)
      randQ(q, r)
      if (r() < 0.04) c.set('#5c7f2b')
      else c.set('#efc26a').lerp(C('#c48632'), r())
    }),
  )
  return g
}

const BUILDERS: Record<PartType, () => THREE.Object3D> = {
  arroz: rice,
  pure: puree,
  feijao_caldo: beansPool,
  batata_frita: fries,
  farofa: farofaPile,
  vinagrete,
  ovo_frito: friedEgg,
  aspargos: asparagus,
  tomate_cereja: cherryTomatoes,
  limao: lemon,
  molho_ervas: herbDots,
  bife: steak,
  picanha: picanhaSlices,
  espaguete: pastaNest,
  bolonhesa: ragu,
  parmesao: parmesan,
  manjericao: basil,
  burrata,
  risoto: risottoBase,
  cogumelos: mushrooms,
  lascas_parmesao: shavings,
  trufa: truffle,
  salsinha: herbs,
  salmao: salmon,
  bolo_chocolate: cake,
  centro_cremoso: lava,
  sorvete: scoop,
  morangos: strawberries,
  calda_chocolate: () =>
    drizzle('#3a1a0f', [
      [-0.62, -0.3],
      [-0.35, -0.55],
      [0, -0.62],
      [0.3, -0.6],
      [0.6, -0.45],
    ]),
  frutas_vermelhas: berries,
  cumbuca_salada: saladBowl,
  salada_prato: plateSalad,
  milanesa,
  parmegiana,
  medalhao: medallions,
  legumes: vegetables,
  cumbuca_farofa: farofaBowl,
  cumbuca_feijao: beansBowl,
}

/* ============================== montagem ============================== */
type BuiltPart = { name: string; obj: THREE.Object3D; baseY: number; idx: number; cx: number; cz: number; top: number; lift: number }

function buildScene(scene: Scene) {
  const root = new THREE.Group()
  const lift = scene.placemat ? 0.012 : 0
  const plateMesh = plate(scene.plate)
  plateMesh.position.y = lift
  root.add(plateMesh)
  const floor = PLATE_FLOOR[scene.plate] + lift
  const radius = PLATE_RADIUS[scene.plate]
  const parts: BuiltPart[] = []
  scene.parts.forEach((p, idx) => {
    const obj = BUILDERS[p.type as PartType]?.()
    if (!obj) return
    const onPlate = Math.hypot(p.x, p.z) < radius * 0.8
    const def = (PART_CATALOG[p.type as PartType] as { y?: number }).y ?? 0
    const baseY = (onPlate ? floor : lift) + (p.y ?? def)
    const holder = group(obj)
    holder.position.set(p.x, baseY, p.z)
    holder.rotation.y = (p.rot * Math.PI) / 180
    holder.scale.setScalar(p.scale)
    root.add(holder)
    parts.push({ name: partLabel(p), obj: holder, baseY, idx, cx: 0, cz: 0, top: 0, lift: 0 })
  })
  root.updateMatrixWorld(true)
  for (const p of parts) {
    const b = new THREE.Box3().setFromObject(p.obj)
    const c = b.getCenter(V3(0, 0, 0))
    p.cx = c.x
    p.cz = c.z
    p.top = b.max.y - p.obj.position.y
  }
  if (scene.placemat) {
    const b = new THREE.Box3().setFromObject(root)
    const w = Math.max(b.max.x - b.min.x, 2.9) / 2 + 0.3
    const h = Math.max(b.max.z - b.min.z, 2.9) / 2 + 0.3
    const pm = placematMesh(w, h)
    pm.position.set((b.max.x + b.min.x) / 2, 0, (b.max.z + b.min.z) / 2)
    root.add(pm)
  }
  root.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) {
      n.castShadow = !n.userData.noShadow
      n.receiveShadow = true
    }
  })
  return { root, parts }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh
    m.geometry?.dispose()
    if (m.material)
      for (const mt of ([] as THREE.Material[]).concat(m.material)) {
        const map = (mt as THREE.MeshPhysicalMaterial).map
        if (map && !map.userData.cached) map.dispose()
        mt.dispose()
      }
  })
}

/* ============================== visualizador ============================== */
function stage(renderer: THREE.WebGLRenderer) {
  const scene3 = new THREE.Scene()
  const pm = new THREE.PMREMGenerator(renderer)
  scene3.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
  scene3.environmentIntensity = 0.8
  pm.dispose()
  const key = new THREE.DirectionalLight('#fff0dc', 2.6)
  key.position.set(2.5, 6, 3)
  key.castShadow = true
  key.shadow.mapSize.set(1536, 1536)
  Object.assign(key.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 0.5, far: 20 })
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.01
  scene3.add(key)
  const rim = new THREE.DirectionalLight('#ffc993', 1.2)
  rim.position.set(-4, 3, -3)
  scene3.add(rim)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.22 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene3.add(ground)
  return { scene3, ground }
}
function newRenderer(capture: boolean) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: capture })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  return renderer
}
function frameFor(model: THREE.Object3D) {
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere())
  return { target: V3(sphere.center.x, 0.12, sphere.center.z), radius: Math.max(sphere.radius, 1.2) }
}
function placeCamera(cam: THREE.PerspectiveCamera, frame: { target: THREE.Vector3; radius: number }, tight = 0.92) {
  const fov = THREE.MathUtils.degToRad(cam.fov)
  const fitH = frame.radius / Math.sin(fov / 2)
  const fitW = frame.radius / Math.sin(Math.atan(Math.tan(fov / 2) * cam.aspect))
  const dist = Math.max(fitH, fitW) * tight
  cam.position.copy(frame.target).addScaledVector(V3(0.42, 0.84, 0.77).normalize(), dist)
  cam.lookAt(frame.target)
  return dist
}

/**
 * Fotos dos pratos montados, para as vitrines do cardápio (sem precisar de capa salva).
 * Usa um único contexto WebGL e devolve imagens com fundo transparente.
 */
export async function renderThumbnails(items: { id: string; scene: Scene }[], width = 360, height = 440) {
  const renderer = newRenderer(true)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  const { scene3, ground } = stage(renderer)
  const cam = new THREE.PerspectiveCamera(34, width / height, 0.05, 60)
  const out: Record<string, string> = {}
  try {
    for (const item of items) {
      const { root } = buildScene(item.scene)
      scene3.add(root)
      placeCamera(cam, frameFor(root), 0.7)
      renderer.render(scene3, cam)
      out[item.id] = renderer.domElement.toDataURL('image/webp', 0.82)
      scene3.remove(root)
      disposeTree(root)
      await new Promise((r) => setTimeout(r, 0)) // não trava a rolagem entre um prato e outro
    }
  } finally {
    ground.geometry.dispose()
    ;(ground.material as THREE.Material).dispose()
    scene3.environment?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return out
}

export type SceneViewer = {
  setScene(scene: Scene, opts?: { keepCamera?: boolean }): void
  setExplode(on: boolean): void
  setAutoRotate(on: boolean): void
  resetCamera(): void
  /** Imagem do ângulo atual (capa do prato). Exige `capture: true`. */
  snapshot(): Promise<Blob>
  dispose(): void
}

export function createSceneViewer(
  host: HTMLElement,
  opts: { capture?: boolean; autoRotate?: boolean; onInteract?: () => void } = {},
): SceneViewer {
  const renderer = newRenderer(opts.capture ?? false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y'
  host.prepend(renderer.domElement)

  const labelLayer = document.createElement('div')
  labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'
  host.appendChild(labelLayer)

  const { scene3, ground } = stage(renderer)

  const cam = new THREE.PerspectiveCamera(34, 1, 0.05, 60)
  const controls = new OrbitControls(cam, renderer.domElement)
  Object.assign(controls, {
    enableDamping: true,
    dampingFactor: 0.08,
    enablePan: false,
    autoRotate: (opts.autoRotate ?? true) && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    autoRotateSpeed: 1.2,
    minPolarAngle: 0.1,
    maxPolarAngle: 1.3,
    rotateSpeed: 0.8,
  })
  controls.addEventListener('start', () => opts.onInteract?.())

  let model: THREE.Group | null = null
  let parts: BuiltPart[] = []
  let labels: HTMLDivElement[] = []
  let explode = 0
  let explodeTarget = 0
  let frame = { target: V3(0, 0.12, 0), radius: 2 }
  let raf = 0

  function fit() {
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    renderer.setSize(w, h, false)
    cam.aspect = w / h
    cam.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(fit)
  ro.observe(host)
  fit()

  function resetCamera() {
    const dist = placeCamera(cam, frame)
    controls.target.copy(frame.target)
    controls.minDistance = dist * 0.35
    controls.maxDistance = dist * 2.2
    controls.update()
  }

  function setScene(next: Scene, o: { keepCamera?: boolean } = {}) {
    if (model) {
      scene3.remove(model)
      disposeTree(model)
    }
    const built = buildScene(next)
    model = built.root
    parts = built.parts
    scene3.add(model)
    frame = frameFor(model)
    labelLayer.replaceChildren()
    labels = parts.map((p) => {
      const d = document.createElement('div')
      d.textContent = p.name
      d.style.cssText =
        'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;background:#fff;color:#111;font:600 12px/1 system-ui,sans-serif;padding:6px 9px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.25);opacity:0;transition:opacity .2s'
      labelLayer.appendChild(d)
      return d
    })
    if (!o.keepCamera) resetCamera()
  }

  function loop() {
    raf = requestAnimationFrame(loop)
    if (model) {
      explode += (explodeTarget - explode) * 0.09
      const e = explode
      const s = 1 / (1 + 0.25 * e)
      parts.forEach((p) => {
        p.lift = e * (0.3 + p.idx * 0.2)
        p.obj.position.y = p.baseY + p.lift
      })
      model.scale.setScalar(s)
      const maxLift = e * (0.3 + Math.max(0, parts.length - 1) * 0.2)
      controls.target.y += ((frame.target.y + maxLift * 0.55) * s - controls.target.y) * 0.1
      const w = host.clientWidth
      const h = host.clientHeight
      if (e < 0.05) labels.forEach((l) => (l.style.opacity = '0'))
      else {
        const pos = parts.map((p, i) => {
          const wp = V3(p.cx, p.baseY + p.lift + p.top + 0.02, p.cz)
          model!.localToWorld(wp)
          wp.project(cam)
          const lw = labels[i].offsetWidth || 100
          return { i, lw, x: Math.max(lw / 2 + 8, Math.min(w - lw / 2 - 8, ((wp.x + 1) / 2) * w)), y: Math.max(40, ((1 - wp.y) / 2) * h) }
        })
        // Evita rótulos sobrepostos: empurra para cima quem colide.
        pos.sort((a, b) => b.y - a.y)
        const placed: typeof pos = []
        for (const a of pos) {
          let moved = true
          while (moved) {
            moved = false
            for (const b of placed)
              if (Math.abs(a.x - b.x) < (a.lw + b.lw) / 2 + 6 && Math.abs(a.y - b.y) < 27) {
                a.y = b.y - 27
                moved = true
              }
          }
          placed.push(a)
        }
        for (const a of pos) {
          const l = labels[a.i]
          l.style.left = `${a.x}px`
          l.style.top = `${Math.max(40, a.y)}px`
          l.style.opacity = String(Math.min(1, (e - 0.05) * 1.6))
        }
      }
    }
    controls.update()
    renderer.render(scene3, cam)
  }
  loop()

  return {
    setScene,
    setExplode: (on) => (explodeTarget = on ? 1 : 0),
    setAutoRotate: (on) => (controls.autoRotate = on),
    resetCamera,
    snapshot: () =>
      new Promise((resolve, reject) => {
        renderer.render(scene3, cam)
        renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/webp', 0.85)
      }),
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      if (model) disposeTree(model)
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      scene3.environment?.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      labelLayer.remove()
    },
  }
}
export { buildScene, stage, newRenderer, frameFor }
