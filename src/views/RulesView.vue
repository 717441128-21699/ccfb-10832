<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '../store'
import {
  RULE_FIELD_LABEL,
  RULE_OP_LABEL,
  type RuleField,
  type RuleOp,
  type SlotRule,
} from '../core/rules'
import { applyRules } from '../core/rules'

const store = useStore()
const testAddr = ref('广东省深圳市南山区科技园路万科城12栋3单元502室')

const fields = Object.keys(RULE_FIELD_LABEL) as RuleField[]
const ops = Object.keys(RULE_OP_LABEL) as RuleOp[]

function emptyRule(): SlotRule {
  return {
    id: `r${Date.now()}`,
    enabled: true,
    name: '新规则',
    priority: (Math.max(0, ...store.rules.value.map((r) => r.priority)) + 10),
    field: 'district',
    op: 'eq',
    value: '',
    slot: 'NEW-SLOT',
    stop: true,
    updatedAt: new Date().toISOString(),
  }
}

function addRule(): void {
  store.rules.value.push(emptyRule())
  persist()
}
function removeRule(id: string): void {
  store.rules.value = store.rules.value.filter((r) => r.id !== id)
  persist()
}
function move(idx: number, dir: -1 | 1): void {
  const arr = store.rules.value
  const j = idx + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
  persist()
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void store.persistRules()
    // 规则变更后立即重算最近批量结果
    for (const r of store.lastResults.value) {
      const s = applyRules(store.rules.value, r)
      r.slot = s.slot
      r.matchedRuleId = s.ruleId
    }
  }, 250)
}

const sortedRules = computed(() => [...store.rules.value].sort((a, b) => a.priority - b.priority))

const preview = computed(() => {
  const r = store.parseOne(testAddr.value)
  const result = applyRules(store.rules.value, r)
  return { slot: result.slot, trace: result.trace }
})
</script>

<template>
  <h2 class="page-title">格口规则</h2>
  <p class="page-desc">按优先级从上到下匹配，命中即映射格口。任何修改都会立即保存并对批量结果重新计算。</p>

  <div class="card">
    <h3>规则编辑器 <span class="hint">共 {{ store.rules.value.length }} 条 · 启用 {{ store.rules.value.filter(r => r.enabled).length }} 条</span></h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th style="width:50px">优先级</th><th>启用</th><th>规则名</th><th>字段</th><th>运算</th><th>值</th><th>格口编码</th><th style="width:120px">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, idx) in sortedRules" :key="r.id">
            <td class="mono">{{ r.priority }}</td>
            <td><input type="checkbox" v-model="r.enabled" @change="persist" /></td>
            <td><input v-model="r.name" @input="persist" /></td>
            <td>
              <select v-model="r.field" @change="persist">
                <option v-for="f in fields" :key="f" :value="f">{{ RULE_FIELD_LABEL[f] }}</option>
              </select>
            </td>
            <td>
              <select v-model="r.op" @change="persist">
                <option v-for="o in ops" :key="o" :value="o">{{ RULE_OP_LABEL[o] }}</option>
              </select>
            </td>
            <td><input v-model="r.value" @input="persist" :placeholder="r.op === 'in' ? '多个值用分号分隔' : '匹配值'" /></td>
            <td><input v-model="r.slot" @input="persist" class="mono" /></td>
            <td>
              <div class="row">
                <button class="ghost sm" @click="move(idx, -1)" :disabled="idx === 0">↑</button>
                <button class="ghost sm" @click="move(idx, 1)" :disabled="idx === sortedRules.length - 1">↓</button>
                <button class="danger sm" @click="removeRule(r.id)">删</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button style="margin-top: 14px" @click="addRule">+ 新增规则</button>
  </div>

  <div class="card">
    <h3>即时试算 <span class="hint">改完规则这里马上重算</span></h3>
    <div class="row" style="margin-bottom: 12px">
      <input v-model="testAddr" placeholder="输入测试地址" />
    </div>
    <div class="row" style="margin-bottom: 12px">
      <span class="muted">命中格口：</span><span class="slot-tag">{{ preview.slot ?? '未分配' }}</span>
    </div>
    <div class="table-wrap" style="max-height: 260px">
      <table>
        <thead><tr><th>规则</th><th>判定</th></tr></thead>
        <tbody>
          <tr v-for="t in preview.trace" :key="t.ruleId + t.ruleName">
            <td>{{ t.ruleName }} <span class="muted mono">({{ t.ruleId }})</span></td>
            <td>
              <span :class="['badge', t.matched ? 'ok' : 'inferred']">{{ t.matched ? '命中' : '跳过' }}</span>
              <span style="margin-left: 8px" class="muted">{{ t.reason }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
