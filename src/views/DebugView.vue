<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '../store'
import { LEVEL_LABEL } from '../core/types'
import type { Level, ParseResult } from '../core/types'

const store = useStore()
const input = ref('广东省深圳市南山区科技园路万科城12栋3单元502室')
const result = ref<ParseResult | null>(null)

const examples = [
  '四川武侯區朝杨路綠城公寓家園24幢3单元407室',
  '上海徐汇南湖路绿城公寓小区20幢4单元1404室',
  '厦门集美区南湖街金茂府小区16号1单元2001',
  '山西兴华太道１２号楼１单元３００５室',
]

function run(): void {
  if (!input.value.trim()) return
  result.value = store.parseOne(input.value)
}
run()

const levelRows = computed(() => {
  if (!result.value) return []
  const r = result.value
  const levels: Level[] = ['province', 'city', 'district', 'street', 'community']
  return levels.map((lv) => ({ lv, m: r[lv] }))
})

function confColor(c: number): string {
  if (c >= 0.9) return 'var(--green)'
  if (c >= 0.75) return 'var(--amber)'
  return 'var(--red)'
}
function typeBadge(t: string | null): string {
  return t ?? 'none'
}
</script>

<template>
  <h2 class="page-title">单条调试</h2>
  <p class="page-desc">输入一条面单地址，查看规范化、逐级匹配、同名消解、缺失回填到格口映射的完整过程。</p>

  <div class="card">
    <div class="row">
      <input v-model="input" placeholder="粘贴一条手写面单地址…" @keyup.enter="run" />
      <button @click="run">解析</button>
    </div>
    <div class="row" style="margin-top: 10px">
      <span class="muted" style="font-size: 12px">试试故障样本：</span>
      <button v-for="ex in examples" :key="ex" class="ghost sm" @click="input = ex; run()">{{ ex.slice(0, 12) }}…</button>
    </div>
  </div>

  <template v-if="result">
    <div class="card">
      <h3>解析结果
        <span class="hint">整体置信度</span>
        <span :style="{ color: confColor(result.confidence), fontWeight: 700 }">{{ (result.confidence * 100).toFixed(1) }}%</span>
        <span v-if="result.confidence < store.parseOptions.lowConfidenceThreshold" class="badge low">低置信度·转人工</span>
        <span class="spacer"></span>
        <span class="muted" style="font-size: 12px">耗时 {{ result.elapsedMs.toFixed(2) }} ms</span>
      </h3>
      <div class="row" style="margin-bottom: 14px">
        <span class="muted">规范化：</span><code class="mono" style="color: var(--cyan)">{{ result.normalized }}</code>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>级别</th><th>解析名称</th><th>命中方式</th><th>置信度</th><th>同名候选数</th></tr></thead>
          <tbody>
            <tr v-for="row in levelRows" :key="row.lv">
              <td>{{ LEVEL_LABEL[row.lv] }}</td>
              <td><strong>{{ row.m.name ?? '—' }}</strong></td>
              <td><span class="badge" :class="typeBadge(row.m.matchType)">{{ typeBadge(row.m.matchType) }}</span></td>
              <td>
                <div class="row">
                  <div class="conf-bar" style="width: 90px"><i :style="{ width: (row.m.confidence * 100) + '%', background: confColor(row.m.confidence) }"></i></div>
                  <span class="mono" :style="{ color: confColor(row.m.confidence) }">{{ (row.m.confidence * 100).toFixed(0) }}%</span>
                </div>
              </td>
              <td>{{ row.m.candidates.length }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="row" style="margin-top: 14px">
        <span class="muted">门牌：</span>
        <span class="pill">楼栋 {{ result.door.building ?? '—' }}</span>
        <span class="pill">单元 {{ result.door.unit ?? '—' }}</span>
        <span class="pill">房号 {{ result.door.room ?? '—' }}</span>
        <span class="spacer"></span>
        <span class="muted">分拣格口：</span>
        <span class="slot-tag">{{ result.slot ?? '未分配' }}</span>
      </div>
    </div>

    <div class="card">
      <h3>解析轨迹（每一步怎么拆的）</h3>
      <div>
        <div v-for="t in result.trace" :key="t.step" class="trace-step">
          <div class="tt"><span class="muted mono" style="margin-right: 8px">#{{ t.step }}</span>{{ t.title }}</div>
          <div class="dd">{{ t.detail }}</div>
          <div v-if="t.text" class="dd">中间文本：<code>{{ t.text }}</code></div>
        </div>
      </div>
    </div>
  </template>
</template>
