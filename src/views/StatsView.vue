<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from '../store'
import { computeStats, typeLabel } from '../core/stats'

const store = useStore()
const stats = computed(() =>
  store.lastResults.value.length ? computeStats(store.lastResults.value) : null,
)

const levelName: Record<string, string> = {
  province: '省', city: '市', district: '区/县', street: '街道/路', community: '小区',
}
const matchOrder = ['exact', 'alias', 'history', 'fuzzy', 'inferred', 'none']
</script>

<template>
  <h2 class="page-title">统计分析</h2>
  <p class="page-desc">基于最近一次批量解析结果，从命中方式、置信度分布、格口量三个维度统计。先在「批量解析」跑一批数据。</p>

  <div v-if="!stats" class="card">
    <p class="muted">暂无数据。请先到「批量解析」页面运行一批面单。</p>
  </div>

  <template v-else>
    <div class="grid cols-4">
      <div class="stat"><div class="num blue">{{ stats.total }}</div><div class="label">总量</div></div>
      <div class="stat"><div class="num green">{{ stats.parsed }}</div><div class="label">成功解析</div></div>
      <div class="stat"><div class="num red">{{ stats.lowConfidence }}</div><div class="label">低置信度</div></div>
      <div class="stat"><div class="num purple">{{ (stats.avgConfidence * 100).toFixed(1) }}%</div><div class="label">平均置信度</div></div>
    </div>

    <div class="card">
      <h3>各级别命中方式分布</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>级别</th>
              <th v-for="t in matchOrder" :key="t">{{ typeLabel(t) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(lvName, lv) in levelName" :key="lv">
              <td><strong>{{ lvName }}</strong></td>
              <td v-for="t in matchOrder" :key="t" class="mono">
                {{ stats.matchTypeCounts[lv]?.[t] ?? 0 }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted" style="font-size: 12px; margin-top: 10px">
        精确＝标准名直命中；别名/简称、历史名＝老叫法识别；模糊纠错＝同音/形近/编辑距离；推断补全＝缺失级别沿父子链回填。
      </p>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h3>置信度分桶</h3>
        <div class="bar-chart">
          <div v-for="b in stats.confidenceBuckets" :key="b.label" class="bc-row">
            <span class="mono" style="font-size: 12px">{{ b.label }}</span>
            <div class="bc-track">
              <div class="bc-fill" :style="{ width: stats.total ? (b.count / stats.total * 100) + '%' : '0' }"></div>
            </div>
            <span class="bc-val">{{ b.count }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>格口件量分布</h3>
        <div class="bar-chart">
          <div v-for="s in stats.slotCounts.slice(0, 10)" :key="s.slot" class="bc-row">
            <span class="mono" style="font-size: 11px">{{ s.slot }}</span>
            <div class="bc-track">
              <div class="bc-fill" :style="{ width: (s.ratio * 100) + '%', background: 'var(--cyan)' }"></div>
            </div>
            <span class="bc-val">{{ s.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>性能</h3>
      <div class="grid cols-3">
        <div class="stat"><div class="num">{{ (stats.totalElapsedMs / 1000).toFixed(2) }}s</div><div class="label">总耗时</div></div>
        <div class="stat"><div class="num">{{ stats.avgElapsedMs.toFixed(2) }}ms</div><div class="label">单条平均</div></div>
        <div class="stat"><div class="num">{{ Math.round(stats.total / (stats.totalElapsedMs / 1000)) }}</div><div class="label">条/秒</div></div>
      </div>
    </div>
  </template>
</template>
