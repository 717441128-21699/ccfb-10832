// 地址库内存索引、导入合并（改名/合并/撤销留历史，老名字持续可命中）
import type {
  AddressLibrary,
  AddressNode,
  HistoryEntry,
  Level,
} from './types'
import { FUZZY_ACCEPT, coreName, fuzzyScore } from './fuzzy'
import { homophoneSequence } from './data/homophones'
import { visualSequence } from './data/confusables'

export type NameKind = 'name' | 'alias' | 'history'

export interface NameEntry {
  nodeId: string
  level: Level
  kind: NameKind
  /** 用于同名歧义排序 */
  weight: number
}

export interface FuzzyHit {
  nodeId: string
  level: Level
  score: number
  kind: NameKind
  weight: number
}

/** unigram + bigram（短名主要靠 unigram 命中同音字块） */
function ngrams(s: string): string[] {
  const out = new Set<string>()
  for (const ch of s) out.add(ch)
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return [...out]
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

/** 查询文本各前缀的同音字键（长度 2~全文），容忍尾部多字/少字 */
function phoneticKeys(text: string): string[] {
  const full = homophoneSequence(text)
  const out = new Set<string>([full])
  for (let len = 2; len < text.length; len++) out.add(homophoneSequence(text.slice(0, len)))
  // 全文键本身按字符数对齐，再补一个去掉行政后缀的键
  return [...out]
}

function visualKeys(text: string): string[] {
  const full = visualSequence(text)
  const out = new Set<string>([full])
  for (let len = 2; len < text.length; len++) out.add(visualSequence(text.slice(0, len)))
  return [...out]
}

export class LibraryIndex {
  readonly lib: AddressLibrary
  /** 名称（含别名、历史名）-> 候选列表 */
  private byName = new Map<string, NameEntry[]>()
  /** 名称首字 -> 名称集合，解析时按窗口内出现的字快速取候选名 */
  private byFirstChar = new Map<string, Set<string>>()
  /** 同级候选，模糊匹配时遍历 */
  private byLevel: Record<Level, AddressNode[]> = {
    province: [], city: [], district: [], street: [], community: [],
  }
  /** n-gram 块索引：level -> gram -> 节点 id 集合，模糊匹配先过块再算距离 */
  private gramIndex: Record<Level, Map<string, Set<string>>> = {
    province: new Map(), city: new Map(), district: new Map(), street: new Map(), community: new Map(),
  }
  /** 同音字键索引：level -> 键序列 -> 名称条目（同音字错别字精确召回） */
  private phoneticIndex: Record<Level, Map<string, NameEntry[]>> = {
    province: new Map(), city: new Map(), district: new Map(), street: new Map(), community: new Map(),
  }
  /** 前缀读音键（去掉最后一个通名字后的核心读音），容忍后缀字写错 */
  private phoneticPrefixIndex: Record<Level, Map<string, NameEntry[]>> = {
    province: new Map(), city: new Map(), district: new Map(), street: new Map(), community: new Map(),
  }
  /** 形近字键索引：level -> 键序列 -> 名称条目（OCR 形近错误召回） */
  private visualIndex: Record<Level, Map<string, NameEntry[]>> = {
    province: new Map(), city: new Map(), district: new Map(), street: new Map(), community: new Map(),
  }

  constructor(lib: AddressLibrary) {
    this.lib = lib
    this.rebuild()
  }

  private rebuild(): void {
    this.byName.clear()
    for (const level of Object.keys(this.byLevel) as Level[]) {
      this.byLevel[level] = []
      this.gramIndex[level].clear()
      this.phoneticIndex[level].clear()
      this.phoneticPrefixIndex[level].clear()
      this.visualIndex[level].clear()
    }
    for (const node of Object.values(this.lib.nodes)) {
      this.byLevel[node.level].push(node)
      this.addName(node.name, node, 'name')
      for (const alias of node.aliases) this.addName(alias, node, 'alias')
      for (const h of node.history) this.addName(h.name, node, 'history')

      const allNames: Array<[string, NameKind]> = [
        [node.name, 'name'],
        ...node.aliases.map((a) => [a, 'alias'] as [string, NameKind]),
        ...node.history.map((h) => [h.name, 'history'] as [string, NameKind]),
      ]
      const grams = new Set<string>()
      const coreSet = new Set<string>()
      for (const [name, kind] of allNames) {
        for (const g of ngrams(name)) grams.add(g)
        const entry: NameEntry = { nodeId: node.id, level: node.level, kind, weight: node.weight }
        pushMap(this.phoneticIndex[node.level], homophoneSequence(name), entry)
        pushMap(this.visualIndex[node.level], visualSequence(name), entry)
        // 核心名（去通名后缀）的读音/形近键：路↔街、区↔县等后缀写错也能召回
        const core = coreName(name)
        if (core !== name && core.length >= 2 && !coreSet.has(core)) {
          coreSet.add(core)
          pushMap(this.phoneticIndex[node.level], homophoneSequence(core), entry)
          pushMap(this.visualIndex[node.level], visualSequence(core), entry)
        }
        // 前缀读音键：去掉名称最后一个字后的读音，容忍尾部单字错误（如 朝阳街→朝阳结）
        if (name.length >= 3) {
          pushMap(this.phoneticPrefixIndex[node.level], homophoneSequence(name.slice(0, -1)), entry)
        }
      }
      for (const g of grams) {
        const bucket = this.gramIndex[node.level].get(g) ?? new Set<string>()
        bucket.add(node.id)
        this.gramIndex[node.level].set(g, bucket)
      }
    }
    // 权重大的排前面，同名时优先返回
    for (const list of this.byName.values()) list.sort((a, b) => b.weight - a.weight)
  }

  private addName(name: string, node: AddressNode, kind: NameKind): void {
    if (!name) return
    const list = this.byName.get(name) ?? []
    list.push({ nodeId: node.id, level: node.level, kind, weight: node.weight })
    this.byName.set(name, list)
    const first = name[0]
    const bucket = this.byFirstChar.get(first) ?? new Set<string>()
    bucket.add(name)
    this.byFirstChar.set(first, bucket)
  }

  /**
   * 取文本窗口内出现的所有精确名称命中（只枚举窗口里出现过的首字对应的名称）。
   * 返回每个命中的名称、级别条目与位置。
   */
  findNamesInWindow(text: string, maxPos: number): Array<{ name: string; entry: NameEntry; pos: number }> {
    const out: Array<{ name: string; entry: NameEntry; pos: number }> = []
    const window = text.slice(0, Math.min(text.length, maxPos + 8))
    for (let pos = 0; pos < Math.min(window.length, maxPos + 1); pos++) {
      const bucket = this.byFirstChar.get(window[pos])
      if (!bucket) continue
      for (const name of bucket) {
        if (pos + name.length > window.length) continue
        if (window.startsWith(name, pos)) {
          for (const entry of this.byName.get(name) ?? []) {
            out.push({ name, entry, pos })
          }
        }
      }
    }
    return out
  }

  getNode(id: string | null | undefined): AddressNode | null {
    return (id && this.lib.nodes[id]) || null
  }

  childrenOf(id: string): AddressNode[] {
    return (this.lib.children[id] ?? []).map((cid) => this.lib.nodes[cid]).filter(Boolean)
  }

  /** 祖先链：从根到该节点 */
  ancestorChain(id: string): AddressNode[] {
    const chain: AddressNode[] = []
    let cur = this.getNode(id)
    const guard = new Set<string>()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      chain.unshift(cur)
      cur = this.getNode(cur.parentId)
    }
    return chain
  }

  /** 全限定路径名，如 广东省/深圳市/南山区/科技园路 */
  fullPath(id: string): string {
    return this.ancestorChain(id).map((n) => n.name).join('/')
  }

  /** 精确名称查找（名称/别名/历史名），同名返回多个候选 */
  lookupName(name: string): NameEntry[] {
    return this.byName.get(name) ?? []
  }

  hasName(name: string): boolean {
    return this.byName.has(name)
  }

  /**
   * 在限定父节点范围内精确查找某一级
   * @param scopeParentId 父节点 id；null 表示全局
   */
  findExact(level: Level, name: string, scopeParentId: string | null): NameEntry | null {
    const entries = this.lookupName(name)
    let best: NameEntry | null = null
    for (const e of entries) {
      if (e.level !== level) continue
      const node = this.getNode(e.nodeId)!
      if (scopeParentId !== null && node.parentId !== scopeParentId) continue
      if (!best || e.weight > best.weight) best = e
    }
    return best
  }

  /** 全局找某一级的精确名称（不限定父级），用于歧义词消解 */
  findExactGlobal(level: Level, name: string): NameEntry[] {
    return this.lookupName(name).filter((e) => e.level === level)
  }

  /**
   * 模糊查找某一级，限定在候选节点集合内（通常是某父节点的子树范围）。
   * 召回顺序：同音字键 -> 形近字键 -> n-gram 块，召回后逐个算模糊分。
   */
  findFuzzy(level: Level, text: string, scopeIds: Set<string> | null, limit = 5): FuzzyHit[] {
    if (!text) return []
    const candidateIds = new Set<string>()

    // 1) 读音键精确召回（对每个长度的前缀都试，容忍尾部字差异）
    for (const key of phoneticKeys(text)) {
      for (const e of this.phoneticIndex[level].get(key) ?? []) candidateIds.add(e.nodeId)
    }
    // 2) 形近键召回
    for (const key of visualKeys(text)) {
      for (const e of this.visualIndex[level].get(key) ?? []) candidateIds.add(e.nodeId)
    }
    // 3) n-gram 块召回兜底
    for (const id of this.gramCandidates(level, text)) candidateIds.add(id)

    const hits: FuzzyHit[] = []
    for (const id of candidateIds) {
      if (scopeIds && !scopeIds.has(id)) continue
      const node = this.lib.nodes[id]
      if (!node) continue
      const nameScore = fuzzyScore(text, node.name)
      let best = nameScore
      let kind: NameKind = 'name'
      for (const alias of node.aliases) {
        const s = fuzzyScore(text, alias)
        if (s > best) { best = s; kind = 'alias' }
      }
      for (const h of node.history) {
        const s = fuzzyScore(text, h.name)
        if (s > best) { best = s; kind = 'history' }
      }
      if (best >= FUZZY_ACCEPT) {
        hits.push({ nodeId: node.id, level, score: best, kind, weight: node.weight })
      }
    }
    hits.sort((a, b) => b.score - a.score || b.weight - a.weight)
    return hits.slice(0, limit)
  }

  /** n-gram 块召回：unigram 与 bigram 都收集，但给命中次数加权（parser 侧无法区分，这里取并集） */
  private gramCandidates(level: Level, text: string): Set<string> {
    const out = new Set<string>()
    const index = this.gramIndex[level]
    for (const g of ngrams(text)) {
      const bucket = index.get(g)
      if (!bucket) continue
      for (const id of bucket) out.add(id)
    }
    if (!out.size) for (const n of this.byLevel[level]) out.add(n.id)
    return out
  }

  /**
   * 按片段做键召回，带候选规模上限：
   * 读音键/形近键（高精度）优先；n-gram 兜底且限制数量，防止单字召回上千节点拖垮性能。
   */
  recallByPiece(level: Level, piece: string, gramLimit = 60): Set<string> {
    const out = new Set<string>()
    const addKey = (key: string, visual: boolean): void => {
      const index = visual ? this.visualIndex[level] : this.phoneticIndex[level]
      for (const e of index.get(key) ?? []) out.add(e.nodeId)
    }
    addKey(homophoneSequence(piece), false)
    addKey(visualSequence(piece), true)
    const core = coreName(piece)
    if (core !== piece && core.length >= 2) {
      addKey(homophoneSequence(core), false)
      addKey(visualSequence(core), true)
    }
    // 前缀读音键：容忍尾部一个字写错
    if (piece.length >= 3) {
      for (const e of this.phoneticPrefixIndex[level].get(homophoneSequence(piece.slice(0, -1))) ?? []) {
        out.add(e.nodeId)
      }
    }
    // 键召回已覆盖同音/形近主路径；gram 仅在键召回为空时兜底，且限量
    if (out.size === 0) {
      let count = 0
      for (const id of this.gramCandidates(level, piece)) {
        out.add(id)
        if (++count >= gramLimit) break
      }
    }
    return out
  }

  /** 某节点子树内所有指定级别的节点 id（用于缩小模糊搜索范围） */
  subtreeIds(rootId: string, level: Level): Set<string> {
    const out = new Set<string>()
    const walk = (id: string): void => {
      const node = this.getNode(id)
      if (!node) return
      if (node.level === level) out.add(id)
      for (const cid of this.lib.children[id] ?? []) walk(cid)
    }
    walk(rootId)
    return out
  }

  /** 某一级所有节点 */
  levelNodes(level: Level): AddressNode[] {
    return this.byLevel[level]
  }

  get stats(): Record<Level, number> {
    return {
      province: this.byLevel.province.length,
      city: this.byLevel.city.length,
      district: this.byLevel.district.length,
      street: this.byLevel.street.length,
      community: this.byLevel.community.length,
    }
  }
}

