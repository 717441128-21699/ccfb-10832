// 核心能力自测：不依赖随机造数，用一组确定性的典型面单验证各项需求点
import { buildSeedLibrary } from '../src/core/data/seed'
import { LibraryIndex } from '../src/core/library'
import { AddressParser } from '../src/core/parser'
import { applyRules, defaultRules } from '../src/core/rules'
import type { ParseResult } from '../src/core/types'

interface Case {
  name: string
  text: string
  expect: Array<[keyof ParseResult, string]>
}

const lib = buildSeedLibrary()
const idx = new LibraryIndex(lib)
const parser = new AddressParser(idx)
const rules = defaultRules()

const cases: Case[] = [
  { name: '标准完整地址', text: '广东省深圳市南山区科技街万科城12栋3单元502室', expect: [['district', '南山区'], ['street', '科技']] },
  { name: '繁体+全角', text: '廣東省深圳市南山區科技街萬科城１２棟３單元５０２室', expect: [['district', '南山区'], ['street', '科技']] },
  { name: '漏写省', text: '深圳市南山区科技街万科城12栋3单元502室', expect: [['province', '广东'], ['district', '南山区']] },
  { name: '漏写省市', text: '南山区科技街万科城12栋3单元502室', expect: [['city', '深圳'], ['district', '南山区']] },
  { name: '同音字容错', text: '广东省深圳市南山区科技街万科城12栋3单元502室', expect: [['district', '南山区']] },
  { name: '简称识别', text: '广东深圳南山科技街万科城12栋502', expect: [['province', '广东'], ['district', '南山区']] },
  { name: '历史老地名(卢湾→黄浦)', text: '上海市卢湾区某路1号', expect: [['district', '黄浦']] },
  { name: '历史老地名(闸北→静安)', text: '上海市闸北区某路2号', expect: [['district', '静安']] },
  { name: '噪声标点', text: '广东省-深圳市，南山区（科技街）万科城12号3单元502', expect: [['district', '南山区']] },
  { name: 'X号Y单元Z门牌', text: '广东省深圳市南山区科技街万科城16号1单元2001', expect: [['district', '南山区']] },
  { name: '区县同音字纠正(姜汉→江汉)', text: '湖北省武汉姜汉区人民街万科城7幢2单元1903室', expect: [['city', '武汉'], ['district', '江汉']] },
  { name: '区县同音字纠正(南程→南城)', text: '广东省东莞市南程街道东风街中海国际26号楼806室', expect: [['city', '东莞'], ['district', '南城']] },
]

let pass = 0
let fail = 0
for (const c of cases) {
  const r = parser.parse(c.text, c.name)
  const problems: string[] = []
  for (const [key, kw] of c.expect) {
    const m = r[key] as { name?: string | null }
    if (!m?.name?.includes(kw)) problems.push(`${String(key)} 期望含「${kw}」实得「${m?.name ?? '空'}」`)
  }
  if (problems.length) {
    fail++
    console.log(`❌ ${c.name}: ${problems.join('；')}`)
  } else {
    pass++
    console.log(`✅ ${c.name} -> ${r.province.name}/${r.city.name}/${r.district.name}/${r.street.name}`)
  }
}

// 历史名可命中专项
const historyOk = idx.lookupName('卢湾区').some((e) => lib.nodes[e.nodeId].name === '黄浦区')
if (historyOk) { pass++; console.log('✅ 历史名「卢湾区」可解析到现名「黄浦区」') }
else { fail++; console.log('❌ 历史名解析失败') }

// 格口规则：高置信度完整地址，验证专线映射（不被低置信度人工规则拦截）
const r0 = parser.parse('广东省深圳市南山区科技街万科城99栋8888室', 's')
const slot0 = applyRules(rules, r0)
if (slot0.slot === 'SZ-NS-01') { pass++; console.log('✅ 南山区映射到 SZ-NS-01 专线格口') }
else { fail++; console.log(`❌ 格口映射错误: ${slot0.slot}（conf=${r0.confidence}）`) }

// 低置信度应进人工格口
const r1 = parser.parse('某某不存在的奇怪地址xyz', 's')
const slot1 = applyRules(rules, r1)
if (slot1.slot === 'MANUAL-人工格口') { pass++; console.log('✅ 低置信度地址进入人工格口') }
else { fail++; console.log(`❌ 低置信度路由错误: ${slot1.slot}`) }

console.log(`\n自测结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
