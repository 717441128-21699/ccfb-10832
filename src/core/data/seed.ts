// 种子地址库：
// - 省/市/区县用真实名称（覆盖全国主要省市）
// - 街道/小区由词池程序化生成，刻意制造跨区同名路、跨街同名小区
// - 每个节点带别名（简称）与历史名称（改名/合并/撤销，老名字也认得）
import type { AddressLibrary, AddressNode, Level } from '../types'

/* ---------------- 可复现的伪随机（同版本生成结果稳定） ---------------- */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}
function pickN<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const copy = [...arr]
  const out: T[] = []
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0])
  }
  return out
}
function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

/* ---------------- 省市区真实数据 ---------------- */
interface SeedDistrict {
  name: string
  /** 历史名称（改名/老叫法） */
  oldName?: string
  note?: string
}
interface SeedCity {
  name: string
  districts: SeedDistrict[]
}
interface SeedProvince {
  name: string
  short?: string
  cities: SeedCity[]
}

const SEED: SeedProvince[] = [
  {
    name: '广东省', short: '广东',
    cities: [
      {
        name: '广州市',
        districts: [
          { name: '越秀区', oldName: '东区' },
          { name: '海珠区' },
          { name: '天河区' },
          { name: '白云区', oldName: '白云山区' },
          { name: '番禺区' },
        ],
      },
      {
        name: '深圳市',
        districts: [
          { name: '福田区' },
          { name: '罗湖区' },
          { name: '南山区' },
          { name: '宝安区', oldName: '宝安县' },
          { name: '龙岗区' },
        ],
      },
      {
        name: '佛山市',
        districts: [
          { name: '禅城区' },
          { name: '南海区' },
          { name: '顺德区' },
        ],
      },
      {
        name: '东莞市',
        districts: [
          { name: '莞城街道', oldName: '莞城镇' },
          { name: '南城街道' },
          { name: '松山湖', oldName: '松山湖管委会' },
        ],
      },
    ],
  },
  {
    name: '浙江省', short: '浙江',
    cities: [
      {
        name: '杭州市',
        districts: [
          { name: '上城区', oldName: '江干区', note: '2021年江干区并入上城区' },
          { name: '拱墅区', oldName: '下城区', note: '2021年下城区并入拱墅区' },
          { name: '西湖区' },
          { name: '滨江区' },
          { name: '余杭区' },
        ],
      },
      {
        name: '宁波市',
        districts: [
          { name: '海曙区' },
          { name: '江北区' },
          { name: '鄞州区', oldName: '鄞县' },
          { name: '镇海区' },
        ],
      },
      {
        name: '温州市',
        districts: [
          { name: '鹿城区' },
          { name: '龙湾区' },
          { name: '瓯海区' },
        ],
      },
    ],
  },
  {
    name: '江苏省', short: '江苏',
    cities: [
      {
        name: '南京市',
        districts: [
          { name: '玄武区' },
          { name: '秦淮区', oldName: '白下区', note: '2013年白下区并入秦淮区' },
          { name: '建邺区' },
          { name: '鼓楼区' },
          { name: '江宁区' },
        ],
      },
      {
        name: '苏州市',
        districts: [
          { name: '姑苏区', oldName: '平江区', note: '2012年平江/沧浪/金阊合并为姑苏区' },
          { name: '吴中区' },
          { name: '相城区' },
          { name: '工业园区', oldName: '新加坡工业园' },
        ],
      },
      {
        name: '无锡市',
        districts: [
          { name: '梁溪区', oldName: '崇安区', note: '2015年崇安/南长/北塘合并为梁溪区' },
          { name: '滨湖区' },
          { name: '新吴区' },
        ],
      },
      {
        name: '常州市',
        districts: [
          { name: '天宁区' },
          { name: '钟楼区' },
          { name: '新北区' },
        ],
      },
    ],
  },
  {
    name: '山东省', short: '山东',
    cities: [
      {
        name: '济南市',
        districts: [
          { name: '历下区' },
          { name: '市中区' },
          { name: '槐荫区' },
          { name: '历城区' },
          { name: '崂山区' },
        ],
      },
      {
        name: '青岛市',
        districts: [
          { name: '市南区' },
          { name: '市北区' },
          { name: '黄岛区', oldName: '胶南市' },
          { name: '李沧区' },
        ],
      },
      {
        name: '烟台市',
        districts: [
          { name: '芝罘区' },
          { name: '福山区' },
          { name: '牟平区' },
        ],
      },
    ],
  },
  {
    name: '辽宁省', short: '辽宁',
    cities: [
      {
        name: '沈阳市',
        districts: [
          { name: '和平区' },
          { name: '沈河区' },
          { name: '皇姑区' },
          { name: '铁西区' },
        ],
      },
      {
        name: '大连市',
        districts: [
          { name: '中山区' },
          { name: '西岗区' },
          { name: '沙河口区' },
          { name: '甘井子区' },
        ],
      },
    ],
  },
  {
    name: '四川省', short: '四川',
    cities: [
      {
        name: '成都市',
        districts: [
          { name: '锦江区' },
          { name: '青羊区' },
          { name: '金牛区' },
          { name: '武侯区' },
          { name: '成华区' },
        ],
      },
      {
        name: '绵阳市',
        districts: [
          { name: '涪城区' },
          { name: '游仙区' },
          { name: '安州区', oldName: '安县' },
        ],
      },
    ],
  },
  {
    name: '湖北省', short: '湖北',
    cities: [
      {
        name: '武汉市',
        districts: [
          { name: '江岸区' },
          { name: '江汉区' },
          { name: '硚口区' },
          { name: '武昌区' },
          { name: '洪山区' },
        ],
      },
      {
        name: '宜昌市',
        districts: [
          { name: '西陵区' },
          { name: '伍家岗区' },
          { name: '夷陵区', oldName: '宜昌县' },
        ],
      },
    ],
  },
  {
    name: '湖南省', short: '湖南',
    cities: [
      {
        name: '长沙市',
        districts: [
          { name: '芙蓉区' },
          { name: '天心区' },
          { name: '岳麓区' },
          { name: '开福区' },
          { name: '雨花区' },
        ],
      },
      {
        name: '株洲市',
        districts: [
          { name: '荷塘区' },
          { name: '芦淞区' },
          { name: '天元区' },
        ],
      },
      {
        name: '湘潭市',
        districts: [
          { name: '雨湖区' },
          { name: '岳塘区' },
        ],
      },
    ],
  },
  {
    name: '福建省', short: '福建',
    cities: [
      {
        name: '福州市',
        districts: [
          { name: '鼓楼区' },
          { name: '台江区' },
          { name: '仓山区' },
          { name: '晋安区' },
        ],
      },
      {
        name: '厦门市',
        districts: [
          { name: '思明区', oldName: '开元区' },
          { name: '湖里区' },
          { name: '集美区' },
          { name: '同安区' },
        ],
      },
      {
        name: '泉州市',
        districts: [
          { name: '鲤城区' },
          { name: '丰泽区' },
          { name: '洛江区' },
        ],
      },
    ],
  },
  {
    name: '河南省', short: '河南',
    cities: [
      {
        name: '郑州市',
        districts: [
          { name: '中原区' },
          { name: '二七区' },
          { name: '管城区' },
          { name: '金水区' },
        ],
      },
      {
        name: '洛阳市',
        districts: [
          { name: '老城区' },
          { name: '西工区' },
          { name: '涧西区' },
          { name: '洛龙区' },
        ],
      },
    ],
  },
  {
    name: '陕西省', short: '陕西',
    cities: [
      {
        name: '西安市',
        districts: [
          { name: '新城区' },
          { name: '碑林区' },
          { name: '莲湖区' },
          { name: '雁塔区' },
          { name: '未央区' },
        ],
      },
      {
        name: '宝鸡市',
        districts: [
          { name: '渭滨区' },
          { name: '金台区' },
          { name: '陈仓区', oldName: '宝鸡县' },
        ],
      },
    ],
  },
  {
    name: '云南省', short: '云南',
    cities: [
      {
        name: '昆明市',
        districts: [
          { name: '五华区' },
          { name: '盘龙区' },
          { name: '官渡区' },
          { name: '西山区' },
        ],
      },
      {
        name: '大理白族自治州',
        districts: [
          { name: '大理市' },
          { name: '祥云县' },
        ],
      },
    ],
  },
  {
    name: '广西壮族自治区', short: '广西',
    cities: [
      {
        name: '南宁市',
        districts: [
          { name: '兴宁区' },
          { name: '青秀区', oldName: '新城区' },
          { name: '江南区' },
          { name: '西乡塘区' },
        ],
      },
      {
        name: '柳州市',
        districts: [
          { name: '城中区' },
          { name: '鱼峰区' },
          { name: '柳南区' },
        ],
      },
    ],
  },
  {
    name: '安徽省', short: '安徽',
    cities: [
      {
        name: '合肥市',
        districts: [
          { name: '瑶海区' },
          { name: '庐阳区' },
          { name: '蜀山区' },
          { name: '包河区' },
        ],
      },
      {
        name: '芜湖市',
        districts: [
          { name: '镜湖区' },
          { name: '弋江区' },
          { name: '湾沚区', oldName: '芜湖县' },
        ],
      },
    ],
  },
  {
    name: '山西省', short: '山西',
    cities: [
      {
        name: '太原市',
        districts: [
          { name: '小店区' },
          { name: '迎泽区' },
          { name: '杏花岭区' },
          { name: '万柏林区' },
        ],
      },
      {
        name: '大同市',
        districts: [
          { name: '平城区', oldName: '城区' },
          { name: '云冈区', oldName: '南郊区' },
        ],
      },
    ],
  },
  {
    name: '北京市', short: '北京',
    cities: [
      {
        name: '北京市',
        districts: [
          { name: '东城区' },
          { name: '西城区' },
          { name: '朝阳区' },
          { name: '海淀区' },
          { name: '丰台区' },
        ],
      },
    ],
  },
  {
    name: '上海市', short: '上海',
    cities: [
      {
        name: '上海市',
        districts: [
          { name: '黄浦区', oldName: '卢湾区', note: '2011年卢湾区并入黄浦区' },
          { name: '徐汇区' },
          { name: '长宁区' },
          { name: '静安区', oldName: '闸北区', note: '2015年闸北区并入静安区' },
          { name: '浦东新区', oldName: '川沙县' },
        ],
      },
    ],
  },
  {
    name: '天津市', short: '天津',
    cities: [
      {
        name: '天津市',
        districts: [
          { name: '和平区' },
          { name: '河东区' },
          { name: '南开区' },
          { name: '海淀区' },
        ],
      },
    ],
  },
  {
    name: '重庆市', short: '重庆',
    cities: [
      {
        name: '重庆市',
        districts: [
          { name: '渝中区' },
          { name: '江北区' },
          { name: '南岸区' },
          { name: '沙坪坝区' },
        ],
      },
    ],
  },
]

