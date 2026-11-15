// 测试面单生成器：从地址库随机抽样造地址，带标准答案
// 故障注入：漏级别 / 别名简称 / 历史老名 / 同音字错别字 / 形近字 / 繁体 / 全角 / 噪声标点
import { mulberry32 } from '../src/core/data/seed'
import { simpleToTradChar } from '../src/core/data/traditional'
import { homophonePartners } from '../src/core/data/homophones'
import { confusablePartners } from '../src/core/data/confusables'
import type { AddressLibrary, AddressNode, Level } from '../src/core/types'
import { LEVEL_ORDER } from '../src/core/types'

export interface WaybillTruth {
  provinceId: string | null
  cityId: string | null
  districtId: string | null
  streetId: string | null
  communityId: string | null
  building: string | null
  unit: string | null
  room: string | null
}

export interface Waybill {
  id: string
  text: string
  truth: WaybillTruth
  /** 故障标签，方便统计各类问题的命中率 */
  tags: string[]
}

interface Chain {
  province: AddressNode
  city: AddressNode
  district: AddressNode
  street: AddressNode
  community: AddressNode
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

/** 预构建所有有效完整链，避免每条面单都反复遍历地址库 */
let chainCache: { lib: AddressLibrary; chains: Chain[] } | null = null

function allChains(lib: AddressLibrary): Chain[] {
  if (chainCache && chainCache.lib === lib) return chainCache.chains
  const chains: Chain[] = []
  for (const province of Object.values(lib.nodes).filter((n) => n.level === 'province')) {
    for (const city of (lib.children[province.id] ?? []).map((id) => lib.nodes[id]).filter((n) => n.level === 'city')) {
      for (const district of (lib.children[city.id] ?? []).map((id) => lib.nodes[id]).filter((n) => n.level === 'district' && n.weight > 1)) {
        for (const street of (lib.children[district.id] ?? []).map((id) => lib.nodes[id]).filter((n) => n.level === 'street')) {
          for (const community of (lib.children[street.id] ?? []).map((id) => lib.nodes[id]).filter((n) => n.level === 'community')) {
            chains.push({ province, city, district, street, community })
          }
        }
      }
    }
  }
  chainCache = { lib, chains }
  return chains
}

/** 在地址库中取一条完整的 省→市→区→路→小区 链（跳过撤销节点） */
export function sampleChain(lib: AddressLibrary, rng: () => number): Chain {
  return pick(rng, allChains(lib))
}

/** 随机门址，返回 [文本, 结构化] */
function makeDoor(rng: () => number): { text: string; truth: Pick<WaybillTruth, 'building' | 'unit' | 'room'> } {
  const building = String(1 + Math.floor(rng() * 30))
  const unit = String(1 + Math.floor(rng() * 6))
  const floor = 1 + Math.floor(rng() * 30)
  const roomNo = 1 + Math.floor(rng() * 8)
  const room = `${floor}${String(roomNo).padStart(2, '0')}`
  const variants: Array<{ text: string; truth: Pick<WaybillTruth, 'building' | 'unit' | 'room'> }> = [
    { text: `${building}号楼${unit}单元${room}室`, truth: { building, unit, room } },
    { text: `${building}栋${unit}单元${room}`, truth: { building, unit, room } },
    { text: `${building}幢${unit}单元${room}室`, truth: { building, unit, room } },
    { text: `${building}号楼${room}室`, truth: { building, unit: null, room } },
    { text: `${building}栋${room}室`, truth: { building, unit: null, room } },
    { text: `${building}号${unit}单元${room}`, truth: { building, unit, room } },
  ]
  return pick(rng, variants)
}

/** 同音字/形近字替换一个字（只在有映射时替换，保证可被纠回） */
function corruptOneChar(
  rng: () => number,
  text: string,
  hom: Map<string, string[]>,
  vis: Map<string, string[]>,
): string | null {
  const positions = [...text].map((_, i) => i).filter((i) => {
    const ch = text[i]
    return /[一-鿿]/.test(ch) && ((hom.get(ch)?.length ?? 0) > 0 || (vis.get(ch)?.length ?? 0) > 0)
  })
  if (!positions.length) return null
  const pos = pick(rng, positions)
  const ch = text[pos]
  const useHom = rng() < 0.7
  const pool = (useHom ? hom.get(ch) : vis.get(ch)) ?? vis.get(ch) ?? hom.get(ch)
  if (!pool || !pool.length) return null
  const replacement = pick(rng, pool)
  return text.slice(0, pos) + replacement + text.slice(pos + 1)
}

function toFullWidthDigits(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') out += String.fromCodePoint(ch.codePointAt(0)! + 0xfee0)
    else out += ch
  }
  return out
}

function toTraditional(text: string, rng: () => number): string {
  let out = ''
  for (const ch of text) {
    if (rng() < 0.35) {
      const t = simpleToTradChar(ch)
      out += t ?? ch
    } else {
      out += ch
    }
  }
  return out
}

const NOISE = ['，', '。', '（', '）', ' ', '\t', '、', '-', '【', '】']

export interface GenerateOptions {
  count: number
  seed?: number
  /** 故障注入比例（默认与压测场景对齐） */
  rates?: Partial<CorruptionRates>
  /** 预置档位：realistic 真实分布 / stress 激进压测（默认） */
  profile?: 'realistic' | 'stress'
}

