// 用 esbuild（vite 自带依赖）把监测领域纯函数打包到临时文件后在 node 中执行，校验业务口径。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mon-'))
const entry = join(dir, 'harness.ts')

const harness = `
import { reconcileTables, listAlarms, evaluateOverLimit, ownerOfDeployDate, OWNER_OLD, OWNER_NEW, HANDOVER_DATE } from '@/data/monitoring'

function makeTables(buildings) {
  return { building: buildings, settlement: [
    { id: 1, status: '正常', pending: true, abnormal: false, 测点编号: 'SETT-0001', 测点位置: 'x', 初始高程: '10', 累计沉降: '2', 沉降速率: '1', 预警阈值: '20', 监测日期: '2026-09-01', 测点状态: '正常' },
  ] }
}

const out = []
const check = (name, cond, extra='') => out.push({ name, ok: !!cond, extra })

// 1) 存量回填：缺权属/布点时间的老数据按编号奇偶确定性划归
const legacy = [
  { id: 1, status: '待布点', pending: true, abnormal: false, 对象编号: 'BUIL-0001', 建筑物名称: '老楼1', 允许沉降: '建筑样例1', 实测沉降: '建筑样例1' },
  { id: 2, status: '已报警', pending: false, abnormal: false, 对象编号: 'BUIL-0002', 建筑物名称: '老楼2', 允许沉降: '建筑样例2', 实测沉降: '建筑样例2' },
]
let r = reconcileTables(makeTables(legacy), '2026-10-05')
const b1 = r.tables.building.find(x => x.id === 1)
const b2 = r.tables.building.find(x => x.id === 2)
check('奇数编号回填交接前->老单位', b1['权属单位'] === OWNER_OLD && b1['布点时间'] < HANDOVER_DATE, b1['权属单位'] + ' ' + b1['布点时间'])
check('偶数编号回填交接后->新单位', b2['权属单位'] === OWNER_NEW && b2['布点时间'] >= HANDOVER_DATE, b2['权属单位'] + ' ' + b2['布点时间'])
check('老占位允许沉降原样保留待复核(不编造默认值)', b1['允许沉降'] === '建筑样例1' && b1['数据复核'] === '待复核')
check('数值无法解析的老报警保留为已报警(待复核)', b2.status === '已报警')
const reviewLedger = listAlarms(r.tables.settlement).find(a => a['对象编号'] === 'BUIL-0002')
check('待复核台账行带待复核标注', reviewLedger && String(reviewLedger['测点状态']).includes('待复核'))

// 2) 越限自动报警 + 同源
const fresh = [
  { id: 1, status: '监测中', pending: true, abnormal: false, 对象编号: 'B-1', 建筑物名称: '甲楼', 权属单位: OWNER_NEW, 布点时间: '2026-06-10', 测点位置: '甲楼东北角', 允许沉降: '15', 实测沉降: '12', 监测频次: '1次/日', 判据标准: 'GB 50911-2013', 监测状态: '监测中' },
  { id: 2, status: '监测中', pending: true, abnormal: false, 对象编号: 'B-2', 建筑物名称: '乙楼', 权属单位: OWNER_OLD, 布点时间: '2026-05-10', 测点位置: '乙楼山墙', 允许沉降: '10', 实测沉降: '13.5', 监测频次: '2次/日', 判据标准: 'GB 50911-2013', 监测状态: '监测中' },
  { id: 3, status: '已报警', pending: false, abnormal: true, 对象编号: 'B-3', 建筑物名称: '丙楼', 权属单位: OWNER_NEW, 布点时间: '2026-07-01', 测点位置: '丙楼', 允许沉降: '20', 实测沉降: '5', 监测频次: '1次/日', 判据标准: 'GB 50911-2013', 监测状态: '已报警' },
]
r = reconcileTables(makeTables(fresh), '2026-10-05')
const alarms = listAlarms(r.tables.settlement)
check('只有真正越限的B-2进报警台账', alarms.length === 1 && alarms[0]['对象编号'] === 'B-2', alarms.map(a => a['对象编号']).join(','))
check('建筑页B-2状态对账为已报警', r.tables.building.find(x => x.id === 2).status === '已报警')
check('B-3未超限被台账口径纠回监测中', r.tables.building.find(x => x.id === 3).status === '监测中')
check('报警带测点位置', alarms[0]['测点位置'] === '乙楼山墙')
check('报警带超限幅度+3.5mm', alarms[0]['超限幅度'] === '+3.5mm')
check('报警写清判定标准', String(alarms[0]['判据标准']).includes('GB 50911-2013'))
check('原地表测点不被污染', r.tables.settlement.filter(x => x['报警来源'] !== 'building').length === 1)

// 3) 幂等：反复对账不重复入台账
const r2 = reconcileTables(JSON.parse(JSON.stringify(r.tables)), '2026-10-05')
check('重复对账报警仍只有1条', listAlarms(r2.tables.settlement).length === 1)
// 台账已有行而对象不再越限 -> 撤回（两处同时减一）
const released = JSON.parse(JSON.stringify(r.tables))
released.building.find(x => x.id === 2).status = '已解除'
const r3 = reconcileTables(released, '2026-10-05')
check('解除后报警台账同步清零', listAlarms(r3.tables.settlement).length === 0)

// 4) 判据函数
check('等于允许值不报警', evaluateOverLimit({ 允许沉降: '15', 实测沉降: '15' }).over === false)
check('带mm单位可解析', evaluateOverLimit({ 允许沉降: '15mm', 实测沉降: '16.2mm' }).margin === 1.2)
check('非数值占位返回不可解析', evaluateOverLimit({ 允许沉降: '建筑样例', 实测沉降: '建筑样例' }).parseable === false)
check('权属划定基准日当天归新单位', ownerOfDeployDate(HANDOVER_DATE) === OWNER_NEW)

console.log(JSON.stringify(out, null, 2))
const failed = out.filter(x => !x.ok)
if (failed.length) { console.error('FAILED', failed.length); process.exit(1) } else { console.log('ALL PASS', out.length) }
`
writeFileSync(entry, harness)

const outfile = join(dir, 'bundle.mjs')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': join(process.cwd(), 'src') },
})
await import(pathToFileURL(outfile).href)
