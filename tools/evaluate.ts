// 解析准确率评估：对照面单标准答案分级统计
import type { AddressLibrary, ParseResult } from '../src/core/types'
import type { Waybill } from './generator'

export interface AccuracyReport {
  total: number
  /** 面单上明确写出的级别，解析节点是否正确 */
  explicit: Record<'province' | 'city' | 'district' | 'street' | 'community', { correct: number; total: number; acc: number }>
  /** 含缺失级别回填/反推：所有级别最终节点是否落在标准答案的链路上 */
  filled: Record<'province' | 'city' | 'district' | 'street' | 'community', { correct: number; total: number; acc: number }>
  /** 省/市/区三级全部正确（核心行政区划验收口径） */
  admin3Acc: { correct: number; total: number; acc: number }
  /** 省/市/区/街道/小区整条链全部正确 */
  adminAcc: { correct: number; total: number; acc: number }
  /** 门牌级：楼栋/单元/房号全部正确（仅统计有门牌的样本） */
  doorAcc: { correct: number; total: number; acc: number }
  buildingAcc: { correct: number; total: number; acc: number }
  roomAcc: { correct: number; total: number; acc: number }
  /** 解析错误的条目中，被标成低置信度的比例（拦截召回） */
  lowConfRecallOnError: number
  /** 高置信度却解析错的比例（误放行率） */
  highConfErrorRate: number
  errors: Array<{ id: string; text: string; expected: string; got: string; level: string; confidence: number }>
}

const ADMIN_LEVELS = ['province', 'city', 'district', 'street', 'community'] as const
type AdminLevel = (typeof ADMIN_LEVELS)[number]
const TRUTH_KEY: Record<AdminLevel, 'provinceId' | 'cityId' | 'districtId' | 'streetId' | 'communityId'> = {
  province: 'provinceId',
  city: 'cityId',
  district: 'districtId',
  street: 'streetId',
  community: 'communityId',
}

function blankBucket() {
  return { correct: 0, total: 0, acc: 0 }
}

export function evaluate(
  waybills: Waybill[],
  results: ParseResult[],
  lib: AddressLibrary,
  lowThreshold = 0.85,
): AccuracyReport {
  const explicit = Object.fromEntries(ADMIN_LEVELS.map((l) => [l, blankBucket()])) as AccuracyReport['explicit']
  const filled = Object.fromEntries(ADMIN_LEVELS.map((l) => [l, blankBucket()])) as AccuracyReport['filled']
  let adminCorrect = 0
  let adminTotal = 0
  let admin3Correct = 0
  let admin3Total = 0
  let doorCorrect = 0
  let doorTotal = 0
  let buildingCorrect = 0
  let buildingTotal = 0
  let roomCorrect = 0
  let roomTotal = 0
  let errors = 0
  let errorsCaughtByLowConf = 0
  let highConfErrors = 0
  const errorSamples: AccuracyReport['errors'] = []

  // 以街道（每条样本必出）为锚点，构建标准答案的完整祖先链
  const expectedChain = (w: Waybill): Map<AdminLevel, string> => {
    const map = new Map<AdminLevel, string>()
    const sid = w.truth.streetId
    if (!sid) return map
    const streetNode = lib.nodes[sid]
    if (!streetNode) return map
    for (const node of [streetNode, ...ancestors(lib, streetNode.id)]) {
      map.set(node.level as AdminLevel, node.id)
    }
    if (w.truth.communityId) map.set('community', w.truth.communityId)
    return map
  }

  // 预建 id -> result 映射，把评估从 O(n²) 降到 O(n)
  const resultMap = new Map<string, ParseResult>()
  for (const r of results) resultMap.set(r.id, r)

  for (const w of waybills) {
    const r = resultMap.get(w.id)
    if (!r) continue
    const chain = expectedChain(w)
    let adminAllCorrect = true
    let adminHasCheck = false

    for (const level of ADMIN_LEVELS) {
      const truthId = w.truth[TRUTH_KEY[level]]
      const gotId = r[level].nodeId
      const expectedId = chain.get(level) ?? null

      // filled：漏写的级别也应被反推/回填到链路上的正确节点
      filled[level].total++
      if (gotId && expectedId && gotId === expectedId) filled[level].correct++
      else adminAllCorrect = false

      // explicit：只统计面单明确写出的级别
      if (truthId !== null) {
        explicit[level].total++
        if (gotId === truthId) explicit[level].correct++
        else adminAllCorrect = false
        adminHasCheck = true
      }

      if (gotId !== expectedId && errorSamples.length < 50) {
        errorSamples.push({
          id: w.id, text: w.text, level,
          expected: expectedId ?? '(空)', got: gotId ?? '(空)', confidence: r.confidence,
        })
      }
    }

    // 省/市/区三级（含回填）是否全对：核心行政区划口径
    const admin3Levels = ['province', 'city', 'district'] as const
    const admin3Ok = admin3Levels.every((lv) => {
      const expectedId = chain.get(lv) ?? null
      return r[lv].nodeId && expectedId && r[lv].nodeId === expectedId
    })
    admin3Total++
    if (admin3Ok) admin3Correct++

    if (adminHasCheck) {
      adminTotal++
      if (adminAllCorrect) adminCorrect++
      else {
        errors++
        if (r.confidence < lowThreshold) errorsCaughtByLowConf++
        if (r.confidence >= lowThreshold) highConfErrors++
      }
    }

    // 门牌（无门牌样本不参与统计）
    if (w.truth.room !== null) {
      doorTotal++
      roomTotal++
      const bOk = w.truth.building === null || r.door.building === w.truth.building
      const uOk = w.truth.unit === null || r.door.unit === w.truth.unit
      const rOk = r.door.room === w.truth.room
      if (rOk) roomCorrect++
      if (bOk && uOk && rOk) doorCorrect++
      if (w.truth.building !== null) {
        buildingTotal++
        if (r.door.building === w.truth.building) buildingCorrect++
      }
    }
  }

  for (const l of ADMIN_LEVELS) {
    explicit[l].acc = explicit[l].total ? explicit[l].correct / explicit[l].total : 1
    filled[l].acc = filled[l].total ? filled[l].correct / filled[l].total : 1
  }

  return {
    total: waybills.length,
    explicit,
    filled,
    admin3Acc: { correct: admin3Correct, total: admin3Total, acc: admin3Total ? admin3Correct / admin3Total : 0 },
    adminAcc: { correct: adminCorrect, total: adminTotal, acc: adminTotal ? adminCorrect / adminTotal : 0 },
    doorAcc: { correct: doorCorrect, total: doorTotal, acc: doorTotal ? doorCorrect / doorTotal : 0 },
    buildingAcc: { correct: buildingCorrect, total: buildingTotal, acc: buildingTotal ? buildingCorrect / buildingTotal : 1 },
    roomAcc: { correct: roomCorrect, total: roomTotal, acc: roomTotal ? roomCorrect / roomTotal : 1 },
    lowConfRecallOnError: errors ? errorsCaughtByLowConf / errors : 1,
    highConfErrorRate: adminTotal ? highConfErrors / adminTotal : 0,
    errors: errorSamples,
  }
}

function ancestors(lib: AddressLibrary, id: string): AddressNodeLike[] {
  const out: AddressNodeLike[] = []
  let cur = lib.nodes[id]?.parentId
  const guard = new Set<string>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    const node = lib.nodes[cur]
    if (!node) break
    out.push(node)
    cur = node.parentId
  }
  return out
}

type AddressNodeLike = AddressLibrary['nodes'][string]

export function formatPercent(x: number): string {
  return (x * 100).toFixed(2) + '%'
}
