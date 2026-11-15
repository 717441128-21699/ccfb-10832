// 同音字/近音字分组：用于同音字纠错与模糊匹配
// 每组内的字读音相同或相近（含南方面言常见的 n/ng、l/n 混淆）
const HOMOPHONE_GROUPS: string[][] = [
  ['朝', '潮', '巢'],
  ['州', '周', '洲'],
  ['路', '陆', '璐'],
  ['街', '接', '结', '节'],
  ['区', '曲', '驱', '屈'],
  ['园', '元', '原', '圆', '源', '员', '缘'],
  ['苑', '院', '愿'],
  ['蓝', '兰', '篮'],
  ['碧', '壁'],
  ['桂', '贵'],
  ['明', '名', '鸣'],
  ['庭', '亭', '廷'],
  ['安', '按', '案', '鞍'],
  ['康', '慷'],
  ['丰', '风', '封', '枫', '峰', '锋'],
  ['龙', '隆', '笼'],
  ['凤', '奉'],
  ['华', '化'],
  ['兴', '星'],
  ['新', '心', '欣'],
  ['广', '光'],
  ['庆', '清', '青', '轻'],
  ['福', '副', '富', '付', '府', '辅', '抚'],
  ['建', '见', '健', '件'],
  ['业', '叶', '夜', '邺'],
  ['创', '闯'],
  ['万', '晚'],
  ['达', '答'],
  ['保', '宝', '包'],
  ['利', '立', '丽', '力', '莉'],
  ['恒', '衡'],
  ['绿', '律'],
  ['珠', '朱', '猪', '主'],
  ['家', '佳', '嘉'],
  ['宁', '凝'],
  ['阳', '杨', '洋', '扬'],
  ['阴', '音'],
  ['东', '冬'],
  ['西', '希', '溪', '锡', '夕'],
  ['南', '男'],
  ['中', '钟', '忠', '终'],
  ['滨', '宾'],
  ['湖', '胡'],
  ['河', '合', '和', '菏'],
  ['江', '姜'],
  ['桥', '乔'],
  ['关', '官', '观'],
  ['里', '理', '李'],
  ['号', '浩'],
  ['栋', '动'],
  ['楼', '娄'],
  ['湾', '弯'],
  ['岛', '导'],
  ['营', '迎', '盈'],
  ['顺', '舜'],
  ['辽', '聊'],
  ['沈', '审'],
  ['唐', '堂'],
  ['浦', '普', '濮'],
  ['汇', '会'],
  ['徐', '许'],
  ['静', '靖', '净', '敬'],
  ['闵', '敏'],
  ['罗', '螺'],
  ['冈', '刚', '钢', '岗'],
  ['坝', '霸'],
  ['拱', '共'],
  ['墅', '树'],
  ['余', '鱼', '于', '榆'],
  ['武', '五', '伍', '梧'],
  ['秦', '勤'],
  ['淮', '怀'],
  ['鼓', '古'],
  ['栖', '七'],
  ['霞', '下'],
  ['锦', '紧', '仅'],
  ['侯', '猴'],
  ['高', '糕'],
  ['淀', '店'],
  ['台', '太', '泰'],
  ['义', '意', '易', '艺'],
  ['乌', '污'],
  ['齐', '奇', '其'],
  ['抚', '府', '福', '辅'],
  ['盘', '潘'],
  ['港', '岗'],
  ['宿', '素'],
  ['迁', '千'],
  ['盐', '言', '严', '岩'],
  ['镇', '阵'],
  ['泰', '太', '台'],
  ['绍', '少', '韶'],
  ['衢', '渠'],
  ['芜', '无', '吴'],
  ['埠', '不', '布'],
  ['漳', '章'],
  ['淄', '资', '滋'],
  ['潍', '维'],
  ['威', '微'],
  ['临', '林'],
  ['沂', '宜', '姨'],
  ['泽', '则'],
  ['顶', '鼎'],
  ['鹤', '贺'],
  ['焦', '交'],
  ['漯', '洛', '落'],
  ['峡', '狭'],
  ['丘', '秋'],
  ['驻', '住'],
  ['堰', '燕', '雁'],
  ['襄', '香'],
  ['樊', '凡'],
  ['荆', '京', '经'],
  ['岳', '月', '越'],
  ['郴', '陈'],
  ['源', '园', '元', '缘'],
  ['汕', '善'],
  ['湛', '站'],
  ['肇', '照'],
  ['惠', '慧'],
  ['尾', '伟', '卫', '渭'],
  ['贡', '共'],
  ['攀', '潘'],
  ['泸', '卢'],
  ['遂', '岁'],
  ['充', '冲'],
  ['眉', '梅'],
  ['雅', '亚'],
  ['凉', '梁'],
  ['铜', '同'],
  ['咸', '闲'],
  ['延', '言'],
  ['峪', '玉'],
  ['昌', '长', '常'],
  ['银', '寅'],
  ['掖', '业'],
  ['曲', '区', '屈'],
  ['洱', '耳'],
  ['沧', '仓'],
  ['纳', '那'],
  ['勐', '猛'],
  ['防', '房'],
  ['钦', '亲'],
  ['池', '迟'],
  ['崇', '虫'],
  ['朔', '硕'],
  ['门', '们'],
  ['口', '叩'],
  ['城', '成', '程'],
  ['石', '时', '十'],
  ['沙', '纱'],
  ['白', '百'],
  ['云', '运', '允'],
  ['番', '翻'],
  ['田', '甜'],
  ['秀', '绣'],
  ['越', '月', '岳'],
  ['黄', '皇'],
  ['长', '常', '昌'],
  ['宝', '保'],
  ['行', '星'],
  ['入', '人'],
  ['土', '吐'],
  ['工', '公', '功'],
  ['科', '棵', '颗'],
  ['技', '纪', '记', '街', '结'],
  ['学', '雪', '穴'],
  ['港', '岗', '冈'],
  ['西', '希', '溪', '锡', '夕'],
  ['杨', '阳', '洋', '扬'],
  ['府', '抚', '福', '辅'],
  ['结', '街', '接', '节', '技'],
  ['大', '达', '打'],
  ['道', '到', '倒'],
  ['港', '岗', '冈', '刚', '钢'],
  ['城', '成', '程', '诚'],
  ['云', '运', '允', '匀'],
  ['南', '男', '难'],
  ['岗', '港', '冈'],
  ['打', '大', '达'],
  ['节', '街', '结', '接'],
  ['太', '泰', '台'],
  ['工', '公', '功', '攻', '士', '师', '失'],
]

