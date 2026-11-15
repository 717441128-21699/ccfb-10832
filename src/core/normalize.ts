// 面单文本规范化：全角转半角、繁简转换、噪声清洗、口语化补全
import { tradToSimple } from './data/traditional'

export interface NormalizeStep {
  label: string
  before: string
  after: string
}

export interface NormalizeResult {
  text: string
  steps: NormalizeStep[]
}

/** 需要剥离的标点/噪声字符 */
const NOISE_CHARS = new Set(
  [
    ' ', '\t', '\r', '\n', ' ',
    '，', '。', '、', ',', '.', '．',
    '（', '）', '(', ')', '【', '】', '[', ']', '《', '》', '〈', '〉',
    '“', '”', '‘', '’', '"', "'",
    '・', '·', '•', '．', '—', '–', '_', '/', '\\', '|',
    ';', '；', ':', '：', '!', '！', '?', '？', '~', '～', '#', '@', '※', '★', '☆',
    // 连字符在面单里只作分隔（如 兴华-太道），名称节点不含连字符，直接剥离
    '-',
  ],
)

/**
 * 口语化/不规范写法补全（只收录无歧义的）
 * 有歧义的简称（如 朝、海）走地址库别名与上下文推断，不在这里硬补
 */
const INFORMAL_REPLACEMENTS: Array<[RegExp, string, string]> = [
  [/首堵/g, '北京', '常见误写：首堵→北京'],
  [/魔都/g, '上海', '常见别称：魔都→上海'],
  [/鹏城/g, '深圳', '常见别称：鹏城→深圳'],
  [/羊城/g, '广州', '常见别称：羊城→广州'],
  [/蓉城/g, '成都', '常见别称：蓉城→成都'],
  [/江城/g, '武汉', '常见别称：江城→武汉'],
  [/泉城/g, '济南', '常见别称：泉城→济南'],
  [/滨城/g, '大连', '常见别称：滨城→大连'],
  [/岛城/g, '青岛', '常见别称：岛城→青岛'],
  [/星城/g, '长沙', '常见别称：星城→长沙'],
]

/** 全角字符转半角（NFKC 之外的兜底，覆盖全角数字字母） */
function foldWidth(ch: string): string {
  const code = ch.codePointAt(0)!
  if (code === 0x3000) return ' '
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCodePoint(code - 0xfee0)
  return ch
}

export function normalize(raw: string): NormalizeResult {
  const steps: NormalizeStep[] = []
  let text = raw

  // 1. Unicode 兼容分解（全角数字/字母、兼容汉字等）
  const nfkc = text.normalize('NFKC')
  if (nfkc !== text) {
    steps.push({ label: 'Unicode 规范化（NFKC，全角→半角）', before: text, after: nfkc })
    text = nfkc
  }

  // 2. 逐字符宽度折叠兜底
  let out = ''
  for (const ch of text) out += foldWidth(ch)
  if (out !== text) {
    steps.push({ label: '全角字符折叠', before: text, after: out })
    text = out
  }

  // 3. 繁体转简体
  const simp = tradToSimple(text)
  if (simp !== text) {
    steps.push({ label: '繁体→简体', before: text, after: simp })
    text = simp
  }

  // 4. 别称/误写补全
  for (const [re, replacement, label] of INFORMAL_REPLACEMENTS) {
    if (re.test(text)) {
      const next = text.replace(re, replacement)
      steps.push({ label, before: text, after: next })
      text = next
    }
    re.lastIndex = 0
  }

  // 5. 噪声字符清洗
  out = ''
  for (const ch of text) {
    if (!NOISE_CHARS.has(ch)) out += ch
  }
  if (out !== text) {
    steps.push({ label: '标点/空白/噪声清洗', before: text, after: out })
    text = out
  }

  return { text, steps }
}
