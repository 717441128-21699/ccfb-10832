<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '../store'
import { generateWaybills } from '../../tools/generator'
import { computeStats, filterLowConfidence, resultsToCsv, downloadText } from '../core/stats'
import type { BatchResponse } from '../workers/batch.worker'

const store = useStore()
const count = ref(200000)
const seed = ref(42)
const running = ref(false)
const progress = ref(0)
const elapsed = ref(0)
const lowThreshold = computed(() => store.parseOptions.lowConfidenceThreshold)

const results = computed(() => store.lastResults.value)
const stats = computed(() =>
  store.lastResults.value.length ? computeStats(store.lastResults.value) : null,
)
const lowList = computed(() => filterLowConfidence(store.lastResults.value, lowThreshold.value))

let worker: Worker | null = null

function makeWaybills() {
  return generateWaybills(store.lib.value, { count: count.value, seed: seed.value }).map((w) => ({
    id: w.id,
    text: w.text,
  }))
}

async function start(): Promise<void> {
  if (running.value) return
  running.value = true
  progress.value = 0
  const waybills = makeWaybills()
  worker = new Worker(new URL('../workers/batch.worker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({
    library: store.lib.value,
    waybills,
    rules: store.rules.value,
    options: { ...store.parseOptions },
  })
  worker.onmessage = (ev: MessageEvent<BatchResponse>) => {
    const msg = ev.data
    if (msg.type === 'progress') {
      progress.value = msg.done / msg.total
    } else {
      store.lastResults.value = msg.results
      elapsed.value = msg.elapsedMs
      running.value = false
      worker?.terminate()
      worker = null
    }
  }
  worker.onerror = () => {
    running.value = false
    worker?.terminate()
    worker = null
  }
}

function stop(): void {
  worker?.terminate()
  worker = null
  running.value = false
}

function exportAll(): void {
  downloadText(`批量解析结果_${results.value.length}条.csv`, resultsToCsv(results.value))
}
function exportLow(): void {
  downloadText(`低置信度待人工_${lowList.value.length}条.csv`, resultsToCsv(lowList.value))
}
</script>

<template>
  <h2 class="page-title">批量解析</h2>
  <p class="page-desc">
    在内置 Web Worker 中运行，不阻塞界面。可造 20 万条带标准答案的测试面单一次跑完，
    也可粘贴自己的地址（每行一条）。
  </p>

  <div class="card">
    <div class="row">
      <label class="field" style="max-width: 180px; margin: 0">
        <span class="fl">面单数量</span>
        <input v-model.number="count" type="number" min="1" max="500000" :disabled="running" />
      </label>
      <label class="field" style="max-width: 150px; margin: 0">
        <span class="fl">随机种子（可复现）</span>
        <input v-model.number="seed" type="number" :disabled="running" />
      </label>
      <label class="switch" style="margin-top: 18px">
        <input type="checkbox" v-model="store.parseOptions.fuzzyEnabled" @change="store.updateParseOptions()" :disabled="running" />
        启用模糊纠错
      </label>
      <label class="field" style="max-width: 170px; margin: 0">
        <span class="fl">低置信度阈值</span>
        <input v-model.number="store.parseOptions.lowConfidenceThreshold" type="number" step="0.01" min="0" max="1" :disabled="running" />
      </label>
      <div style="margin-top: 18px">
        <button @click="start" :disabled="running">开始批量解析</button>
        <button v-if="running" class="danger" style="margin-left: 8px" @click="stop">停止</button>
      </div>
    </div>
    <div v-if="running" style="margin-top: 16px">
      <div class="progress"><i :style="{ width: (progress * 100) + '%' }"></i></div>
      <p class="muted" style="margin: 8px 0 0">{{ (progress * 100).toFixed(0) }}% 正在解析…</p>
    </div>
  </div>

  <template v-if="stats">
    <div class="grid cols-4">
      <div class="stat"><div class="num blue">{{ stats.total }}</div><div class="label">总面单</div></div>
      <div class="stat"><div class="num green">{{ stats.parsed }}</div><div class="label">成功定位区/路</div></div>
      <div class="stat"><div class="num red">{{ stats.lowConfidence }}</div><div class="label">低置信度（转人工）</div></div>
      <div class="stat"><div class="num purple">{{ (stats.avgConfidence * 100).toFixed(1) }}%</div><div class="label">平均置信度</div></div>
    </div>

    <div class="card">
      <h3>结果导出
        <span class="hint">总耗时 {{ (elapsed / 1000).toFixed(2) }}s · 单条 {{ stats.avgElapsedMs.toFixed(2) }}ms</span>
      </h3>
      <div class="row">
        <button @click="exportAll">导出全部结果 CSV</button>
        <button class="ghost" @click="exportLow">单独导出低置信度（{{ lowList.length }} 条）</button>
      </div>
    </div>

    <div class="card">
      <h3>格口分布（Top 12）</h3>
      <div class="bar-chart">
        <div v-for="s in stats.slotCounts.slice(0, 12)" :key="s.slot" class="bc-row">
          <span class="mono" style="font-size: 12px">{{ s.slot }}</span>
          <div class="bc-track"><div class="bc-fill" :style="{ width: (s.ratio * 100) + '%' }"></div></div>
          <span class="bc-val">{{ s.count }}（{{ (s.ratio * 100).toFixed(1) }}%）</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>结果明细 <span class="hint">最多预览前 200 条，完整数据请导出</span></h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>原始地址</th><th>区/路/小区</th><th>置信度</th><th>格口</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in results.slice(0, 200)" :key="r.id">
              <td class="mono muted">{{ r.id }}</td>
              <td style="max-width: 320px">{{ r.raw }}</td>
              <td style="max-width: 260px">
                <div>{{ r.district.name ?? '—' }} / {{ r.street.name ?? '—' }}</div>
                <div class="muted" style="font-size: 12px">{{ r.community.name ?? '—' }} · {{ r.door.building ?? '' }}栋{{ r.door.room ?? '' }}</div>
              </td>
              <td>
                <span :class="['badge', r.confidence < lowThreshold ? 'low' : 'ok']">
                  {{ (r.confidence * 100).toFixed(0) }}%
                </span>
              </td>
              <td><span class="slot-tag">{{ r.slot ?? '—' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>
