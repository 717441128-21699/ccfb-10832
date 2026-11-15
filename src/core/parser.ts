// 地址解析主流程（两遍解析）：
// 第一遍 精确扫描：在全文窗口内按级别收集所有 名称/别名/历史名 的精确命中，
//   用父子链一致性选出一条最连贯的链（锚点），杜绝级联断链与跨子树误配。
// 第二遍 模糊补全：对锚点中缺失的级别，严格在已确定父节点的子树内做同音/形近/编辑距离匹配；
//   父级也缺失时先由更深的精确锚点反推祖先，再补模糊。
// 最后回填缺失级别、计算分级置信度并记录完整 trace。
import { LibraryIndex, type FuzzyHit, type NameEntry } from './library'
import { normalize } from './normalize'
import { parseDoor } from './door'
import { fuzzyConfidence, fuzzyScore, FUZZY_ACCEPT_BY_LEVEL } from './fuzzy'
import type {
  Level,
  LevelMatch,
  ParseOptions,
  ParseResult,
  TraceStep,
} from './types'
import { DEFAULT_PARSE_OPTIONS, LEVEL_ORDER } from './types'

interface MatchState {
  nodeId: string | null
  name: string | null
  span: [number, number] | null
  matchType: LevelMatch['matchType']
  confidence: number
  candidates: string[]
}

interface ExactHit {
  level: Level
  nodeId: string
  kind: NameEntry['kind']
  pos: number
  len: number
  matchedText: string
  weight: number
}

interface FuzzyFound {
  hit: FuzzyHit
  pos: number
  len: number
  text: string
}

const SEARCH_WINDOW = 12
const CONNECTOR = /^(附近|对面|旁边|往东|往西|往南|往北|交叉口|交汇处|路口|段|巷|弄|里|的)+/

const blankState = (): MatchState => ({
  nodeId: null, name: null, span: null, matchType: null, confidence: 0, candidates: [],
})

const emptyMatch = (level: Level): LevelMatch => ({
  level, nodeId: null, name: null, span: null, matchType: null, confidence: 0, candidates: [],
})

type StateMap = Record<Level, MatchState>

export class AddressParser {
  private idx: LibraryIndex
  private opts: ParseOptions
  private trace: TraceStep[] = []
  private stepNo = 0
  private states: StateMap = {
    province: blankState(), city: blankState(), district: blankState(),
    street: blankState(), community: blankState(),
  }

  constructor(idx: LibraryIndex, opts: Partial<ParseOptions> = {}) {
    this.idx = idx
    this.opts = { ...DEFAULT_PARSE_OPTIONS, ...opts }
  }

  private log(title: string, detail: string, text?: string, data?: unknown): void {
    this.trace.push({ step: ++this.stepNo, title, detail, text, data })
  }

