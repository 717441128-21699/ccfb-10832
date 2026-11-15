<script setup lang="ts">
import { onMounted } from 'vue'
import { useStore } from './store'
import LibraryView from './views/LibraryView.vue'
import BatchView from './views/BatchView.vue'
import DebugView from './views/DebugView.vue'
import RulesView from './views/RulesView.vue'
import StatsView from './views/StatsView.vue'

const store = useStore()
onMounted(() => store.init())

const tabs = [
  { key: 'library', label: '标准地址库', ico: '🗂' },
  { key: 'batch', label: '批量解析', ico: '📦' },
  { key: 'debug', label: '单条调试', ico: '🔍' },
  { key: 'rules', label: '格口规则', ico: '🎯' },
  { key: 'stats', label: '统计', ico: '📊' },
] as const
</script>

<template>
  <aside class="sidebar">
    <h1>地址分拣工作台</h1>
    <p class="sub">本机运行 · 地址库不外传</p>
    <nav>
      <div
        v-for="t in tabs"
        :key="t.key"
        class="nav-item"
        :class="{ active: store.activeTab.value === t.key }"
        @click="store.activeTab.value = t.key"
      >
        <span class="ico">{{ t.ico }}</span>{{ t.label }}
      </div>
    </nav>
    <div class="foot">
      库版本 v{{ store.lib.value.version }}<br />
      共 {{ Object.keys(store.lib.value.nodes).length }} 个节点
    </div>
  </aside>

  <main>
    <LibraryView v-if="store.activeTab.value === 'library'" />
    <BatchView v-else-if="store.activeTab.value === 'batch'" />
    <DebugView v-else-if="store.activeTab.value === 'debug'" />
    <RulesView v-else-if="store.activeTab.value === 'rules'" />
    <StatsView v-else-if="store.activeTab.value === 'stats'" />
  </main>
</template>
