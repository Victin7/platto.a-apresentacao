/**
 * Receita 3D de um prato: a louça e a lista de peças com posição.
 * Fica em `dish_models.scene` (jsonb) e é desenhada no navegador por `engine.ts`.
 * Este arquivo não importa three.js, para o admin e o cardápio validarem sem baixar o 3D.
 */

export type PlateKind = 'raso' | 'fundo' | 'sobremesa'

export type ScenePart = {
  /** Id da peça no catálogo (PART_CATALOG). */
  type: string
  /** Nome exibido em "Ver ingredientes". Vazio = nome padrão da peça. */
  label?: string
  /** Posição sobre a mesa, em unidades do prato (o prato raso tem raio ~1,47). */
  x: number
  z: number
  /** Altura extra em relação ao fundo do prato (ou à mesa, fora dele). */
  y?: number
  /** Rotação em graus. */
  rot: number
  scale: number
}

export type Scene = {
  version: 1
  plate: PlateKind
  /** Jogo americano escuro sob o prato. */
  placemat: boolean
  parts: ScenePart[]
}

export type PartGroup = 'Base' | 'Carnes' | 'Acompanhamentos' | 'Massas e risotos' | 'Peixes' | 'Sobremesas' | 'Cumbucas'

export type PartInfo = { label: string; group: PartGroup; /** Altura padrão acima do fundo do prato. */ y?: number }

export const PART_CATALOG = {
  arroz: { label: 'Arroz branco', group: 'Base' },
  pure: { label: 'Purê de batata', group: 'Base' },
  feijao_caldo: { label: 'Feijão de caldo', group: 'Acompanhamentos' },
  batata_frita: { label: 'Batata frita', group: 'Acompanhamentos' },
  farofa: { label: 'Farofa', group: 'Acompanhamentos' },
  vinagrete: { label: 'Vinagrete', group: 'Acompanhamentos' },
  ovo_frito: { label: 'Ovo frito', group: 'Acompanhamentos', y: 0.2 },
  aspargos: { label: 'Aspargos grelhados', group: 'Acompanhamentos' },
  tomate_cereja: { label: 'Tomate-cereja', group: 'Acompanhamentos' },
  limao: { label: 'Limão siciliano', group: 'Acompanhamentos' },
  legumes: { label: 'Legumes', group: 'Acompanhamentos' },
  salada_prato: { label: 'Salada', group: 'Acompanhamentos' },
  molho_ervas: { label: 'Molho de ervas', group: 'Acompanhamentos' },
  bife: { label: 'Bife grelhado', group: 'Carnes' },
  medalhao: { label: 'Medalhões de filé mignon', group: 'Carnes' },
  milanesa: { label: 'Bife à milanesa', group: 'Carnes' },
  parmegiana: { label: 'Parmegiana', group: 'Carnes' },
  picanha: { label: 'Picanha fatiada', group: 'Carnes' },
  espaguete: { label: 'Espaguete', group: 'Massas e risotos' },
  bolonhesa: { label: 'Molho bolonhesa', group: 'Massas e risotos', y: 0.24 },
  parmesao: { label: 'Parmesão ralado', group: 'Massas e risotos' },
  manjericao: { label: 'Manjericão', group: 'Massas e risotos', y: 0.39 },
  burrata: { label: 'Burrata', group: 'Massas e risotos', y: 0.33 },
  risoto: { label: 'Risoto cremoso', group: 'Massas e risotos' },
  cogumelos: { label: 'Cogumelos salteados', group: 'Massas e risotos', y: 0.13 },
  lascas_parmesao: { label: 'Lascas de parmesão', group: 'Massas e risotos', y: 0.17 },
  trufa: { label: 'Trufa negra', group: 'Massas e risotos', y: 0.16 },
  salsinha: { label: 'Salsinha', group: 'Massas e risotos', y: 0.15 },
  salmao: { label: 'Salmão grelhado', group: 'Peixes', y: 0.16 },
  bolo_chocolate: { label: 'Bolo de chocolate', group: 'Sobremesas' },
  centro_cremoso: { label: 'Centro cremoso', group: 'Sobremesas' },
  sorvete: { label: 'Sorvete de creme', group: 'Sobremesas', y: 0.11 },
  morangos: { label: 'Morangos', group: 'Sobremesas' },
  calda_chocolate: { label: 'Calda de chocolate', group: 'Sobremesas' },
  frutas_vermelhas: { label: 'Frutas vermelhas', group: 'Sobremesas' },
  cumbuca_salada: { label: 'Salada na cumbuca', group: 'Cumbucas' },
  cumbuca_farofa: { label: 'Farofa na cumbuca', group: 'Cumbucas' },
  cumbuca_feijao: { label: 'Feijão na cumbuca', group: 'Cumbucas' },
} satisfies Record<string, PartInfo>

export type PartType = keyof typeof PART_CATALOG

export const PART_GROUPS: PartGroup[] = ['Base', 'Carnes', 'Acompanhamentos', 'Massas e risotos', 'Peixes', 'Sobremesas', 'Cumbucas']

export const PLATES: { id: PlateKind; label: string }[] = [
  { id: 'raso', label: 'Prato raso' },
  { id: 'fundo', label: 'Prato fundo' },
  { id: 'sobremesa', label: 'Prato de sobremesa' },
]

