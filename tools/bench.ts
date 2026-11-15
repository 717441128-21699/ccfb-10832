// 端到端基准：
//   npm run bench [数量] [seed] [档位]
//   档位：realistic 真实分布（默认用于 99% 验收）/ stress 激进压测 / both 两档都跑
// 验收线：省市区(street及以上)准确率 ≥ 99%，门牌级准确率 ≥ 90%
import { buildSeedLibrary, countByLevel } from '../src/core/data/seed'
import { LibraryIndex } from '../src/core/library'
import { AddressParser } from '../src/core/parser'
import { applyRules, defaultRules } from '../src/core/rules'
import { generateWaybills } from './generator'
import { evaluate, formatPercent, type AccuracyReport } from './evaluate'
import type { ParseResult } from '../src/core/types'

const count = Number(process.argv[2] ?? 200000)
const seed = Number(process.argv[3] ?? 42)
const profileArg = (process.argv[4] ?? 'both') as 'realistic' | 'stress' | 'both'
const profiles = profileArg === 'both' ? (['realistic', 'stress'] as const) : [profileArg] as const

console.log('== 地址解析与分拣基准 ==')
const tBuild0 = performance.now()
const lib = buildSeedLibrary()
const idx = new LibraryIndex(lib)
console.log(`地址库构建 ${(performance.now() - tBuild0).toFixed(1)}ms，各级节点:`, countByLevel(lib))

const parser = new AddressParser(idx)
const rules = defaultRules()

function runProfile(profile: 'realistic' | 'stress'): { report: AccuracyReport; elapsed: number; throughput: number } {
  console.log(`\n${'='.repeat(70)}\n档位【${profile === 'realistic' ? '真实分布 realistic' : '激进压测 stress'}】 数量=${count} seed=${seed}`)
  const tGen0 = performance.now()
  const waybills = generateWaybills(lib, { count, seed, profile })
  console.log(`造数耗时 ${(performance.now() - tGen0).toFixed(1)}ms`)

  const results: ParseResult[] = new Array(waybills.length)
  const t0 = performance.now()
  for (let i = 0; i < waybills.length; i++) {
    const w = waybills[i]
    const r = parser.parse(w.text, w.id)
    const slot = applyRules(rules, r)
    results[i] = { ...r, slot: slot.slot, matchedRuleId: slot.ruleId }
  }
  const elapsed = performance.now() - t0
  const throughput = Math.round(count / (elapsed / 1000))
  console.log(`解析耗时 ${(elapsed / 1000).toFixed(2)}s，单条平均 ${(elapsed / count).toFixed(3)}ms，吞吐 ${throughput} 条/秒`)

  const report = evaluate(waybills, results, lib)
  console.log('各级准确率（面单明确写出的级别）:')
  for (const [lv, b] of Object.entries(report.explicit)) {
    console.log(`  ${lv.padEnd(9)} ${formatPercent(b.acc)}  (${b.correct}/${b.total})`)
  }
  console.log('验收指标:')
  console.log(`  省/市/区三级全对:        ${formatPercent(report.admin3Acc.acc)}  (目标 ≥99.00%)  ${report.admin3Acc.acc >= 0.99 ? '✅' : '❌'}`)
  console.log(`  省市区街道小区整条链:    ${formatPercent(report.adminAcc.acc)}  (信息充足时参考)`)
  console.log(`  门牌级:                  ${formatPercent(report.doorAcc.acc)}  (目标 ≥90.00%)  ${report.doorAcc.acc >= 0.9 ? '✅' : '❌'}`)
  console.log(`    楼栋 ${formatPercent(report.buildingAcc.acc)}  房号 ${formatPercent(report.roomAcc.acc)}`)
  console.log(`  错误低置信度拦截召回:    ${formatPercent(report.lowConfRecallOnError)}`)
  console.log(`  高置信度误放行率:        ${formatPercent(report.highConfErrorRate)}`)
  return { report, elapsed, throughput }
}

let realisticPass = true
for (const p of profiles) {
  const { report } = runProfile(p)
  const pass = report.admin3Acc.acc >= 0.99 && report.doorAcc.acc >= 0.9
  console.log(`结论【${p}】: ${pass ? '达标 ✅' : '未达标（压测档用于观察鲁棒性下限，不作为验收门槛）❌'}`)
  // 单档运行时按该档门槛判定；both 模式仅真实分布档决定退出码（stress 是鲁棒性观察档）
  if (profiles.length === 1) {
    if (!pass) realisticPass = false
  } else if (p === 'realistic' && !pass) {
    realisticPass = false
  }
}
process.exit(realisticPass ? 0 : 1)
