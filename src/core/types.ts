// 地址库与解析器公共类型定义

/** 行政级别 */
export type Level = 'province' | 'city' | 'district' | 'street' | 'community'

export const LEVEL_ORDER: Level[] = ['province', 'city', 'district', 'street', 'community']

export const LEVEL_LABEL: Record<Level, string> = {
  province: '省',
  city: '市',
  district: '区/县',
  street: '街道/路',
  community: '小区/村',
}

/** 历史变更类型 */
export type HistoryOp = 'rename' | 'merge' | 'split' | 'revoke' | 'establish'

/** 历史名称（老名字也认得的依据） */
export interface HistoryEntry {
  /** 曾经使用过的名称（可直接出现在面单上） */
  name: string
  op: HistoryOp
  /** 生效年份，用于推断新旧 */
  year?: number
  /** 合并/拆分时关联的节点 id */
  relatedId?: string
  note?: string
}

/** 地址库节点 */
export interface AddressNode {
  id: string
  level: Level
  name: string
  /** 行政代码（模拟国标代码，可作为编码兜底） */
  code: string
  parentId: string | null
  /** 别名/简称（含不带后缀的短名，如 朝阳、海淀） */
  aliases: string[]
  /** 历史名称与变更记录 */
  history: HistoryEntry[]
  /** 排序权重，同名时用 */
  weight: number
}

/** 地址库快照（带版本，导入即生成新版本，历史不丢） */
export interface AddressLibrary {
  version: number
  importedAt: string
  source: string
  nodes: Record<string, AddressNode>
  /** 层级关系：parentId -> 子 id 列表 */
  children: Record<string, string[]>
}

/** 门址结构化部分 */
export interface DoorInfo {
  building: string | null
  unit: string | null
  room: string | null
  /** 原始门牌片段，如 12号3单元502 */
  raw: string | null
}

/** 一个级别的解析命中 */
export interface LevelMatch {
  level: Level
  nodeId: string | null
  name: string | null
  /** 命中在原文中的位置 */
  span: [number, number] | null
  /** 精确 exact / 别名 alias / 历史名 history / 模糊 fuzzy / 上下文推断 inferred */
  matchType: 'exact' | 'alias' | 'history' | 'fuzzy' | 'inferred' | null
  confidence: number
  /** 候选（同名歧义时多个） */
  candidates: string[]
}

/** 解析轨迹的一步（单条调试用） */
export interface TraceStep {
  step: number
  title: string
  detail: string
  /** 当时的中间文本 */
  text?: string
  /** 关键数据快照 */
  data?: unknown
}

/** 单条解析结果 */
export interface ParseResult {
  id: string
  raw: string
  normalized: string
  province: LevelMatch
  city: LevelMatch
  district: LevelMatch
  street: LevelMatch
  community: LevelMatch
  door: DoorInfo
  /** 整体置信度 0~1 */
  confidence: number
  /** 格口编码（规则引擎产出） */
  slot: string | null
  matchedRuleId: string | null
  trace: TraceStep[]
  /** 耗时（毫秒） */
  elapsedMs: number
}

/** 低置信度判定阈值等解析参数 */
export interface ParseOptions {
  lowConfidenceThreshold: number
  /** 是否启用模糊（错别字/同音字）匹配 */
  fuzzyEnabled: boolean
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  lowConfidenceThreshold: 0.85,
  fuzzyEnabled: true,
}
