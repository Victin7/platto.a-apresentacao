import * as THREE from 'three'
import { buildScene, newRenderer, stage } from './engine'
import { parseScene } from './types'
import scenesRaw from './scenes.json'

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const host = document.getElementById('stage')!
const labelLayer = document.getElementById('labels')!
const bigTitle = document.getElementById('bigtitle')!

const renderer = newRenderer(false)
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
renderer.setClearColor(0x000000, 0)
host.appendChild(renderer.domElement)
const { scene3, ground } = stage(renderer)
;(ground.material as THREE.ShadowMaterial).opacity = 0.42
ground.scale.setScalar(4)
const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 300)

// Pratos enfileirados: a câmera viaja de um para o outro com a rolagem.
const DISHES: [string, number][] = [
  ['picanha-grelhada', 0],
  ['parmegiana-de-file-mignon', 7],
  ['petit-gateau', 14],
  ['salmao-grelhado', 21],
  ['risoto-de-cogumelos', 28],
]
const raw = scenesRaw as Record<string, unknown>
const built = DISHES.map(([key, x]) => {
  const b = buildScene(parseScene(raw[key])!)
  b.root.position.x = x
  scene3.add(b.root)
  return b
})
// A sombra acompanha a fileira inteira.
const key = scene3.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight
Object.assign(key.shadow.camera, { left: -20, right: 20, top: 6, bottom: -6 })
key.position.set(16.5, 7, 4)
key.target.position.set(14, 0, 0)
scene3.add(key.target)
key.shadow.camera.updateProjectionMatrix()
key.shadow.mapSize.set(2048, 2048)

// Rótulos do prato desmontado (seção 02).
const explodeDish = built[1]
const labels = explodeDish.parts.map((p) => {
  const s = document.createElement('span')
  s.textContent = p.name
  labelLayer.appendChild(s)
  return s
})

type Key = { pos: [number, number, number]; look: [number, number, number] }
// Uma posição de câmera por seção, na ordem do HTML.
const KEYS: Key[] = [
  { pos: [0.01, 19, 7.5], look: [0, 0.05, -2.6] }, // início: de cima, sob o título
  { pos: [1.5, 3.3, 5.4], look: [-1.5, 0.1, 0.2] }, // 01 prato à direita
  { pos: [9.9, 3.9, 6.4], look: [5.9, 0.95, 0] }, // 02 desmontado
  { pos: [16.6, 2.8, 4.9], look: [16.9, 0.2, 0] }, // 03 prato à esquerda
  { pos: [23.6, 3.1, 4.9], look: [20.0, 0.2, 0] }, // 04 prato à direita
  { pos: [30.6, 2.7, 4.6], look: [31.2, 0.2, 0] }, // 05 prato à esquerda
  { pos: [14, 17, 10.5], look: [14, 0, 0] }, // 06 vista aérea da fileira
  { pos: [14.01, 30, 1.2], look: [14, 0, 0] }, // 07 bem do alto
]

const sections = [...document.querySelectorAll<HTMLElement>('main > section')]
const railLinks = [...document.querySelectorAll<HTMLAnchorElement>('.rail a')]

/** Posição contínua da rolagem: 0 = início centralizado, 1 = seção 01 centralizada... */
function scrollPos() {
  const y = scrollY
  const vh = innerHeight
  const centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2 - vh / 2)
  if (y <= centers[0]) return 0
  for (let i = 0; i < centers.length - 1; i++) {
    if (y < centers[i + 1]) return i + (y - centers[i]) / Math.max(1, centers[i + 1] - centers[i])
  }
  return centers.length - 1
}

const ease = (t: number) => t * t * (3 - 2 * t)
const lerp3 = (a: number[], b: number[], t: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)

function fit() {
  const w = innerWidth
  const h = innerHeight
  renderer.setSize(w, h, false)
  cam.aspect = w / h
  // No celular a câmera recua para o prato caber.
  cam.fov = w < 760 ? 46 : 32
  cam.updateProjectionMatrix()
}
addEventListener('resize', fit)
fit()

let s = scrollPos()
let active = -1
let last = performance.now()
const tmp = new THREE.Vector3()

function frame(t: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, (t - last) / 1000)
  last = t
  const target = scrollPos()
  s = reduced ? target : s + (target - s) * Math.min(1, dt * 4.2)

  const i = Math.min(KEYS.length - 2, Math.floor(s))
  const f = ease(Math.min(1, Math.max(0, s - i)))
  const pos = lerp3(KEYS[i].pos, KEYS[i + 1].pos, f)
  const look = lerp3(KEYS[i].look, KEYS[i + 1].look, f)
  if (!reduced) {
    pos.x += Math.sin(t * 0.00025) * 0.18
    pos.y += Math.sin(t * 0.0003) * 0.08
  }
  // No celular o texto fica embaixo: centraliza o prato e sobe a câmera.
  if (innerWidth < 760) {
    const mid = DISHES[Math.min(DISHES.length - 1, Math.max(0, Math.round(look.x / 7)))][1]
    look.x += (mid - look.x) * 0.85
    pos.x += (mid - look.x) * 0.2
    look.y -= 0.6
  }
  cam.position.copy(pos)
  cam.lookAt(look)

  // Pratos giram devagar.
  if (!reduced) built.forEach((b, k) => (b.root.rotation.y = t * 0.00012 * (k % 2 ? -1 : 1) + k))

  // Seção 02: o prato se desmonta perto do centro dela.
  const e = ease(Math.max(0, 1 - Math.abs(s - 2) * 1.4))
  explodeDish.parts.forEach((p) => (p.obj.position.y = p.baseY + e * (0.3 + p.idx * 0.22)))
  const w = innerWidth
  const h = innerHeight
  explodeDish.parts.forEach((p, k) => {
    const l = labels[k]
    if (e < 0.4) {
      l.style.opacity = '0'
      return
    }
    tmp.set(p.cx, p.obj.position.y + p.top + 0.04, p.cz)
    explodeDish.root.localToWorld(tmp)
    tmp.project(cam)
    l.style.left = `${((tmp.x + 1) / 2) * w}px`
    l.style.top = `${((1 - tmp.y) / 2) * h}px`
    l.style.opacity = String(Math.min(1, (e - 0.4) * 3))
  })

  // O título gigante some quando a câmera desce.
  bigTitle.style.opacity = String(Math.max(0, 1 - s * 1.6))
  bigTitle.style.transform = `translateY(${-s * 60}px) scale(${1 + s * 0.06})`

  const now = Math.round(s)
  if (now !== active) {
    active = now
    railLinks.forEach((a, k) => a.classList.toggle('on', k === now))
  }
  renderer.render(scene3, cam)
}
requestAnimationFrame(frame)
