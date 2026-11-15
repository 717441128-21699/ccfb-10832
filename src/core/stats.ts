// 批量结果统计
import type { ParseResult } from './types'

export interface BatchStats {
  total: number
  parsed: number
  lowConfidence: number
  avgConfidence: number
  /** 每个格口的件量 */
  slotCounts: Array<{ slot: string; count: number; ratio: number }>
  /** 各级别命中方式分布 */
  matchTypeCounts: Record<string, Record<string, number>>
  /** 置信度分桶 */
  confidenceBuckets: Array<{ label: string; count: number }>
  totalElapsedMs: number
  avgElapsedMs: number
}

const MATCH_TYPES = ['exact', 'alias', 'history', 'fuzzy', 'inferred', 'none']
const TYPE_LABEL: Record<string, string> = {
  exact: '精确',
  alias: '别名/简称',
  history: '历史名',
  fuzzy: '模糊纠错',
  inferred: '推断补全',
  none: '未命中',
}
const LEVELS = ['province', 'city', 'district', 'street', 'community'] as const

export function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t
}

export function computeStats(results: ParseResult[]): BatchStats {
  const total = results.length
  const slotMap = new Map<string, number>()
  const matchTypeCounts: Record<string, Record<string, number>> = {}
  for (const lv of LEVELS) {
    matchTypeCounts[lv] = {}
    for (const t of MATCH_TYPES) matchTypeCounts[lv][t] = 0
  }
  const buckets = [0, 0, 0, 0, 0] // <0.6, 0.6-0.75, 0.75-0.85, 0.85-0.95, >=0.95
  let confSum = 0
  let low = 0
  let parsed = 0
  let elapsed = 0

  for (const r of results) {
    confSum += r.confidence
    if (r.confidence < 0.85) low++
    if (r.district.nodeId || r.street.nodeId) parsed++
    elapsed += r.elapsedMs
    slotMap.set(r.slot ?? '未分配', (slotMap.get(r.slot ?? '未分配') ?? 0) + 1)
    for (const lv of LEVELS) {
      const t = r[lv].matchType ?? 'none'
      matchTypeCounts[lv][t] = (matchTypeCounts[lv][t] ?? 0) + 1
    }
    if (r.confidence < 0.6) buckets[0]++
    else if (r.confidence < 0.75) buckets[1]++
    else if (r.confidence < 0.85) buckets[2]++
    else if (r.confidence < 0.95) buckets[3]++
    else buckets[4]++
  }

  const slotCounts = [...slotMap.entries()]
    .map(([slot, count]) => ({ slot, count, ratio: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count)

  return {
    total,
    parsed,
    lowConfidence: low,
    avgConfidence: total ? confSum / total : 0,
    slotCounts,
    matchTypeCounts,
    confidenceBuckets: [
      { label: '<0.60', count: buckets[0] },
      { label: '0.60-0.75', count: buckets[1] },
      { label: '0.75-0.85', count: buckets[2] },
      { label: '0.85-0.95', count: buckets[3] },
      { label: '≥0.95', count: buckets[4] },
    ],
    totalElapsedMs: elapsed,
    avgElapsedMs: total ? elapsed / total : 0,
  }
}

/** 低置信度结果单独导出 */
export function filterLowConfidence(results: ParseResult[], threshold = 0.85): ParseResult[] {
  return results.filter((r) => r.confidence < threshold)
}

/** 导出 CSV（批量结果全量） */
export function resultsToCsv(results: ParseResult[]): string {
  const header = [
    'id', '原始地址', '规范化地址', '省', '市', '区县', '街道', '小区',
    '楼栋', '单元', '房号', '置信度', '格口', '命中规则',
  ]
  const lines = [header.join(',')]
  for (const r of results) {
    lines.push([
      r.id,
      csvCell(r.raw),
      csvCell(r.normalized),
      csvCell(r.province.name ?? ''),
      csvCell(r.city.name ?? ''),
      csvCell(r.district.name ?? ''),
      csvCell(r.street.name ?? ''),
      csvCell(r.community.name ?? ''),
      csvCell(r.door.building ?? ''),
      csvCell(r.door.unit ?? ''),
      csvCell(r.door.room ?? ''),
      r.confidence.toFixed(3),
      csvCell(r.slot ?? ''),
      csvCell(r.matchedRuleId ?? ''),
    ].join(','))
  }
  // 加 BOM，Excel 打开不乱码
  return '﻿' + lines.join('\n')
}

function csvCell(s: string): string {
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