// 并查集归并：一个字可能出现在多个组（如 港/岗、岗/冈），需要传递闭包合成同一组
const parent = new Map<string, string>()
const find = (x: string): string => {
  let root = x
  while (parent.get(root) !== root && parent.has(root)) root = parent.get(root)!
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
for (const group of HOMOPHONE_GROUPS) {
  for (let i = 1; i < group.length; i++) union(group[0], group[i])
}

const charGroup = new Map<string, number>()
{
  const rootToId = new Map<string, number>()
  let nextId = 0
  const allChars = new Set<string>()
  for (const g of HOMOPHONE_GROUPS) for (const ch of g) allChars.add(ch)
  for (const ch of allChars) {
    const root = find(ch)
    let id = rootToId.get(root)
    if (id === undefined) { id = nextId++; rootToId.set(root, id) }
    charGroup.set(ch, id)
  }
}

/** 同音字键：同组字归并为同一键，未收录字用自身 */
export function homophoneKey(ch: string): string {
  const g = charGroup.get(ch)
  return g === undefined ? ch : `#${g}`
}

/** 整词的同音字键序列，键序列相同即读音可匹配 */
export function homophoneSequence(text: string): string {
  let out = ''
  for (const ch of text) out += homophoneKey(ch)
  return out
}

export function isHomophone(a: string, b: string): boolean {
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

/** 每个字在同组内的可替换伙伴（造数器注入同音字故障用，保证可被纠回） */
export function homophonePartners(): Map<string, string[]> {
  // 按并查集归并后的组构建，保证注入的错字一定能被纠回
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
