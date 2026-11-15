// 楼栋/单元/门牌解析
import type { DoorInfo } from './types'

const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** 阿拉伯数字或简短中文数字转阿拉伯数字字符串；无法转换返回 null */
export function normalizeNumber(token: string): string | null {
  if (/^\d+$/.test(token)) return token
  if (!/^[零一二两三四五六七八九十百]+$/.test(token)) return null
  if (token.includes('百')) {
    const m = token.match(/^([零一二两三四五六七八九])百(?:([零一二两三四五六七八九])?十(?:([零一二两三四五六七八九]))?)?$/)
    if (!m) return null
    const hundreds = CN_DIGIT[m[1]] * 100
    const tens = m[2] ? CN_DIGIT[m[2]] * 10 : token.includes('十') ? 10 : 0
    const ones = m[3] ? CN_DIGIT[m[3]] : 0
    return String(hundreds + tens + ones)
  }
  if (token === '十') return '10'
  if (token.startsWith('十')) return String(10 + (CN_DIGIT[token[1]] ?? 0))
  if (token.endsWith('十')) return String(CN_DIGIT[token[0]] * 10)
  const m = token.match(/^([零一二两三四五六七八九])十([零一二两三四五六七八九])$/)
  if (m) return String(CN_DIGIT[m[1]] * 10 + CN_DIGIT[m[2]])
  if (token.length === 1 && CN_DIGIT[token] !== undefined) return String(CN_DIGIT[token])
  return null
}

export interface DoorParseResult {
  door: DoorInfo
  /** 被识别为门牌的原文片段（用于从地址主体中剥离） */
  consumed: string
}

const NUM = '\\d+|[零一二两三四五六七八九十百]+'

/**
 * 从地址尾部抽取门牌信息，支持：
 *   12号楼3单元502室 / 3栋2单元1801 / 5幢801 / 88号院2号楼 / 16号1单元2001
 */
export function parseDoor(text: string): DoorParseResult {
  const door: DoorInfo = { building: null, unit: null, room: null, raw: null }
  let work = text
  let consumedStart = text.length
  const mark = (m: RegExpMatchArray): void => {
    consumedStart = Math.min(consumedStart, m.index ?? consumedStart)
  }
  const cut = (m: RegExpMatchArray): void => {
    work = work.slice(0, m.index) + work.slice((m.index ?? 0) + m[0].length)
  }

  // 1. 楼栋：X号楼 / X栋 / X幢 / X座 / X号院
  let m = work.match(new RegExp(`(${NUM})(?:号)?(?:号楼|栋|幢|座)`))
  if (m) {
    door.building = normalizeNumber(m[1]) ?? m[1]
    mark(m); cut(m)
  } else {
    m = work.match(new RegExp(`(${NUM})号院`))
    if (m) {
      door.building = normalizeNumber(m[1]) ?? m[1]
      mark(m); cut(m)
    } else {
      // X号 后接 单元/房号（如 16号1单元2001、28号2单元503）：X 是楼栋
      m = work.match(new RegExp(`(${NUM})号(?=${NUM}单元|\\d)`))
      if (m) {
        door.building = normalizeNumber(m[1]) ?? m[1]
        mark(m); cut(m)
      }
    }
  }

  // 2. 单元：X单元
  m = work.match(new RegExp(`(${NUM})单元`))
  if (m) {
    door.unit = normalizeNumber(m[1]) ?? m[1]
    mark(m); cut(m)
  }

  // 3. 房号：优先 X室；其次尾部独立 3~5 位数字（无“室”格式，如 3栋2单元1801）
  m = work.match(/(\d{2,5})\s*室/)
  if (m) {
    door.room = m[1]
    mark(m); cut(m)
  } else {
    m = work.match(/(\d{3,5})(?!\d)/)
    if (m) {
      door.room = m[1]
      mark(m); cut(m)
    } else {
      // 4. 兜底：X号（前面没有 楼/栋/幢/院 时才作为房号）
      m = work.match(new RegExp(`(${NUM})号(?!楼|院|栋|幢)`))
      if (m) {
        door.room = normalizeNumber(m[1]) ?? m[1]
        mark(m); cut(m)
      }
    }
  }

  const hasAny = door.building || door.unit || door.room
  return {
    door: { ...door, raw: hasAny ? text.slice(consumedStart).replace(/\s+/g, '') : null },
    consumed: hasAny ? text.slice(consumedStart) : '',
  }
}