/* ---------------- 导入合并 ---------------- */

/** 导入行格式（CSV/JSON 行通用） */
export interface ImportRow {
  level: Level
  name: string
  code?: string
  parentCode?: string
  aliases?: string
  historyName?: string
  historyOp?: HistoryEntry['op']
  historyNote?: string
  /** revoke 表示撤销节点，仍保留在库中可被老名字命中 */
  status?: 'active' | 'revoke'
}

export interface ImportReport {
  version: number
  added: number
  renamed: number
  merged: number
  revoked: number
  warnings: string[]
}

/**
 * 把外部导入行合并进地址库：
 * - code 已存在 -> 更新，老名称自动进 history（改名留痕）
 * - 新 code -> 新增
 * - 带 historyName 的行把老名字登记到目标节点
 * - status=revoke 不删除节点，仅打权重并保留历史
 * 整个过程产生新版本，旧版本由存储层保留，可回溯。
 */
export function mergeImportRows(lib: AddressLibrary, rows: ImportRow[], source: string): {
  lib: AddressLibrary
  report: ImportReport
} {
  // 深拷贝，避免改到旧版本
  const next: AddressLibrary = structuredClone(lib)
  next.version = lib.version + 1
  next.importedAt = new Date().toISOString()
  next.source = source

  const report: ImportReport = {
    version: next.version,
    added: 0, renamed: 0, merged: 0, revoked: 0, warnings: [],
  }
  const codeToId = new Map<string, string>()
  for (const [id, node] of Object.entries(next.nodes)) codeToId.set(node.code, id)

  const ensureChild = (parentId: string | null, childId: string): void => {
    if (parentId === null) return
    if (!next.children[parentId]) next.children[parentId] = []
    if (!next.children[parentId].includes(childId)) next.children[parentId].push(childId)
  }

  for (const row of rows) {
    if (!row.name || !row.level) {
      report.warnings.push('跳过缺名称/级别的行: ' + JSON.stringify(row))
      continue
    }
    const aliases = row.aliases
      ?.split(/[;；,，]/).map((s) => s.trim()).filter(Boolean) ?? []

    // 历史名登记到已有节点
    if (row.historyName) {
      const targetId = row.code ? codeToId.get(row.code) : undefined
      const target = targetId ? next.nodes[targetId] : undefined
      if (target) {
        const entry: HistoryEntry = {
          name: row.historyName,
          op: row.historyOp ?? 'rename',
          note: row.historyNote,
        }
        if (!target.history.some((h) => h.name === entry.name)) {
          target.history.push(entry)
          report.renamed++
        }
        if (row.historyOp === 'merge') report.merged++
      } else {
        report.warnings.push(`历史名「${row.historyName}」找不到 code=${row.code} 对应节点`)
      }
    }

    const existingId = row.code ? codeToId.get(row.code) : undefined
    if (existingId) {
      const node = next.nodes[existingId]
      if (node.name !== row.name) {
        // 改名：现名进历史
        if (!node.history.some((h) => h.name === node.name)) {
          node.history.push({ name: node.name, op: 'rename', note: '导入时发现改名' })
        }
        node.name = row.name
        report.renamed++
      }
      for (const a of aliases) if (!node.aliases.includes(a)) node.aliases.push(a)
      if (row.status === 'revoke') {
        node.weight = 1
        report.revoked++
      }
      continue
    }

    // 新增节点
    const parentId = row.parentCode ? codeToId.get(row.parentCode) ?? null : null
    const id = `imp${pad(next.version, 2)}_${row.level}_${codeToId.size}`
    const node: AddressNode = {
      id,
      level: row.level,
      name: row.name,
      code: row.code ?? `X${codeToId.size}`,
      parentId,
      aliases,
      history: row.historyName
        ? [{ name: row.historyName, op: row.historyOp ?? 'rename', note: row.historyNote }]
        : [],
      weight: row.status === 'revoke' ? 1 : 50,
    }
    next.nodes[id] = node
    codeToId.set(node.code, id)
    ensureChild(parentId, id)
    report.added++
    if (row.status === 'revoke') report.revoked++
  }

  return { lib: next, report }
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

/** 极简 CSV 解析（支持引号包裹、逗号/分号分隔） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',' || ch === ';') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row) }
  return rows
}

/** CSV 文本 -> 导入行（表头需包含 level,name,code,parentCode,aliases,historyName,historyOp,historyNote,status） */
export function csvToImportRows(text: string): ImportRow[] {
  const rows = parseCsv(text)
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim())
  const idx = (k: string): number => header.indexOf(k)
  const out: ImportRow[] = []
  for (const r of rows.slice(1)) {
    const get = (k: string): string => {
      const i = idx(k)
      return i >= 0 ? (r[i] ?? '').trim() : ''
    }
    const level = get('level') as Level
    if (!level) continue
    out.push({
      level,
      name: get('name'),
      code: get('code') || undefined,
      parentCode: get('parentCode') || undefined,
      aliases: get('aliases') || undefined,
      historyName: get('historyName') || undefined,
      historyOp: (get('historyOp') as HistoryEntry['op']) || undefined,
      historyNote: get('historyNote') || undefined,
      status: (get('status') as 'active' | 'revoke') || undefined,
    })
  }
  return out
}

export const IMPORT_CSV_TEMPLATE = [
  'level,name,code,parentCode,aliases,historyName,historyOp,historyNote,status',
  'district,临平区,330113,330100,临平,余杭县,rename,2021年析置,active',
  'street,科苑大道,330113001,330113,科苑路,,rename,道路更名,active',
].join('\n')