export const isPartType = (t: string): t is PartType => Object.hasOwn(PART_CATALOG, t)
export const partLabel = (p: ScenePart) => p.label?.trim() || (isPartType(p.type) ? PART_CATALOG[p.type].label : p.type)

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/** Lê a receita vinda do banco. Peças desconhecidas são ignoradas (versões futuras não quebram o cardápio). */
export function parseScene(raw: unknown): Scene | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.parts)) return null
  const plate: PlateKind = r.plate === 'fundo' || r.plate === 'sobremesa' ? r.plate : 'raso'
  const parts: ScenePart[] = []
  for (const item of r.parts.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    if (typeof p.type !== 'string' || !isPartType(p.type)) continue
    parts.push({
      type: p.type,
      label: typeof p.label === 'string' ? p.label.slice(0, 60) : undefined,
      x: num(p.x, 0, -4, 4),
      z: num(p.z, 0, -4, 4),
      y: p.y === undefined ? undefined : num(p.y, 0, -1, 2),
      rot: num(p.rot, 0, -360, 360),
      scale: num(p.scale, 1, 0.2, 3),
    })
  }
  return { version: 1, plate, placemat: r.placemat === true, parts }
}

const part = (type: PartType, x: number, z: number, rot = 0, scale = 1, extra: Partial<ScenePart> = {}): ScenePart => ({
  type,
  x,
  z,
  rot,
  scale,
  ...extra,
})

/** Modelos prontos: ponto de partida para montar pratos parecidos. */
export const PRESETS: { id: string; label: string; scene: Scene }[] = [
  {
    id: 'prato-feito',
    label: 'Prato feito',
    scene: {
      version: 1,
      plate: 'raso',
      placemat: true,
      parts: [
        part('arroz', -0.55, 0.08, 0, 1.6),
        part('feijao_caldo', 0.43, 0.48, 0, 1.3),
        part('bife', 0.48, -0.42, -14, 1.3),
        part('batata_frita', -0.05, 0.12),
        part('cumbuca_salada', -1.15, -2.05),
        part('cumbuca_farofa', 1.0, -2.1),
      ],
    },
  },
  {
    id: 'picanha',
    label: 'Picanha na brasa',
    scene: {
      version: 1,
      plate: 'raso',
      placemat: false,
      parts: [
        part('arroz', -0.45, -0.25),
        part('cumbuca_feijao', 0.42, -0.47),
        part('picanha', 0.36, 0.25, 52),
        part('farofa', -0.42, 0.43),
        part('vinagrete', -0.02, -0.02),
      ],
    },
  },
  {
    id: 'milanesa',
    label: 'Bife à milanesa',
    scene: {
      version: 1,
      plate: 'raso',
      placemat: true,
      parts: [
        part('arroz', -0.58, 0.12, 0, 1.45),
        part('feijao_caldo', 0.45, 0.55, 0, 1.15),
        part('milanesa', 0.4, -0.32, -12, 1.15),
        part('batata_frita', -0.08, 0.3, 0, 0.85),
        part('cumbuca_salada', -0.6, -2.05),
      ],
    },
  },
  {
    id: 'parmegiana',
    label: 'Parmegiana',
    scene: {
      version: 1,
      plate: 'raso',
      placemat: true,
      parts: [
        part('arroz', -0.58, -0.2, 0, 1.4),
        part('parmegiana', 0.35, -0.12, -10, 1.25),
        part('batata_frita', -0.25, 0.5, 30, 0.8),
        part('cumbuca_salada', -0.6, -2.05),
      ],
    },
  },
  {
    id: 'file-mignon',
    label: 'Filé mignon com legumes',
    scene: {
      version: 1,
      plate: 'raso',
      placemat: false,
      parts: [
        part('arroz', -0.52, -0.3, 0, 1.25),
        part('cumbuca_feijao', 0.5, -0.5),
        part('medalhao', 0.3, 0.2, 0, 1.15),
        part('batata_frita', -0.42, 0.45, 20, 0.85),
        part('legumes', 0, -0.05, 0, 0.9),
      ],
    },
  },
  {
    id: 'espaguete',
    label: 'Espaguete à bolonhesa',
    scene: {
      version: 1,
      plate: 'fundo',
      placemat: false,
      parts: [part('espaguete', 0, 0), part('bolonhesa', 0, 0), part('parmesao', 0, 0), part('manjericao', -0.05, -0.05)],
    },
  },
  {
    id: 'risoto',
    label: 'Risoto de cogumelos',
    scene: {
      version: 1,
      plate: 'fundo',
      placemat: false,
      parts: [part('risoto', 0, 0), part('cogumelos', 0, 0), part('lascas_parmesao', 0.05, -0.05), part('salsinha', 0, 0)],
    },
  },
  {
    id: 'salmao',
    label: 'Salmão grelhado',
    scene: {
      version: 1,
      plate: 'raso',
      placemat: false,
      parts: [
        part('aspargos', 0.1, 0.28, 9),
        part('salmao', -0.02, -0.08, 20),
        part('tomate_cereja', 0.5, -0.42),
        part('limao', -0.55, -0.42),
        part('molho_ervas', 0, 0),
      ],
    },
  },
  {
    id: 'petit-gateau',
    label: 'Petit gâteau',
    scene: {
      version: 1,
      plate: 'sobremesa',
      placemat: false,
      parts: [
        part('bolo_chocolate', -0.18, -0.05),
        part('centro_cremoso', -0.14, 0.3),
        part('sorvete', 0.42, -0.22),
        part('morangos', 0.38, 0.3),
        part('calda_chocolate', 0, 0),
      ],
    },
  },
]

export const emptyScene = (): Scene => ({ version: 1, plate: 'raso', placemat: false, parts: [] })
