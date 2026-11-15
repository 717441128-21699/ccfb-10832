// 模糊匹配：编辑距离 + 同音字键 + 形近字键 + 行政后缀容忍
import { homophoneSequence } from './data/homophones'
import { visualSequence } from './data/confusables'

/** 莱文斯坦编辑距离 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0
  const d = levenshtein(a, b)
  return 1 - d / Math.max(a.length, b.length)
}

const GENERIC_SUFFIXES = [
  '壮族自治区', '回族自治区', '自治区', '自治州', '白族自治州',
  '省', '市', '区', '县', '镇', '乡', '街道', '管委会',
  '小区', '花苑', '家园', '新村', '公寓', '大街', '大道', '路', '街',
]

function stripSuffix(s: string): string {
  for (const suf of GENERIC_SUFFIXES) {
    if (s.endsWith(suf) && s.length - suf.length >= 2) {
      return s.slice(0, s.length - suf.length)
    }
  }
  return s
}

/** 去掉行政/通名后缀的核心名（朝阳路 -> 朝阳，徐汇区 -> 徐汇，万科城小区 -> 万科城） */
export function coreName(s: string): string {
  return stripSuffix(s)
}

/**
 * 模糊相似度 0~1，综合：
 * - 字面编辑距离
 * - 同音字键序列（朝陽路 vs 潮洋路）
 * - 形近字键序列（己/已）
 * - 去行政后缀后的核心名比较（朝阳路 vs 朝阳街）
 */
export function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  // 同音字键序列完全一致 -> 高分区，长度差惩罚很小
  const seqA = homophoneSequence(a)
  const seqB = homophoneSequence(b)
  if (seqA === seqB) {
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    return 0.95 * (0.92 + 0.08 * lenRatio)
  }
  const visA = visualSequence(a)
  const visB = visualSequence(b)
  if (visA === visB) {
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    return 0.9 * (0.92 + 0.08 * lenRatio)
  }

  const scores: number[] = [similarity(a, b), similarity(seqA, seqB) * 0.97, similarity(visA, visB) * 0.94]

  const coreA = stripSuffix(a)
  const coreB = stripSuffix(b)
  if (coreA !== a || coreB !== b) {
    if (coreA === coreB) scores.push(0.92)
    else {
      scores.push(similarity(coreA, coreB) * 0.92)
      // 核心名同音也算
      if (homophoneSequence(coreA) === homophoneSequence(coreB)) scores.push(0.93)
    }
  }

  // 一边是另一边核心名的情况（西港 vs 西岗区）：核心读音一致直接高分
  if (homophoneSequence(coreA) === homophoneSequence(coreB) && coreA !== coreB) {
    scores.push(0.9)
  }

  // 长度差过大做温和惩罚，避免短词误命中长词，但不误杀同音字
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return Math.max(...scores) * (0.9 + 0.1 * lenRatio)
}

/** 模糊匹配接受阈值 */
export const FUZZY_ACCEPT = 0.7

/** 各级别独立的接受阈值：级别越低、名称越短，门槛越高，防止短词串扰 */
export const FUZZY_ACCEPT_BY_LEVEL: Record<'province' | 'city' | 'district' | 'street' | 'community', number> = {
  province: 0.7,
  city: 0.82,
  district: 0.78,
  street: 0.72,
  community: 0.72,
}

/** 模糊相似度 -> 置信度映射 */
export function fuzzyConfidence(score: number): number {
  return Math.min(0.93, 0.7 + 0.24 * score)
}
