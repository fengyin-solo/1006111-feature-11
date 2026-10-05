// 验证服务层：越权/跨单位拒收、监理只读、频次仅负责人、实测幂等 upsert、原子事务。
// 用内存版 localStorage 桩驱动真实的 local-store + local-service（不依赖浏览器）。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'svc-'))
const entry = join(dir, 'harness.ts')

const harness = `
import {
  listMonitoring, listSettlement, registerBuilding, updateOwnershipFields,
  submitMeasuredSettlement, adjustFrequency, deployBuildingPoint, releaseBuildingAlarm,
} from '@/api/local-service'

const NEW_LEAD = { key: 'nl', label: '周敏', org: '宏晟盾构监测中心', role: 'owner_lead' }
const NEW_STAFF = { key: 'ns', label: '李航', org: '宏晟盾构监测中心', role: 'owner_staff' }
const OLD_LEAD = { key: 'ol', label: '陈建国', org: '中铁城建设备管理部', role: 'owner_lead' }
const SUP = { key: 's', label: '赵工', org: '城市轨道监理公司', role: 'supervisor' }

const out = []
const check = (name, cond, extra = '') => out.push({ name, ok: !!cond, extra })

// 种子含一条新单位对象 id=4 监测中（9.6/25）
let v = listMonitoring()
const target = v.items.find(r => r['对象编号'] === 'BLD-2026-004')
check('初始报警点同源为2（样例中002、005越限）', v.alarmCount === 2, String(v.alarmCount))
check('地表沉降页同源报警数同为2', listSettlement().buildingAlarmCount === 2)

// 1) 跨单位改动拒收
let res = updateOwnershipFields(Number(target.id), { allowable: '50' }, OLD_LEAD)
check('老单位改新单位对象的允许沉降被拒收', res.ok === false && res.message.includes('归属'), res.message)
res = updateOwnershipFields(Number(target.id), { code: 'X' }, NEW_STAFF)
check('本单位监测员可改编号', res.ok === true, res.message)
res = updateOwnershipFields(Number(target.id), { code: 'BLD-2026-004' }, NEW_STAFF)
check('编号改回（恢复现场）', res.ok)

// 2) 监理只读
res = updateOwnershipFields(Number(target.id), { allowable: '50' }, SUP)
check('监理改允许沉降拒收', res.ok === false && res.message.includes('只读'), res.message)
res = submitMeasuredSettlement(Number(target.id), '11', SUP)
check('监理提交实测拒收', res.ok === false)
res = adjustFrequency(Number(target.id), '3次/日', SUP)
check('监理调频次拒收', res.ok === false)
res = registerBuilding({ code: 'T-1', name: 't', structure: '', distance: '', deployDate: '2026-06-09', pointLocation: '', allowable: '20', frequency: '1次/日' }, SUP)
check('监理登记拒收', res.ok === false)

// 3) 频次仅本单位负责人
res = adjustFrequency(Number(target.id), '4次/日', NEW_STAFF)
check('监测员调频次被拒', res.ok === false && res.message.includes('负责人'), res.message)
res = adjustFrequency(Number(target.id), '4次/日', OLD_LEAD)
check('跨单位负责人调频次被拒', res.ok === false)
res = adjustFrequency(Number(target.id), '2次/日', NEW_LEAD)
check('本单位负责人调频次成功', res.ok === true, res.message)
res = adjustFrequency(Number(target.id), '3次/日', NEW_LEAD)
check('重复调整覆盖为最后一次', res.ok === true)
check('频次只剩最后一次的值3次/日', listMonitoring().items.find(r => r.id === target.id)['监测频次'] === '3次/日')

// 4) 实测幂等 upsert：反复提交，记录条数不变，报警随最新值
const beforeCount = listMonitoring().total
res = submitMeasuredSettlement(Number(target.id), '24', NEW_LEAD)
check('24/25 未超限不报', res.ok === true && !res.message.includes('自动报警'), res.message)
res = submitMeasuredSettlement(Number(target.id), '24', NEW_LEAD)
check('重复提交同一值仍成功且只一条', res.ok === true)
res = submitMeasuredSettlement(Number(target.id), '27.5', NEW_STAFF)
check('27.5>25 自动报警并带位置/幅度/标准',
  res.message.includes('自动报警') && res.message.includes('+2.5mm') && res.message.includes('GB 50911'), res.message)
check('建筑条数没增加（upsert 只一条）', listMonitoring().total === beforeCount)
check('报警点同源变为3', listMonitoring().alarmCount === 3 && listSettlement().buildingAlarmCount === 3)
const alarmRow = listSettlement().buildingAlarms.find(a => a['对象编号'] === 'BLD-2026-004')
check('台账报警行带测点位置与标准', alarmRow['测点位置'] === '裙楼西侧沉降缝' && String(alarmRow['判据标准']).includes('GB 50911'))

// 非数值提交拒收
res = submitMeasuredSettlement(Number(target.id), 'abc', NEW_LEAD)
check('非数值实测拒收', res.ok === false)

// 5) 解除报警两边同源撤回
res = releaseBuildingAlarm(Number(target.id), NEW_STAFF)
check('本单位可解除报警', res.ok === true, res.message)
check('解除后两边报警数同步回到2', listMonitoring().alarmCount === 2 && listSettlement().buildingAlarmCount === 2)
res = releaseBuildingAlarm(Number(target.id), NEW_LEAD)
check('非报警态重复解除提示无需解除', res.ok === false)

// 6) 登记幂等：同编号反复提交只入一条
const draft = { code: 'BLD-2026-900', name: '新楼', structure: '框架', distance: '6m', deployDate: '2026-06-20', pointLocation: '新楼角点', allowable: '18', frequency: '1次/日' }
res = registerBuilding(draft, NEW_STAFF)
check('首次登记成功且按布点时间归新单位', res.ok === true && res.message.includes('宏晟盾构监测中心'), res.message)
const afterFirst = listMonitoring().total
res = registerBuilding(draft, NEW_LEAD)
check('重复编号登记只保留一条', res.ok === false && listMonitoring().total === afterFirst)

// 布点时间在交接前 -> 老单位
res = registerBuilding({ ...draft, code: 'BLD-2026-901', deployDate: '2026-05-20' }, NEW_STAFF)
check('布点在交接前自动归老单位', res.ok === true && res.message.includes('中铁城建设备管理部'), res.message)

// 待布点对象布设测点
const pending = listMonitoring().items.find(r => r['对象编号'] === 'BLD-2026-003')
res = deployBuildingPoint(Number(pending.id), OLD_LEAD)
check('跨单位布设被拒', res.ok === false)
res = deployBuildingPoint(Number(pending.id), NEW_LEAD)
check('本单位布设成功', res.ok === true && res.message.includes('监测中'))

console.log(JSON.stringify(out.filter(x => !x.ok), null, 2))
const failed = out.filter(x => !x.ok)
console.log(failed.length ? 'FAILED ' + failed.length : 'ALL PASS ' + out.length)
process.exit(failed.length ? 1 : 0)
`
writeFileSync(entry, harness)

const outfile = join(dir, 'bundle.mjs')

// 内存 localStorage 桩，在 bundle 执行前注入
const shimDir = mkdtempSync(join(tmpdir(), 'shim-'))
const shim = join(shimDir, 'local-storage-shim.ts')
writeFileSync(
  shim,
  `
const memory = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => { memory.set(k, String(v)) },
    removeItem: (k: string) => { memory.delete(k) },
  },
}
`,
)

await build({
  entryPoints: [shim, entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: dir,
  entryNames: '[name]',
  alias: { '@': join(process.cwd(), 'src') },
})
// 先执行 shim 再执行 harness：写成一个引导文件
const boot = join(dir, 'boot.mjs')
writeFileSync(boot, `import './local-storage-shim.js'; import './harness.js'`)
await import(pathToFileURL(boot).href)
