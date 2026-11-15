// 全局应用状态：地址库、索引、解析器、规则、最近批量结果
import { computed, reactive, ref, shallowRef } from 'vue'
import { buildSeedLibrary, countByLevel } from './core/data/seed'
import {
  csvToImportRows,
  LibraryIndex,
  mergeImportRows,
  type ImportReport,
} from './core/library'
import { AddressParser } from './core/parser'
import { applyRules, defaultRules, type SlotRule } from './core/rules'
import { loadLibrary, loadRules, saveLibrary, saveRules } from './core/storage'
import type { AddressLibrary, ParseOptions, ParseResult } from './core/types'

type TabKey = 'library' | 'batch' | 'debug' | 'rules' | 'stats'

const lib = shallowRef<AddressLibrary>(buildSeedLibrary())
const index = shallowRef<LibraryIndex>(new LibraryIndex(lib.value))
const parser = shallowRef<AddressParser>(new AddressParser(index.value))
const rules = ref<SlotRule[]>(defaultRules())
const lastResults = ref<ParseResult[]>([])
const parseOptions = reactive<ParseOptions>({
  lowConfidenceThreshold: 0.85,
  fuzzyEnabled: true,
})
const activeTab = ref<TabKey>('debug')
const importReport = ref<ImportReport | null>(null)

const levelCounts = computed(() => countByLevel(lib.value))

function rebuildParser(): void {
  index.value = new LibraryIndex(lib.value)
  parser.value = new AddressParser(index.value, { ...parseOptions })
}

function updateParseOptions(): void {
  parser.value = new AddressParser(index.value, { ...parseOptions })
}

async function init(): Promise<void> {
  const [savedLib, savedRules] = await Promise.all([loadLibrary(), loadRules()])
  if (savedLib) {
    lib.value = savedLib
    rebuildParser()
  }
  if (savedRules && savedRules.length) rules.value = savedRules
}

async function importCsv(text: string, source: string): Promise<ImportReport> {
  const rows = csvToImportRows(text)
  const { lib: next, report } = mergeImportRows(lib.value, rows, source)
  lib.value = next
  rebuildParser()
  importReport.value = report
  await saveLibrary(next)
  return report
}

async function resetLibrary(): Promise<void> {
  lib.value = buildSeedLibrary()
  rebuildParser()
  await saveLibrary(lib.value)
}

async function persistRules(): Promise<void> {
  await saveRules(rules.value)
}

function parseOne(text: string): ParseResult {
  const r = parser.value.parse(text, `D${Date.now()}`)
  const slot = applyRules(rules.value, r)
  return { ...r, slot: slot.slot, matchedRuleId: slot.ruleId }
}

export function useStore() {
  return {
    lib,
    index,
    parser,
    rules,
    lastResults,
    parseOptions,
    activeTab,
    importReport,
    levelCounts,
    init,
    rebuildParser,
    updateParseOptions,
    importCsv,
    resetLibrary,
    persistRules,
    parseOne,
  }
}
