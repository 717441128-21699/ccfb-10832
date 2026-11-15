<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '../store'
import { IMPORT_CSV_TEMPLATE } from '../core/library'
import { LEVEL_LABEL } from '../core/types'
import type { AddressNode, Level } from '../core/types'

const store = useStore()
const csvText = ref('')
const message = ref('')
const filterLevel = ref<Level | 'all'>('all')
const keyword = ref('')

const counts = computed(() => store.levelCounts.value)

async function doImport(): Promise<void> {
  if (!csvText.value.trim()) {
    message.value = '请先粘贴 CSV 内容'
    return
  }
  const report = await store.importCsv(csvText.value, `手动导入 ${new Date().toLocaleString()}`)
  message.value =
    `导入完成（v${report.version}）：新增 ${report.added}，改名 ${report.renamed}，` +
    `合并 ${report.merged}，撤销 ${report.revoked}，警告 ${report.warnings.length}`
  csvText.value = ''
}

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    csvText.value = String(reader.result ?? '')
  }
  reader.readAsText(file, 'utf-8')
}

async function doReset(): Promise<void> {
  if (confirm('确定恢复内置种子地址库？当前导入的修改会被覆盖。')) {
    await store.resetLibrary()
    message.value = '已恢复内置种子地址库'
  }
}

function downloadTemplate(): void {
  const blob = new Blob(['﻿' + IMPORT_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'address-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const filteredNodes = computed<AddressNode[]>(() => {
  const kw = keyword.value.trim()
  return Object.values(store.lib.value.nodes).filter((n) => {
    if (filterLevel.value !== 'all' && n.level !== filterLevel.value) return false
    if (!kw) return true
    const hay = [n.name, ...n.aliases, ...n.history.map((h) => h.name)].join('')
    return hay.includes(kw)
  }).slice(0, 300)
})
</script>

<template>
  <h2 class="page-title">标准地址库</h2>
  <p class="page-desc">
    导入行政区划与道路小区数据；改名、合并、撤销都会保留历史名称，老名字持续可命中。
    数据仅保存在本机 IndexedDB。
  </p>

  <div class="grid cols-5">
    <div class="stat"><div class="num blue">{{ counts.province }}</div><div class="label">省/直辖市</div></div>
    <div class="stat"><div class="num blue">{{ counts.city }}</div><div class="label">地级市</div></div>
    <div class="stat"><div class="num green">{{ counts.district }}</div><div class="label">区/县</div></div>
    <div class="stat"><div class="num purple">{{ counts.street }}</div><div class="label">街道/路</div></div>
    <div class="stat"><div class="num amber">{{ counts.community }}</div><div class="label">小区/村</div></div>
  </div>

  <div class="card">
    <h3>导入地址库 <span class="hint">CSV 列：level,name,code,parentCode,aliases,historyName,historyOp,historyNote,status</span></h3>
    <div class="row" style="margin-bottom: 12px">
      <input type="file" accept=".csv,text/csv" @change="onFile" style="max-width: 320px" />
      <button class="ghost sm" @click="downloadTemplate">下载 CSV 模板</button>
      <button class="ghost sm" @click="doReset">恢复内置种子库</button>
    </div>
    <textarea v-model="csvText" placeholder="粘贴 CSV，或选择文件后内容会出现在这里…" style="min-height: 130px"></textarea>
    <div class="row" style="margin-top: 12px">
      <button @click="doImport">导入并生成新版本</button>
      <span v-if="message" class="muted">{{ message }}</span>
    </div>
  </div>

  <div class="card">
    <h3>节点浏览 <span class="hint">含别名与历史名（最多显示 300 条）</span></h3>
    <div class="row" style="margin-bottom: 14px">
      <select v-model="filterLevel" style="max-width: 150px">
        <option value="all">全部级别</option>
        <option v-for="(label, key) in LEVEL_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
      <input v-model="keyword" placeholder="按名称/别名/历史名搜索" style="max-width: 280px" />
      <span class="spacer"></span>
      <span class="pill">当前版本 v{{ store.lib.value.version }} · 来源：{{ store.lib.value.source }}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>级别</th><th>标准名</th><th>行政代码</th><th>别名/简称</th><th>历史名称（老名字可命中）</th></tr>
        </thead>
        <tbody>
          <tr v-for="n in filteredNodes" :key="n.id">
            <td><span class="badge inferred">{{ LEVEL_LABEL[n.level] }}</span></td>
            <td><strong>{{ n.name }}</strong></td>
            <td class="mono muted">{{ n.code }}</td>
            <td>
              <span v-for="a in n.aliases" :key="a" class="pill" style="margin-right: 4px">{{ a }}</span>
              <span v-if="!n.aliases.length" class="muted">—</span>
            </td>
            <td>
              <div v-for="h in n.history" :key="h.name" style="margin-bottom: 2px">
                <span class="badge history">{{ h.op }}</span>
                <span class="mono" style="margin-left: 6px">{{ h.name }}</span>
                <span class="muted" style="margin-left: 6px">{{ h.note }}</span>
              </div>
              <span v-if="!n.history.length" class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