  parse(raw: string, id = '1'): ParseResult {
    const t0 = performance.now()
    this.trace = []
    this.stepNo = 0
    this.deferredCommunity = []
    this.ambiguousStreets = []
    this.states = {
      province: blankState(), city: blankState(), district: blankState(),
      street: blankState(), community: blankState(),
    }

    const norm = normalize(raw)
    for (const s of norm.steps) this.log(`文本规范化：${s.label}`, `「${s.before}」→「${s.after}」`)
    const normalized = norm.text

    const doorRes = parseDoor(normalized)
    if (doorRes.door.raw) {
      this.log(
        '门牌抽取',
        `楼栋=${doorRes.door.building ?? '-'} 单元=${doorRes.door.unit ?? '-'} 房号=${doorRes.door.room ?? '-'}`,
        doorRes.door.raw, doorRes.door,
      )
    }
    const body = doorRes.consumed ? normalized.replace(doorRes.consumed, '') : normalized

    // ===== 第一遍：全文精确扫描，建立锚点链（小区延迟，不反推街道） =====
    const anchors = this.scanExact(body)
    this.applyAnchors(anchors, body)

    // ===== 第二遍 A：先补省/市/区模糊，避免街道同名锚点反推出错误的区 =====
    // 行政级名称在地址前部，必须用原始 body 的开头窗口扫描（不能用锚点之后的剩余文本，
    // 否则会漏掉位于街道锚点之前的错字区名，如 武汉姜汉区...街道）
    this.fillAdminByFuzzy(body)
    // 区县复核需要原始文本的绝对位置，不能用截断后的 fuzzyBody
    this.recheckDistrict(body)

    // 行政级确定后，再由精确街道锚点反推仍缺失的区（此时区若已有模糊证据则保留）
    this.pullAncestorsFromAnchors()

    // ===== 第二遍 B：补街道/小区模糊，并消解延迟的小区锚点 =====
    // 街道/小区在地址后部，用锚点之后的剩余文本扫描
    const fuzzyBody = this.remainderAfterAnchors(body)
    this.fillLowerByFuzzy(fuzzyBody)

    // ===== 回填 =====
    this.backfill()

    const remainder = this.computeRemainder(body)
    if (remainder) this.log('未消费文本', `剩余「${remainder}」未匹配任何地址库节点`, remainder)

    const matches = this.toLevelMatches()
    const confidence = this.overallConfidence(doorRes.door)
    return {
      id, raw, normalized,
      province: matches.province, city: matches.city, district: matches.district,
      street: matches.street, community: matches.community,
      door: doorRes.door, confidence,
      slot: null, matchedRuleId: null,
      trace: this.trace,
      elapsedMs: performance.now() - t0,
    }
  }

  /* ============ 第一遍：精确扫描 + 链一致性选择 ============ */

  /** 全文扫描各级精确命中；同位置保留所有同名节点，消解交给链一致性选择 */
  private scanExact(text: string): ExactHit[] {
    const raw: ExactHit[] = []
    for (const found of this.idx.findNamesInWindow(text, SEARCH_WINDOW)) {
      const node = this.idx.getNode(found.entry.nodeId)
      if (!node) continue
      raw.push({
        level: found.entry.level,
        nodeId: found.entry.nodeId,
        kind: found.entry.kind,
        pos: found.pos,
        len: found.name.length,
        matchedText: found.name,
        weight: found.entry.weight,
      })
    }
    // 子串误命中过滤：同一位置若存在更长的名称，短名称视为嵌在词内部（市南@南程街道）予以剔除
    const hits = raw.filter((h) => {
      const longer = raw.some(
        (o) => o !== h && o.pos <= h.pos && o.pos + o.len >= h.pos + h.len && (o.len > h.len || o.pos < h.pos),
      )
      return !longer
    })
    this.log(
      '第一遍精确扫描',
      `全文发现 ${hits.length} 个精确名称命中（含同名候选），进入父子链一致性选择`,
      text,
    )
    return hits
  }

