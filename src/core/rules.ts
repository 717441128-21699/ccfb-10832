// 分拣格口规则引擎：解析结果按优先级逐条匹配，命中即映射格口
import type { ParseResult } from './types'

export type RuleField =
  | 'province'
  | 'city'
  | 'district'
  | 'street'
  | 'community'
  | 'building'
  | 'room'
  | 'confidence'

export type RuleOp = 'eq' | 'ne' | 'contains' | 'startsWith' | 'in' | 'gte' | 'lte'

export interface SlotRule {
  id: string
  enabled: boolean
  name: string
  /** 数字越小优先级越高 */
  priority: number
  field: RuleField
  op: RuleOp
  /** in 用 ; 分隔多个值；contains/startsWith 用子串 */
  value: string
  slot: string
  /** 命中后是否直接终止（默认是） */
  stop: boolean
  updatedAt: string
}

export const RULE_FIELD_LABEL: Record<RuleField, string> = {
  province: '省',
  city: '市',
  district: '区/县',
  street: '街道/路',
  community: '小区',
  building: '楼栋',
  room: '房号',
  confidence: '置信度',
}

export const RULE_OP_LABEL: Record<RuleOp, string> = {
  eq: '等于',
  ne: '不等于',
  contains: '包含',
  startsWith: '开头是',
  in: '属于(分号分隔)',
  gte: '≥',
  lte: '≤',
}

export function defaultRules(): SlotRule[] {
  const now = new Date(0).toISOString()
  return [
    { id: 'r1', enabled: true, name: '低置信度转人工', priority: 10, field: 'confidence', op: 'lte', value: '0.85', slot: 'MANUAL-人工格口', stop: true, updatedAt: now },
    { id: 'r2', enabled: true, name: '深圳南山专线', priority: 20, field: 'district', op: 'eq', value: '南山区', slot: 'SZ-NS-01', stop: true, updatedAt: now },
    { id: 'r3', enabled: true, name: '上海浦东专线', priority: 30, field: 'district', op: 'eq', value: '浦东新区', slot: 'SH-PD-01', stop: true, updatedAt: now },
    { id: 'r4', enabled: true, name: '北京朝阳专线', priority: 40, field: 'district', op: 'eq', value: '朝阳区', slot: 'BJ-CY-01', stop: true, updatedAt: now },
    { id: 'r5', enabled: true, name: '广州天河专线', priority: 50, field: 'district', op: 'eq', value: '天河区', slot: 'GZ-TH-01', stop: true, updatedAt: now },
    { id: 'r6', enabled: true, name: '杭州西湖专线', priority: 60, field: 'district', op: 'eq', value: '西湖区', slot: 'HZ-XH-01', stop: true, updatedAt: now },
    { id: 'r7', enabled: true, name: '成都武侯专线', priority: 70, field: 'district', op: 'eq', value: '武侯区', slot: 'CD-WH-01', stop: true, updatedAt: now },
    { id: 'r8', enabled: true, name: '同城按区分拣', priority: 100, field: 'district', op: 'contains', value: '区', slot: 'LOCAL-DISTRICT', stop: true, updatedAt: now },
  ]
}

function fieldValue(r: ParseResult, field: RuleField): string | number | null {
  switch (field) {
    case 'province': return r.province.name
    case 'city': return r.city.name
    case 'district': return r.district.name
    case 'street': return r.street.name
    case 'community': return r.community.name
    case 'building': return r.door.building
    case 'room': return r.door.room
    case 'confidence': return r.confidence
  }
}

function testRule(rule: SlotRule, r: ParseResult): boolean {
  const actual = fieldValue(r, rule.field)
  if (actual === null || actual === undefined) return false
  if (rule.field === 'confidence') {
    const num = typeof actual === 'number' ? actual : Number(actual)
    const target = Number(rule.value)
    if (Number.isNaN(num) || Number.isNaN(target)) return false
    if (rule.op === 'gte') return num >= target
    if (rule.op === 'lte') return num <= target
    if (rule.op === 'eq') return num === target
    if (rule.op === 'ne') return num !== target
    return false
  }
  const a = String(actual)
  switch (rule.op) {
    case 'eq': return a === rule.value
    case 'ne': return a !== rule.value
    case 'contains': return a.includes(rule.value)
    case 'startsWith': return a.startsWith(rule.value)
    case 'in':
      return rule.value.split(/[;；]/).map((s) => s.trim()).filter(Boolean).includes(a)
    default:
      return false
  }
}

export interface SlotTraceEntry {
  ruleId: string
  ruleName: string
  matched: boolean
  reason: string
}

export interface SlotResult {
  slot: string | null
  ruleId: string | null
  trace: SlotTraceEntry[]
}

const FALLBACK_SLOT = 'GENERAL-综合格口'

/** 对单条解析结果应用规则；trace 记录每条规则的判定，便于调试 */
export function applyRules(rules: SlotRule[], r: ParseResult): SlotResult {
  const sorted = [...rules].filter((x) => x.enabled).sort((a, b) => a.priority - b.priority)
  const trace: SlotTraceEntry[] = []
  for (const rule of sorted) {
    const actual = fieldValue(r, rule.field)
    let matched = false
    let reason = ''
    if (actual === null || actual === undefined) {
      reason = `字段「${RULE_FIELD_LABEL[rule.field]}」为空，跳过`
    } else {
      matched = testRule(rule, r)
      reason = matched
        ? `命中：${RULE_FIELD_LABEL[rule.field]} ${RULE_OP_LABEL[rule.op]} ${rule.value} → ${rule.slot}`
        : `未命中：实际值「${actual}」 ${RULE_OP_LABEL[rule.op]} 「${rule.value}」`
    }
    trace.push({ ruleId: rule.id, ruleName: rule.name, matched, reason })
    if (matched && rule.stop) {
      return { slot: rule.slot, ruleId: rule.id, trace }
    }
  }
  trace.push({ ruleId: '-', ruleName: '兜底', matched: true, reason: `无规则命中，进入${FALLBACK_SLOT}` })
  return { slot: FALLBACK_SLOT, ruleId: null, trace }
}

/** 便捷封装：把格口结果写回 ParseResult */
export function assignSlot(rules: SlotRule[], r: ParseResult): ParseResult {
  const res = applyRules(rules, r)
  return { ...r, slot: res.slot, matchedRuleId: res.ruleId }
}
