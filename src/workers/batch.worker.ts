// 批量解析 Web Worker：主线程把地址库+规则+面单传入，Worker 内独立构建索引并回传进度
import { LibraryIndex } from '../core/library'
import { AddressParser } from '../core/parser'
import { applyRules } from '../core/rules'
import type { AddressLibrary, ParseOptions, ParseResult } from '../core/types'

export interface BatchRequest {
  library: AddressLibrary
  waybills: Array<{ id: string; text: string }>
  rules: Parameters<typeof applyRules>[0]
  options: ParseOptions
}

export interface BatchProgress {
  type: 'progress'
  done: number
  total: number
}

export interface BatchDone {
  type: 'done'
  results: ParseResult[]
  elapsedMs: number
}

export type BatchResponse = BatchProgress | BatchDone

self.onmessage = (ev: MessageEvent<BatchRequest>): void => {
  const { library, waybills, rules, options } = ev.data
  const idx = new LibraryIndex(library)
  const parser = new AddressParser(idx, options)
  const results: ParseResult[] = new Array(waybills.length)
  const t0 = performance.now()
  const reportEvery = Math.max(1, Math.floor(waybills.length / 100))

  for (let i = 0; i < waybills.length; i++) {
    const w = waybills[i]
    const parsed = parser.parse(w.text, w.id)
    const slot = applyRules(rules, parsed)
    results[i] = { ...parsed, slot: slot.slot, matchedRuleId: slot.ruleId }
    if (i % reportEvery === 0) {
      const msg: BatchProgress = { type: 'progress', done: i + 1, total: waybills.length }
      self.postMessage(msg)
    }
  }

  const done: BatchDone = { type: 'done', results, elapsedMs: performance.now() - t0 }
  self.postMessage(done)
}