  /** 用父子链一致性从锚点里挑出一条最连贯的链 */
  private applyAnchors(hits: ExactHit[], body: string): void {
    const byLevel = new Map<Level, ExactHit[]>()
    for (const h of hits) {
      const arr = byLevel.get(h.level) ?? []
      arr.push(h)
      byLevel.set(h.level, arr)
    }
    for (const arr of byLevel.values()) arr.sort((a, b) => a.pos - b.pos)

    const selected = new Map<Level, ExactHit>()
    // 第一阶段：省/市/区/街道 逐级链选择
    for (const level of ['province', 'city', 'district', 'street'] as Level[]) {
      let candidates = byLevel.get(level)
      if (!candidates?.length) continue
      // 位置单调约束：该级锚点必须严格出现在上一已选级别之后（中文地址按省→市→区→路顺序书写），
      // 过滤掉在更长名称中间误命中的子串（如 南程街道 里误命中 市南区/市南）
      const prevLevel = parentOf(level)
      const prevHit = prevLevel ? selected.get(prevLevel) : null
      if (prevHit) {
        const ordered = candidates.filter((h) => h.pos > prevHit.pos)
        if (ordered.length) candidates = ordered
      }
      const knownAncestors = LEVEL_ORDER
        .filter((l) => LEVEL_ORDER.indexOf(l) < LEVEL_ORDER.indexOf(level))
        .map((l) => selected.get(l)?.nodeId)
        .filter(Boolean) as string[]
      let pickHit: ExactHit | null = null
      let consistent: ExactHit[] = []
      if (knownAncestors.length) {
        consistent = candidates.filter((h) => knownAncestors.every((aid) => this.isDescendant(h.nodeId, aid)))
        if (consistent.length) pickHit = this.rankCandidates(consistent)[0]
      }
      // 街道缺区且城市子树内有多条同名候选：记录歧义，交给小区锚点投票
      if (level === 'street' && !selected.get('district') && consistent.length > 1) {
        this.ambiguousStreets = this.rankCandidates(consistent)
      }
      // 作用域内无一致候选时，不要从全集选外地节点（会违反已确定的省/市），
      // 留空交给后续模糊/回填，避免跨子树误锚定
      if (!pickHit && knownAncestors.length && consistent.length === 0) continue
      if (!pickHit) pickHit = this.bestByChainCoherence(candidates, selected)
      if (pickHit) selected.set(level, pickHit)
    }

    // 第二阶段：小区锚点
    // 只有街道已精确锚定时才立即写入；否则一律延迟到街道（精确或模糊）确定后再消解，
    // 杜绝同名小区在缺街道时反推锁死错误街道
    const commCandidates = byLevel.get('community')
    if (commCandidates?.length) {
      const streetId = selected.get('street')?.nodeId ?? null
      if (streetId) {
        const inScope = commCandidates.filter((h) => this.isDescendant(h.nodeId, streetId))
        const pool = inScope.length ? inScope : commCandidates
        selected.set('community', this.rankCandidates(pool)[0])
        this.deferredCommunity = this.rankCandidates(pool)
      } else {
        // 区作用域内的候选优先记录，但不写入 states
        const districtId = selected.get('district')?.nodeId ?? null
        const inScope = districtId
          ? commCandidates.filter((h) => this.isDescendant(h.nodeId, districtId))
          : commCandidates
        this.deferredCommunity = this.rankCandidates(inScope.length ? inScope : commCandidates)
      }
    }

    for (const level of ['province', 'city', 'district', 'street'] as Level[]) {
      const h = selected.get(level)
      if (h) this.writeExact(level, h, body)
    }
    // 小区仅在街道已精确锚定时立即写入
    if (selected.get('street') && selected.has('community')) {
      this.writeExact('community', selected.get('community')!, body)
    }
  }

  /** 延迟选择的小区候选（街道模糊确定后再消解） */
  private deferredCommunity: ExactHit[] = []
  /** 缺区时城市子树内的同名街道候选（由小区锚点投票消解） */
  private ambiguousStreets: ExactHit[] = []

  /** 同级别候选排序：名称>别名>历史，再比位置靠前、权重大 */
  private rankCandidates(list: ExactHit[]): ExactHit[] {
    const kindRank: Record<NameEntry['kind'], number> = { name: 3, alias: 2, history: 1 }
    return [...list].sort((a, b) =>
      kindRank[b.kind] - kindRank[a.kind] ||
      a.pos - b.pos ||
      b.weight - a.weight,
    )
  }

