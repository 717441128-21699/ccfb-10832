// 形近字分组：面单 OCR/手写常见识别错误
const CONFUSABLE_GROUPS: string[][] = [
  ['己', '已', '巳'],
  ['土', '士'],
  ['末', '未'],
  ['戊', '戌', '戍'],
  ['人', '入'],
  ['王', '玉'],
  ['日', '曰'],
  ['口', '囗'],
  ['贝', '见'],
  ['厂', '广'],
  ['几', '儿'],
  ['千', '干'],
  ['目', '日'],
  ['木', '本'],
  ['工', '土'],
  ['失', '矢'],
  ['大', '太'],
  ['九', '丸'],
  ['予', '矛'],
  ['今', '令'],
  ['卯', '印'],
  ['庄', '压'],
  ['己', '已', '巳'],
  ['土', '士', '工'],
  ['末', '未'],
  ['王', '玉'],
  ['日', '目'],
  ['大', '太', '犬'],
  ['工', '土'],
  ['千', '干'],
  ['贝', '见'],
  ['厂', '广'],
  ['人', '入'],
]

// 并查集归并重复/传递组
const parent = new Map<string, string>()
const find = (x: string): string => {
  let root = x
  while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
  let cur = x
  while (parent.get(cur) !== root) {
    const next = parent.get(cur)!
    parent.set(cur, root)
    cur = next
  }
  return root
}
const union = (a: string, b: string): void => {
  if (!parent.has(a)) parent.set(a, a)
  if (!parent.has(b)) parent.set(b, b)
  const ra = find(a)
  const rb = find(b)
  if (ra !== rb) parent.set(ra, rb)
}
for (const group of CONFUSABLE_GROUPS) {
  for (let i = 1; i < group.length; i++) union(group[0], group[i])
}

const charGroup = new Map<string, number>()
{
  const rootToId = new Map<string, number>()
  let nextId = 0
  const allChars = new Set<string>()
  for (const g of CONFUSABLE_GROUPS) for (const ch of g) allChars.add(ch)
  for (const ch of allChars) {
    const root = find(ch)
    let id = rootToId.get(root)
    if (id === undefined) { id = nextId++; rootToId.set(root, id) }
    charGroup.set(ch, id)
  }
}

export function visualKey(ch: string): string {
  const g = charGroup.get(ch)
  return g === undefined ? ch : `v${g}`
}

export function visualSequence(text: string): string {
  let out = ''
  for (const ch of text) out += visualKey(ch)
  return out
}

export function isConfusable(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    const ga = charGroup.get(a[i])
    const gb = charGroup.get(b[i])
    if (ga === undefined || ga !== gb) return false
  }
  return true
}

/** 形近替换伙伴表（造数器注入 OCR 故障用） */
export function confusablePartners(): Map<string, string[]> {
  const groups = new Map<number, string[]>()
  for (const [ch, id] of charGroup) {
    const arr = groups.get(id) ?? []
    arr.push(ch)
    groups.set(id, arr)
  }
  const out = new Map<string, string[]>()
  for (const arr of groups.values()) {
    for (const ch of arr) out.set(ch, arr.filter((x) => x !== ch))
  }
  return out
}