/* ---------------- 街道/小区词池（刻意复用，制造同名） ---------------- */
const ROAD_CORES = [
  '朝阳', '建设', '人民', '解放', '中山', '兴华', '东风', '和平',
  '光明', '滨江', '南湖', '学府', '科技', '工业', '迎宾',
]
const ROAD_SUFFIXES = ['路', '大街', '大道', '街']
const COMMUNITY_CORES = [
  '阳光花园', '幸福里', '翠湖新村', '万科城', '碧桂园',
  '龙湖天玺', '保利公馆', '恒大名都', '绿城公寓', '金茂府',
  '华润家园', '中海国际',
]
const COMMUNITY_SUFFIXES = ['', '小区', '花苑', '家园', '新村']

/** 去掉行政后缀得到的简称后缀 */
const GENERIC_SUFFIXES = [
  '壮族自治区', '回族自治区', '自治区', '自治州', '白族自治州',
  '省', '市', '区', '县', '镇', '乡', '街道', '管委会',
]

function shortName(name: string): string {
  for (const suf of GENERIC_SUFFIXES) {
    if (name.endsWith(suf) && name.length - suf.length >= 2) {
      return name.slice(0, name.length - suf.length)
    }
  }
  return name
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

/* ---------------- 构建完整地址库 ---------------- */
export function buildSeedLibrary(seed = 20261114): AddressLibrary {
  const rng = mulberry32(seed)
  const nodes: Record<string, AddressNode> = {}
  const children: Record<string, string[]> = {}
  const ensureChildList = (id: string) => {
    if (!children[id]) children[id] = []
  }

  let provIdx = 0
  for (const sp of SEED) {
    provIdx++
    const pId = `p${pad(provIdx, 2)}`
    const pAliases = uniq([shortName(sp.name), sp.short ?? ''].filter(Boolean))
    const pNode: AddressNode = {
      id: pId,
      level: 'province',
      name: sp.name,
      code: pad(provIdx, 2) + '0000',
      parentId: null,
      aliases: pAliases,
      history: [],
      weight: 100 - provIdx,
    }
    // 直辖市/自治区的历史叫法
    if (sp.name === '北京市') {
      pNode.history.push({ name: '北平', op: 'rename', year: 1949, note: '1949年北平改称北京' })
    }
    if (sp.name === '陕西省') {
      pNode.history.push({ name: '秦', op: 'rename', note: '历史别称' })
    }
    nodes[pId] = pNode
    ensureChildList(pId)

    // 自治州这类没有地级市的节点
    if (!sp.cities.length) continue

    let cityIdx = 0
    for (const sc of sp.cities) {
      cityIdx++
      const cId = `${pId}c${pad(cityIdx, 2)}`
      const cAliases = uniq([shortName(sc.name)].filter((s) => s.length >= 2))
      const cNode: AddressNode = {
        id: cId,
        level: 'city',
        name: sc.name,
        code: pad(provIdx, 2) + pad(cityIdx, 2) + '00',
        parentId: pId,
        aliases: cAliases,
        history: [],
        weight: Math.floor(rng() * 80) + 20,
      }
      // 城市级老名字示例
      if (sc.name === '西安市') {
        cNode.history.push({ name: '长安', op: 'rename', note: '汉唐旧称' })
      }
      if (sc.name === '杭州市') {
        cNode.history.push({ name: '临安府', op: 'rename', note: '南宋旧称' })
      }
      nodes[cId] = cNode
      children[pId].push(cId)
      ensureChildList(cId)

      // 撤销/合并的老区县（保留节点，状态为 revoke，老名字仍可命中）
      if (rng() < 0.6) {
        const revId = `${cId}d90`
        const mergedInto = `${cId}d01`
        const revName = `老${shortName(sc.name)}城`
        const revNode: AddressNode = {
          id: revId,
          level: 'district',
          name: `${revName}区`,
          code: pad(provIdx, 2) + pad(cityIdx, 2) + '90',
          parentId: cId,
          aliases: [revName],
          history: [
            {
              name: revName,
              op: 'revoke',
              year: 2000 + Math.floor(rng() * 20),
              relatedId: mergedInto,
              note: '区划调整撤销，辖区并入现行政区',
            },
          ],
          weight: 1,
        }
        nodes[revId] = revNode
        children[cId].push(revId)
      }

      let dIdx = 0
      for (const sd of sc.districts) {
        dIdx++
        const dId = `${cId}d${pad(dIdx, 2)}`
        const dAliases = uniq([shortName(sd.name)].filter((s) => s.length >= 2))
        const dNode: AddressNode = {
          id: dId,
          level: 'district',
          name: sd.name,
          code: pad(provIdx, 2) + pad(cityIdx, 2) + pad(dIdx, 2),
          parentId: cId,
          aliases: dAliases,
          history: [],
          weight: Math.floor(rng() * 80) + 20,
        }
        if (sd.oldName) {
          dNode.history.push({
            name: sd.oldName,
            op: 'rename',
            year: 1990 + Math.floor(rng() * 30),
            note: sd.note ?? '行政区划改名/合并',
          })
        }
        nodes[dId] = dNode
        children[cId].push(dId)
        ensureChildList(dId)

        // 每个区 6 条路，从同一词池抽 -> 大量跨区同名路
        const roads = pickN(rng, ROAD_CORES, 6)
        let sIdx = 0
        for (const core of roads) {
          sIdx++
          const suffix = pick(rng, ROAD_SUFFIXES)
          const roadName = core + suffix
          const sId = `${dId}s${pad(sIdx, 2)}`
          const sAliases = uniq(
            ROAD_SUFFIXES.filter((x) => x !== suffix).map((x) => core + x),
          )
          const sNode: AddressNode = {
            id: sId,
            level: 'street',
            name: roadName,
            code: dNode.code + pad(sIdx, 3),
            parentId: dId,
            aliases: sAliases,
            history: [],
            weight: Math.floor(rng() * 90) + 10,
          }
          // 少量道路改名
          if (rng() < 0.18) {
            sNode.history.push({
              name: core + pick(rng, ['路', '街']),
              op: 'rename',
              note: '道路更名',
            })
          }
          nodes[sId] = sNode
          children[dId].push(sId)
          ensureChildList(sId)

          // 每条路 3 个小区，从同一词池抽 -> 跨街同名小区
          const comms = pickN(rng, COMMUNITY_CORES, 3)
          let mIdx = 0
          for (const cc of comms) {
            mIdx++
            const mSuffix = pick(rng, COMMUNITY_SUFFIXES)
            const mName = cc + mSuffix
            const mId = `${sId}m${pad(mIdx, 2)}`
            const mAliases = uniq(
              COMMUNITY_SUFFIXES.filter((x) => x && x !== mSuffix).map((x) => cc + x),
            )
            // 简称：去掉 小区/花苑 等后缀后的核心名
            if (cc.length >= 2) mAliases.push(cc)
            const mNode: AddressNode = {
              id: mId,
              level: 'community',
              name: mName,
              code: sNode.code + pad(mIdx, 3),
              parentId: sId,
              aliases: uniq(mAliases),
              history: [],
              weight: Math.floor(rng() * 90) + 10,
            }
            if (rng() < 0.12) {
              mNode.history.push({
                name: cc + pick(rng, ['新村', '家属院']),
                op: 'rename',
                note: '小区更名',
              })
            }
            nodes[mId] = mNode
            children[sId].push(mId)
          }
        }
      }
    }
  }

  const lib: AddressLibrary = {
    version: 1,
    importedAt: new Date(0).toISOString(),
    source: '内置种子地址库',
    nodes,
    children,
  }
  return lib
}

/** 统计各级节点数 */
export function countByLevel(lib: AddressLibrary): Record<Level, number> {
  const out: Record<Level, number> = {
    province: 0, city: 0, district: 0, street: 0, community: 0,
  }
  for (const n of Object.values(lib.nodes)) out[n.level]++
  return out
}