  /** 节点是否为 ancestorId 的后代 */
  private isDescendant(nodeId: string, ancestorId: string): boolean {
    let cur = this.idx.getNode(nodeId)?.parentId ?? null
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      if (cur === ancestorId) return true
      guard.add(cur)
      cur = this.idx.getNode(cur)?.parentId ?? null
    }
    return false
  }

  /** 与已选锚点的链相关度评分，选最连贯的候选 */
  private bestByChainCoherence(candidates: ExactHit[], selected: Map<Level, ExactHit>): ExactHit {
    let best = candidates[0]
    let bestScore = -Infinity
    const knownIds = [...selected.values()].map((h) => h.nodeId)
    for (const h of candidates) {
      const chain = new Set(this.idx.ancestorChain(h.nodeId).map((n) => n.id))
      let score = 0
      for (const id of knownIds) if (chain.has(id)) score += 10
      // 位置越靠前、名称越长越优先
      score += (SEARCH_WINDOW - h.pos) * 0.01 + h.len * 0.01 + h.weight / 10000
      if (score > bestScore) { bestScore = score; best = h }
    }
    return best
  }

  /** 精确锚点反推祖先，并对同名歧义记录 trace */
  /**
   * 允许的反推方向（信息只能自上而下，深层节点不能跨级编造高层行政区划）：
   * district -> city/province，city -> province；street/community 不反推省、市。
   */
  private canInfer(fromLevel: Level, toLevel: Level): boolean {
    if (fromLevel === 'community' || fromLevel === 'street') {
      return toLevel === 'district' || toLevel === 'street'
    }
    return true
  }

  private pullAncestorsFromAnchors(): void {
    for (const level of [...LEVEL_ORDER].reverse()) {
      const st = this.states[level]
      if (!st.nodeId) continue
      for (const ancestor of this.idx.ancestorChain(st.nodeId)) {
        if (ancestor.id === st.nodeId) continue
        if (!this.canInfer(level, ancestor.level)) continue
        const target = this.states[ancestor.level]
        if (target.nodeId) continue
        target.nodeId = ancestor.id
        target.name = ancestor.name
        target.matchType = 'inferred'
        target.span = null
        target.confidence = 0.82
        target.candidates = [this.idx.fullPath(ancestor.id)]
        this.log(
          `祖先反推：${ancestor.level}`,
          `由精确锚点「${st.name}」反推出缺失的「${ancestor.name}」（置信度 ${target.confidence}）`,
        )
      }
    }
  }

  /** 取最后一个精确锚点之后的文本作为模糊扫描输入（锚点本身已确定，无需再扫） */
  private remainderAfterAnchors(body: string): string {
    const spans = LEVEL_ORDER.map((l) => this.states[l].span).filter(Boolean) as [number, number][]
    if (!spans.length) return body
    const maxEnd = Math.max(...spans.map((s) => s[1]))
    return body.slice(Math.min(maxEnd, body.length))
  }

  /* ============ 第二遍：作用域内模糊补全 ============ */

  /** 第二遍 A：省/市/区 行政级模糊补全（在街道锚点反推之前） */
  private fillAdminByFuzzy(body: string): void {
    if (!this.opts.fuzzyEnabled) return
    for (const level of ['province', 'city', 'district'] as Level[]) {
      if (this.states[level].nodeId) continue
      const parentLevel = parentOf(level)
      const parentId = parentLevel ? this.states[parentLevel].nodeId : null
      const scope = this.resolveScope(level, parentId)
      const found = this.scanFuzzy(level, body, scope)
      if (!found) continue
      // 无直接父级、用祖先作用域时，要求命中节点在已知锚点的共同子树内
      if (!parentId && !this.coherentWithAnchors(found.hit.nodeId)) continue
      this.applyFuzzy(level, found)
      this.log(
        `${LEVEL_LABEL(level)}模糊补全`,
        parentId
          ? `在「${this.idx.getNode(parentId)!.name}」作用域内命中「${this.nodeName(found.hit.nodeId)}」相似度=${found.hit.score.toFixed(2)}`
          : `全局模糊命中「${this.nodeName(found.hit.nodeId)}」相似度=${found.hit.score.toFixed(2)}`,
        body,
      )
      this.pullSingleAncestors(level, found.hit.nodeId)
    }
  }

  /**
   * 区县复核：当区是通过短别名精确命中、可能是更长词的子串误命中时（如 市南@南程街道），
   * 在城市作用域内对同位置重新模糊，若出现明显更高分的区则替换。
   */
  private recheckDistrict(body: string): void {
    if (!this.opts.fuzzyEnabled) return
    const st = this.states.district
    if (!st.nodeId || !st.span) return
    const cityId = this.states.city.nodeId
    if (!cityId) return
    const scope = this.idx.subtreeIds(cityId, 'district')
    const found = this.scanFuzzyAt('district', body, st.span[0], scope)
    if (!found) return
    // 仅当模糊候选是不同节点、且分数足够高（强证据）时才推翻精确别名
    if (found.hit.nodeId === st.nodeId) return
    if (found.hit.score < 0.9) {
      this.log('区县复核', `同位置模糊最佳「${this.nodeName(found.hit.nodeId)}」相似度=${found.hit.score.toFixed(2)} 证据不足，保留「${st.name}」`)
      return
    }
    const oldName = st.name
    this.applyFuzzy('district', found)
    this.pullSingleAncestors('district', found.hit.nodeId)
    this.log('区县复核纠正', `区别名「${oldName}」疑似子串误命中，按模糊强证据改判为「${this.nodeName(found.hit.nodeId)}」相似度=${found.hit.score.toFixed(2)}`)
  }

  /** 在指定起始位置附近做一次模糊匹配 */
  private scanFuzzyAt(level: Level, text: string, atPos: number, scope: Set<string> | null): FuzzyFound | null {
    const window = text.slice(Math.max(0, atPos - 1), atPos + 10)
    let best: FuzzyFound | null = null
    for (let len = 2; len <= Math.min(8, window.length); len++) {
      for (let pos = 0; pos + len <= window.length; pos++) {
        const piece = window.slice(pos, pos + len)
        for (const nodeId of this.idx.recallByPiece(level, piece)) {
          if (scope && !scope.has(nodeId)) continue
          const node = this.idx.getNode(nodeId)
          if (!node) continue
          const names: Array<[string, NameEntry['kind']]> = [
            [node.name, 'name'],
            ...node.aliases.map((a) => [a, 'alias'] as [string, NameEntry['kind']]),
            ...node.history.map((h) => [h.name, 'history'] as [string, NameEntry['kind']]),
          ]
          for (const [name, kind] of names) {
            if (Math.abs(piece.length - name.length) > 1) continue
            const s = fuzzyScore(piece, name)
            if (s >= FUZZY_ACCEPT_BY_LEVEL[level] && (!best || s > best.hit.score)) {
              best = { hit: { nodeId: node.id, level, score: s, kind, weight: node.weight }, pos: atPos, len, text: piece }
            }
          }
        }
      }
    }
    return best
  }

  /** 第二遍 B：街道/小区模糊补全 + 延迟小区锚点消解 */
  private fillLowerByFuzzy(body: string): void {
    if (!this.opts.fuzzyEnabled) return

    // 先做歧义街道投票：缺区时，用小区锚点落在哪个街道子树来消解同名路
    this.resolveAmbiguousStreet()

    for (const level of ['street', 'community'] as Level[]) {
      if (this.states[level].nodeId) continue
      const parentLevel = parentOf(level)
      const parentId = parentLevel ? this.states[parentLevel].nodeId : null

      // 小区：仅当街道已确定（精确或模糊）时才消解延迟的小区精确锚点；
      // 街道缺失时不允许小区反推街道，跳过延迟路径走作用域模糊
      if (level === 'community' && this.deferredCommunity.length && this.states.street.nodeId) {
        const streetId = this.states.street.nodeId
        const pool = this.deferredCommunity.filter((h) => this.isDescendant(h.nodeId, streetId))
        const chosen = this.rankCandidates(pool)[0]
        if (chosen) {
          this.writeExact('community', chosen, body)
          this.log('小区锚点消解', `街道确定后，在其作用域内选定「${this.nodeName(chosen.nodeId)}」`)
          continue
        }
      }

      const scope = this.resolveScope(level, parentId)
      const found = this.scanFuzzy(level, body, scope)
      if (!found) continue
      // 无直接父级、用祖先作用域时，要求命中节点在已知锚点的共同子树内
      if (!parentId && !this.coherentWithAnchors(found.hit.nodeId)) continue
      this.applyFuzzy(level, found)
      this.log(
        `${LEVEL_LABEL(level)}模糊补全`,
        parentId
          ? `在「${this.idx.getNode(parentId)!.name}」作用域内由同音/形近/编辑距离命中「${this.nodeName(found.hit.nodeId)}」相似度=${found.hit.score.toFixed(2)}`
          : `全局模糊命中「${this.nodeName(found.hit.nodeId)}」且与深层锚点链一致，相似度=${found.hit.score.toFixed(2)}`,
        body,
      )
      this.pullSingleAncestors(level, found.hit.nodeId)
    }
  }

  /**
   * 解析某级别的搜索作用域：
   * 直接父级已知 -> 父级子树；父级缺失 -> 向上找最近的已知祖先（如区缺失时街道用城市子树），
   * 都没有才返回 null（全局）。
   */
  private resolveScope(level: Level, directParentId: string | null): Set<string> | null {
    if (directParentId) return this.idx.subtreeIds(directParentId, level)
    const li = LEVEL_ORDER.indexOf(level)
    for (let i = li - 1; i >= 0; i--) {
      const ancestorId = this.states[LEVEL_ORDER[i]].nodeId
      if (ancestorId) return this.idx.subtreeIds(ancestorId, level)
    }
    return null
  }

  /** 缺区同名路消解：统计每个歧义街道能解释多少个位置靠后的小区锚点 */
  private resolveAmbiguousStreet(): void {
    if (!this.ambiguousStreets.length || !this.deferredCommunity.length) return
    let best: ExactHit | null = null
    let bestVotes = 0
    let tie = false
    for (const sh of this.ambiguousStreets) {
      let votes = 0
      for (const ch of this.deferredCommunity) {
        if (ch.pos > sh.pos && this.isDescendant(ch.nodeId, sh.nodeId)) votes++
      }
      if (votes > bestVotes) { bestVotes = votes; best = sh; tie = false }
      else if (votes === bestVotes && votes > 0) tie = true
    }
    // 仅在有明确票数且无并列时改判，避免噪声
    if (best && bestVotes > 0 && !tie) {
      const current = this.states.street.nodeId
      this.writeExact('street', best, '')
      this.pullSingleAncestors('street', best.nodeId)
      if (current !== best.nodeId) {
        this.log('同名路联合消解', `缺区情况下，由小区锚点投票（${bestVotes} 票）选定街道「${this.nodeName(best.nodeId)}」`)
      }
    }
  }

  /** 模糊命中节点的祖先链是否与现有精确锚点兼容 */
  private coherentWithAnchors(nodeId: string): boolean {
    const chain = new Set(this.idx.ancestorChain(nodeId).map((n) => n.id))
    for (const level of LEVEL_ORDER) {
      const known = this.states[level].nodeId
      // 只要求精确/别名/历史锚点一致；inferred 的不做强约束
      if (known && this.states[level].matchType !== 'inferred' && !chain.has(known)) return false
    }
    return true
  }

  private pullSingleAncestors(level: Level, nodeId: string): void {
    for (const ancestor of this.idx.ancestorChain(nodeId)) {
      if (ancestor.level === level || ancestor.id === nodeId) continue
      if (!this.canInfer(level, ancestor.level)) continue
      const target = this.states[ancestor.level]
      if (target.nodeId) continue
      target.nodeId = ancestor.id
      target.name = ancestor.name
      target.matchType = 'inferred'
      target.span = null
      target.confidence = 0.78
      target.candidates = [this.idx.fullPath(ancestor.id)]
      this.log(`祖先反推：${ancestor.level}`, `由模糊命中的「${this.nodeName(nodeId)}」反推出「${ancestor.name}」`)
    }
  }

  /**
   * 窗口内模糊匹配，严格作用域。
   * 性能策略：只在窗口前 4 个位置起查；先按读音/形近键 O(1) 召回（同音错字主路径），
   * 块召回兜底，编辑距离仅在召回后的小候选集上计算。
   */
  private scanFuzzy(level: Level, text: string, scope: Set<string> | null): FuzzyFound | null {
    const window = text.slice(0, SEARCH_WINDOW + 2)
    let best: FuzzyFound | null = null
    const maxStart = Math.min(6, window.length - 2)
    // 名称长度区间：街道/小区 3~6，区 2~4，市 2~4，省 2~6
    const nameLenRange: Record<Level, [number, number]> = {
      province: [2, 6], city: [2, 5], district: [2, 5], street: [3, 6], community: [3, 8],
    }
    const [minNameLen, maxNameLen] = nameLenRange[level]

    for (let pos = 0; pos <= maxStart; pos++) {
      for (let len = minNameLen; len <= Math.min(maxNameLen, window.length - pos); len++) {
        const piece = window.slice(pos, pos + len)
        const candidateIds = this.idx.recallByPiece(level, piece)
        for (const nodeId of candidateIds) {
          if (scope && !scope.has(nodeId)) continue
          const node = this.idx.getNode(nodeId)
          if (!node) continue
          const names: Array<[string, NameEntry['kind']]> = [
            [node.name, 'name'],
            ...node.aliases.map((a) => [a, 'alias'] as [string, NameEntry['kind']]),
            ...node.history.map((h) => [h.name, 'history'] as [string, NameEntry['kind']]),
          ]
          for (const [name, kind] of names) {
            if (Math.abs(piece.length - name.length) > 1) continue
            const s = fuzzyScore(piece, name)
            if (s >= FUZZY_ACCEPT_BY_LEVEL[level] && (!best || s > best.hit.score)) {
              best = { hit: { nodeId: node.id, level, score: s, kind, weight: node.weight }, pos, len, text: piece }
            }
          }
        }
      }
    }
    return best
  }

  /* ============ 状态写入与回填 ============ */

  private nodeName(id: string | null): string {
    return (id && this.idx.getNode(id)?.name) ?? '?'
  }

  private writeExact(level: Level, h: ExactHit, body: string): void {
    const node = this.idx.getNode(h.nodeId)!
    const st = this.states[level]
    st.nodeId = node.id
    st.name = node.name
    st.matchType = h.kind === 'name' ? 'exact' : h.kind
    let conf = h.kind === 'name' ? 0.98 : h.kind === 'alias' ? 0.94 : 0.9
    st.span = [h.pos, h.pos + h.len]
    st.candidates = this.idx.findExactGlobal(level, h.matchedText).map((e) => this.idx.fullPath(e.nodeId))
    const sameName = st.candidates.length
    // 同名歧义且缺少直接父级约束（如缺区时选街道）：置信度打折，便于低置信度拦截
    if (sameName > 1) {
      const parentLevel = parentOf(level)
      const parentKnown = parentLevel ? this.states[parentLevel].nodeId !== null : true
      if (!parentKnown) conf = Math.min(conf, 0.78)
      else conf = Math.min(conf, 0.9)
    }
    st.confidence = conf
    const kindLabel = h.kind === 'name' ? '精确' : h.kind === 'alias' ? '别名/简称' : '历史老名'
    if (sameName > 1) {
      this.log(
        '同名歧义消解',
        `「${h.matchedText}」有 ${sameName} 条同名记录，依据父子链一致性选定：${this.idx.fullPath(node.id)}（置信度 ${conf}）`,
        body, st.candidates,
      )
    } else {
      this.log(`${LEVEL_LABEL(level)}锚点`, `${kindLabel}命中「${node.name}」（置信度 ${st.confidence}）`)
    }
  }

  private applyFuzzy(level: Level, found: FuzzyFound): void {
    const node = this.idx.getNode(found.hit.nodeId)!
    const st = this.states[level]
    st.nodeId = node.id
    st.name = node.name
    st.matchType = 'fuzzy'
    st.confidence = fuzzyConfidence(found.hit.score)
    st.span = [found.pos, found.pos + found.len]
    st.candidates = [this.idx.fullPath(node.id)]
  }

  private backfill(): void {
    for (const level of [...LEVEL_ORDER].reverse()) {
      const st = this.states[level]
      if (!st.nodeId) continue
      const hitNode = this.idx.getNode(st.nodeId)!
      for (const ancestor of this.idx.ancestorChain(st.nodeId)) {
        if (ancestor.id === st.nodeId) continue
        if (!this.canInfer(level, ancestor.level)) continue
        const target = this.states[ancestor.level]
        if (target.nodeId) continue
        target.nodeId = ancestor.id
        target.name = ancestor.name
        target.matchType = 'inferred'
        target.span = null
        const directChild = this.idx.ancestorChain(st.nodeId).find((n) => n.parentId === ancestor.id)
        target.confidence = directChild && this.states[directChild.level].matchType !== 'inferred' ? 0.82 : 0.72
        target.candidates = [this.idx.fullPath(ancestor.id)]
        this.log(`缺失回填：${ancestor.level}`, `由「${hitNode.name}」沿父子链补全为「${ancestor.name}」（置信度 ${target.confidence}）`)
      }
    }
  }

  private computeRemainder(body: string): string {
    const spans = LEVEL_ORDER.map((l) => this.states[l].span).filter(Boolean) as [number, number][]
    if (!spans.length) return body.replace(CONNECTOR, '').trim()
    const consumed = new Set<number>()
    for (const [a, b] of spans) for (let i = a; i < b; i++) consumed.add(i)
    let rest = ''
    for (let i = 0; i < body.length; i++) if (!consumed.has(i)) rest += body[i]
    return rest.replace(CONNECTOR, '').replace(/^[的]+/, '').trim()
  }

  private toLevelMatches(): Record<Level, LevelMatch> {
    const out = {} as Record<Level, LevelMatch>
    for (const level of LEVEL_ORDER) out[level] = { ...emptyMatch(level), ...this.states[level] }
    return out
  }

  private overallConfidence(door: ParseResult['door']): number {
    const weights: Record<Level, number> = {
      province: 0.14, city: 0.16, district: 0.24, street: 0.26, community: 0.15,
    }
    // 缺失级别按低分计入（而不是直接剔除），保证漏级别会拉低整体置信度
    const missingScore = 0.5
    let sum = 0
    for (const level of LEVEL_ORDER) {
      const s = this.states[level]
      const score = s.nodeId ? s.confidence : missingScore
      sum += score * weights[level]
    }
    // 匹配方式惩罚因子：链上出现模糊/推断时整体下调
    let factor = 1
    for (const level of LEVEL_ORDER) {
      const t = this.states[level].matchType
      if (t === 'fuzzy') factor *= 0.95
      else if (t === 'inferred') factor *= 0.93
    }
    const admin = Math.min(1, sum * factor)
    const doorScore = door.raw ? 0.95 : 0.7
    return Math.round((admin * 0.95 + doorScore * 0.05) * 1000) / 1000
  }
}

function parentOf(level: Level): Level | null {
  const i = LEVEL_ORDER.indexOf(level)
  return i > 0 ? LEVEL_ORDER[i - 1] : null
}

function LEVEL_LABEL(level: Level): string {
  return { province: '省级', city: '市级', district: '区县', street: '街道', community: '小区' }[level]
}