interface CorruptionRates {
  omitProvince: number
  omitCity: number
  omitDistrict: number
  omitCommunity: number
  alias: number
  oldName: number
  typo: number
  traditional: number
  fullWidth: number
  noise: number
  noDoor: number
}

/** 激进压测档：高比例故障注入，用于检验引擎鲁棒性下限 */
export const STRESS_RATES: CorruptionRates = {
  omitProvince: 0.18,
  omitCity: 0.12,
  omitDistrict: 0.08,
  omitCommunity: 0.08,
  alias: 0.3,
  oldName: 0.12,
  typo: 0.25,
  traditional: 0.15,
  fullWidth: 0.12,
  noise: 0.3,
  noDoor: 0.05,
}

/**
 * 真实分布档：参照真实手写面单的故障频率——
 * 省市区绝大多数会写（区是分拣关键，漏写率很低）；错别字/简称/繁体为少数。
 */
export const REALISTIC_RATES: CorruptionRates = {
  omitProvince: 0.06,
  omitCity: 0.04,
  omitDistrict: 0.015,
  omitCommunity: 0.04,
  alias: 0.12,
  oldName: 0.04,
  typo: 0.06,
  traditional: 0.05,
  fullWidth: 0.04,
  noise: 0.1,
  noDoor: 0.02,
}

// 伙伴表只构建一次（造 20 万条时避免重复计算）
let homCache: ReturnType<typeof homophonePartners> | null = null
let visCache: ReturnType<typeof confusablePartners> | null = null

/** 生成测试面单 */
export function generateWaybills(lib: AddressLibrary, opts: GenerateOptions): Waybill[] {
  const rng = mulberry32(opts.seed ?? 42)
  const base = opts.profile === 'realistic' ? REALISTIC_RATES : STRESS_RATES
  const rates = { ...base, ...(opts.rates ?? {}) }
  const hom = homCache ?? (homCache = homophonePartners())
  const vis = visCache ?? (visCache = confusablePartners())
  const out: Waybill[] = []

  for (let i = 0; i < opts.count; i++) {
    const chain = sampleChain(lib, rng)
    const tags: string[] = []
    const parts: string[] = []

    // 各级名称选择：现名 / 别名 / 历史名
    const chooseName = (node: AddressNode, allowOld: boolean): string => {
      if (allowOld && node.history.length && rng() < rates.oldName) {
        tags.push(`${node.level}:oldName`)
        return node.history[0].name
      }
      if (node.aliases.length && rng() < rates.alias) {
        tags.push(`${node.level}:alias`)
        // 偏向最短的别名（模拟手写简称）
        const sorted = [...node.aliases].sort((a, b) => a.length - b.length)
        return rng() < 0.6 ? sorted[0] : pick(rng, sorted)
      }
      return node.name
    }

    const omit: Record<Level, boolean> = {
      province: rng() < rates.omitProvince,
      city: rng() < rates.omitCity,
      district: rng() < rates.omitDistrict,
      street: false,
      community: rng() < rates.omitCommunity,
    }

    // 漏写区时不做区错字；街道保持可见，保证有路可解
    const writeLevel = (level: Level, node: AddressNode): void => {
      if (omit[level]) {
        tags.push(`omit:${level}`)
        return
      }
      let name = chooseName(node, true)
      // 错别字：只对区/街道/小区下手，省市级不动，避免不可解样本
      if (level !== 'province' && level !== 'city' && rng() < rates.typo) {
        const corrupted = corruptOneChar(rng, name, hom, vis)
        if (corrupted) {
          name = corrupted
          tags.push(`${level}:typo`)
        }
      }
      parts.push(name)
    }

    writeLevel('province', chain.province)
    writeLevel('city', chain.city)
    writeLevel('district', chain.district)
    writeLevel('street', chain.street)
    writeLevel('community', chain.community)

    // 门址
    let doorTruth: Pick<WaybillTruth, 'building' | 'unit' | 'room'> = {
      building: null, unit: null, room: null,
    }
    if (rng() >= rates.noDoor) {
      const d = makeDoor(rng)
      doorTruth = d.truth
      parts.push(d.text)
    } else {
      tags.push('noDoor')
    }

    let text = parts.join('')

    // 繁体化（整串按概率替换部分字）
    if (rng() < rates.traditional) {
      text = toTraditional(text, rng)
      tags.push('traditional')
    }
    // 全角数字
    if (rng() < rates.fullWidth) {
      text = toFullWidthDigits(text)
      tags.push('fullWidth')
    }
    // 噪声标点
    if (rng() < rates.noise) {
      const insertAt = 1 + Math.floor(rng() * Math.max(1, text.length - 1))
      text = text.slice(0, insertAt) + pick(rng, NOISE) + text.slice(insertAt)
      tags.push('noise')
    }

    out.push({
      id: `WB${String(i + 1).padStart(7, '0')}`,
      text,
      tags,
      truth: {
        provinceId: omit.province ? null : chain.province.id,
        cityId: omit.city ? null : chain.city.id,
        districtId: omit.district ? null : chain.district.id,
        streetId: chain.street.id,
        communityId: omit.community ? null : chain.community.id,
        ...doorTruth,
      },
    })
  }
  return out
}

export const LEVELS_FOR_EVAL = LEVEL_ORDER
