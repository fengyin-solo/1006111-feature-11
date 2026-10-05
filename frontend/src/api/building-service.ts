import { listRows, saveRows } from '@/data/local-store'
import {
  ALARM_STANDARD,
  DEFAULT_ALLOW_MM,
  OWNER_UNITS,
  WARNING_RATIO,
  getOwnerUnit,
  leaderOf,
} from '@/data/ownership'
import type { ActionResult, AlarmLevel, AlarmPoint, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

// 建筑监测（监测对象台账）域服务。
// 口径（拍板）：本台账的允许沉降/实测沉降是报警判定的唯一权威数据源；
// 地表沉降页的报警清单只做只读投影，两边点数同源，不一致一律以本台账为准。

export const BUILDING_KEY = 'building'

// 仅当前权属单位可维护的字段：对象编号、允许沉降。
export const EXCLUSIVE_FIELDS = ['对象编号', '允许沉降'] as const
// 权属单位内可维护的普通字段。
export const ORDINARY_FIELDS = ['建筑物名称', '结构类型', '距隧道距离', '实测沉降', '监测状态'] as const

function rows(): EntryRow[] {
  return listRows(BUILDING_KEY)
}

// 整包写入：失败（配额/隐私模式）时缓存不动，返回 false，由调用方向上拒收。
function commit(next: EntryRow[]): boolean {
  return saveRows(BUILDING_KEY, next)
}

function parseMm(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  if (!text) {
    return null
  }
  // 必须数字打头：老数据里“建筑监测样例1”这类含数字的占位串一律视为无效。
  const matched = text.match(/^-?\d+(\.\d+)?/)
  if (!matched) {
    return null
  }
  // 数字之后只允许 mm 与空白，夹带其它文字说明的也不认。
  const rest = text.slice(matched[0].length).trim().toLowerCase()
  if (rest && !/^mm$/.test(rest)) {
    return null
  }
  return Number(matched[0])
}

function allowOf(row: EntryRow): number {
  return parseMm(row['允许沉降']) ?? DEFAULT_ALLOW_MM
}

function measuredOf(row: EntryRow): number | null {
  return parseMm(row['实测沉降'])
}

export type AlarmConclusion = {
  level: AlarmLevel
  measuredMm: number | null
  allowMm: number
  overMm: number
}

// 判定口径：实测沉降 > 允许沉降控制值 => 报警；达到允许值80% => 预警；其余正常。
// 待布点/无实测值的对象不参与报警判定。
export function evaluateAlarm(row: EntryRow): AlarmConclusion {
  const allowMm = allowOf(row)
  const measuredMm = measuredOf(row)
  if (String(row.status) === '待布点' || measuredMm === null) {
    return { level: '正常', measuredMm, allowMm, overMm: 0 }
  }
  const overMm = Number((measuredMm - allowMm).toFixed(2))
  if (measuredMm > allowMm) {
    return { level: '报警', measuredMm, allowMm, overMm }
  }
  if (measuredMm >= allowMm * WARNING_RATIO) {
    return { level: '预警', measuredMm, allowMm, overMm: 0 }
  }
  return { level: '正常', measuredMm, allowMm, overMm: 0 }
}

function pointOf(row: EntryRow): AlarmPoint {
  const conclusion = evaluateAlarm(row)
  return {
    objectNo: String(row['对象编号'] ?? ''),
    name: String(row['建筑物名称'] ?? ''),
    location: `${String(row['建筑物名称'] ?? '')}（${String(row['对象编号'] ?? '')}）`,
    ownerUnit: String(row['权属单位'] ?? ''),
    level: conclusion.level,
    measuredMm: conclusion.measuredMm ?? 0,
    allowMm: conclusion.allowMm,
    overMm: conclusion.overMm,
    standard: ALARM_STANDARD,
    deployDate: String(row['布点时间'] ?? ''),
    status: String(row.status ?? ''),
  }
}

// 报警清单：建筑台账投影，地表沉降页与本页都从这里取，同一份取数。
export function listAlarmPoints(): AlarmPoint[] {
  return rows()
    .map(pointOf)
    .filter((point) => point.level === '预警' || point.level === '报警')
}

export function countAlarmPoints(): number {
  return rows().filter((row) => evaluateAlarm(row).level === '报警').length
}

function persistWithAlarmSync(updated: EntryRow[]): boolean {
  const synced = updated.map((row) => {
    const level = evaluateAlarm(row).level
    const alarming = level === '报警'
    const status = String(row.status)
    if (status === '待布点' || status === '已解除') {
      return row
    }
    const target = alarming ? '已报警' : '监测中'
    if (status === target && row.abnormal === alarming) {
      return row
    }
    const stamped: EntryRow = { ...row, status: target, abnormal: alarming }
    if (alarming && !stamped['报警时间']) {
      stamped['报警时间'] = nowText()
    }
    if (!alarming && stamped['报警时间']) {
      delete stamped['报警时间']
    }
    stamped['监测状态'] = target
    return stamped
  })
  return commit(synced)
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function findByNo(no: string, exceptId?: number): EntryRow | undefined {
  return rows().find((row) => String(row['对象编号'] ?? '') === no && Number(row.id) !== exceptId)
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function session() {
  return useSessionStore()
}

type SessionLike = { role: string; unit: string; name: string }

// 权限判定：监理只读；专属字段要本单位（监测负责人可改，监测员由参数决定）；其余按角色。
export function canEditExclusive(sessionLike: SessionLike, row: EntryRow): boolean {
  if (sessionLike.role === 'supervisor' || sessionLike.role === 'admin') {
    return false
  }
  return sessionLike.role === 'leader' && sessionLike.unit === String(row['权属单位'] ?? '')
}

export function canEditOrdinary(sessionLike: SessionLike, row: EntryRow): boolean {
  if (sessionLike.role === 'supervisor') {
    return false
  }
  if (sessionLike.role === 'admin') {
    return true
  }
  return sessionLike.unit === String(row['权属单位'] ?? '')
}

export function canAdjustFrequency(sessionLike: SessionLike, row: EntryRow): boolean {
  // 只有本单位的监测负责人能调整监测频次。
  return sessionLike.role === 'leader' && sessionLike.unit === String(row['权属单位'] ?? '')
}

export function canTransfer(sessionLike: SessionLike, row: EntryRow): boolean {
  // 权属移交：本单位监测负责人或值班管理员可发起。
  if (sessionLike.role === 'admin') {
    return true
  }
  return sessionLike.role === 'leader' && sessionLike.unit === String(row['权属单位'] ?? '')
}

export function canDeploy(sessionLike: SessionLike, row: EntryRow): boolean {
  if (sessionLike.role === 'supervisor') {
    return false
  }
  return sessionLike.role === 'admin' || sessionLike.unit === String(row['权属单位'] ?? '')
}

export type CreateInput = {
  对象编号: string
  建筑物名称: string
  结构类型: string
  距隧道距离: string
  允许沉降: string
  实测沉降?: string
  监测频次?: string
  权属单位?: string
}

// 登记监测对象。反复提交同一对象编号只入一条：命中重复直接拒收。
export function createBuilding(input: CreateInput): ActionResult {
  const s = session()
  if (s.role === 'supervisor') {
    return fail('监理共享副本为只读，没有登记入口')
  }
  const no = input.对象编号.trim()
  if (!no) {
    return fail('对象编号不能为空')
  }
  if (findByNo(no)) {
    return fail(`对象编号 ${no} 已存在，重复提交只保留一条`)
  }
  let ownerUnit = ''
  if (s.role === 'admin') {
    ownerUnit = (input.权属单位 ?? '').trim()
    if (!getOwnerUnit(ownerUnit)) {
      return fail('值班管理员登记时必须指定有效的权属单位')
    }
  } else if (s.role === 'leader' || s.role === 'member') {
    ownerUnit = s.unit
  } else {
    return fail('当前身份无权登记监测对象')
  }
  if (!getOwnerUnit(ownerUnit)) {
    return fail(`“${ownerUnit}”不是已登记的权属单位，越权改动拒收`)
  }
  if (parseMm(input.允许沉降) === null) {
    return fail('允许沉降必须是数值（单位 mm），例如 30mm')
  }
  const measured = (input.实测沉降 ?? '').trim()
  if (measured && parseMm(measured) === null) {
    return fail('实测沉降必须是数值（单位 mm）')
  }
  const maxId = rows().reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const today = nowText().slice(0, 10)
  const draft: EntryRow = {
    id: maxId + 1,
    status: '待布点',
    pending: true,
    abnormal: false,
    对象编号: no,
    建筑物名称: input.建筑物名称.trim() || '未命名监测对象',
    结构类型: input.结构类型.trim(),
    距隧道距离: input.距隧道距离.trim(),
    允许沉降: `${parseMm(input.允许沉降)}mm`,
    实测沉降: measured ? `${parseMm(measured)}mm` : '',
    监测频次: input.监测频次?.trim() || '1次/天',
    布点时间: '',
    权属单位: ownerUnit,
    监测负责人: leaderOf(ownerUnit),
    权属轨迹: '',
    频次调整人: '',
    频次调整时间: '',
    监测状态: '待布点',
    登记时间: today,
  }
  const next = [...rows(), draft]
  if (!commit(next)) {
    return fail('写入失败，登记已整条抽回')
  }
  return { ok: true, message: `已登记 ${no}，当前归属：${ownerUnit}` }
}

export type UpdateInput = Partial<Record<(typeof EXCLUSIVE_FIELDS)[number] | (typeof ORDINARY_FIELDS)[number], string>>

// 修改监测对象：专属字段与普通字段分别校验归属，越权或跨单位改动直接拒收。
export function updateBuilding(id: number, patch: UpdateInput): ActionResult {
  const s = session()
  const current = rows().find((row) => Number(row.id) === id)
  if (!current) {
    return fail(`没有找到编号为 ${id} 的监测对象`)
  }
  const keys = Object.keys(patch)
  if (keys.length === 0) {
    return fail('没有需要保存的改动')
  }
  for (const field of keys) {
    if ((EXCLUSIVE_FIELDS as readonly string[]).includes(field)) {
      if (!canEditExclusive(s, current)) {
        return fail(`对象编号、允许沉降仅当前权属单位（${current['权属单位']}）的监测负责人可维护，越权改动已拒收`)
      }
    } else if ((ORDINARY_FIELDS as readonly string[]).includes(field)) {
      if (!canEditOrdinary(s, current)) {
        return fail(`该记录归属 ${current['权属单位']}，跨单位改动已拒收`)
      }
    } else {
      return fail(`字段 ${field} 不在可维护范围内，已拒收`)
    }
  }
  if (patch.对象编号 !== undefined) {
    const newNo = patch.对象编号.trim()
    if (!newNo) {
      return fail('对象编号不能为空')
    }
    if (findByNo(newNo, id)) {
      return fail(`对象编号 ${newNo} 已被占用，修改已拒收`)
    }
  }
  if (patch.允许沉降 !== undefined && parseMm(patch.允许沉降) === null) {
    return fail('允许沉降必须是数值（单位 mm）')
  }
  if (patch.实测沉降 !== undefined) {
    const value = patch.实测沉降.trim()
    if (value && parseMm(value) === null) {
      return fail('实测沉降必须是数值（单位 mm）')
    }
  }
  const updated: EntryRow = { ...current }
  for (const field of keys) {
    let value = patch[field as keyof UpdateInput] ?? ''
    if (field === '允许沉降') {
      value = `${parseMm(value)}mm`
    }
    if (field === '实测沉降') {
      const mm = parseMm(value)
      value = value.trim() && mm !== null ? `${mm}mm` : value.trim()
    }
    if (field === '对象编号') {
      value = value.trim()
    }
    updated[field] = value
  }
  const next = rows().map((row) => (Number(row.id) === id ? updated : row))
  // 实测沉降一变，报警状态同步重算，报警清单跟着同源更新。
  if (!persistWithAlarmSync(next)) {
    return fail('写入失败，修改已整条抽回')
  }
  const level = evaluateAlarm(updated)
  if (level.level === '报警') {
    return {
      ok: true,
      message: `已保存：${updated['对象编号']} 触发报警，实测 ${level.measuredMm}mm，超允许值 ${level.overMm}mm（${ALARM_STANDARD}）`,
    }
  }
  return { ok: true, message: `已保存：${updated['对象编号']} 当前归属 ${updated['权属单位']}` }
}

// 调整监测频次：只有本单位监测负责人能调，重复调整只保留最后一次生效的值。
export function adjustFrequency(id: number, frequency: string): ActionResult {
  const s = session()
  const current = rows().find((row) => Number(row.id) === id)
  if (!current) {
    return fail(`没有找到编号为 ${id} 的监测对象`)
  }
  const value = frequency.trim()
  if (!value) {
    return fail('监测频次不能为空')
  }
  if (!canAdjustFrequency(s, current)) {
    return fail(`只有 ${current['权属单位']} 的监测负责人能调整监测频次，已拒收`)
  }
  const stamp = nowText()
  const updated: EntryRow = {
    ...current,
    监测频次: value,
    频次调整人: s.name,
    频次调整时间: stamp,
  }
  const next = rows().map((row) => (Number(row.id) === id ? updated : row))
  if (!commit(next)) {
    return fail('写入失败，频次调整已整条抽回')
  }
  return { ok: true, message: `${current['对象编号']} 监测频次已调整为「${value}」（${stamp} 生效，仅保留最后一次）` }
}

// 权属移交：老单位随即失去维护权限，新单位拿到维护权，并在记录上注明归属轨迹。
export function transferOwnership(id: number, targetUnit: string): ActionResult {
  const s = session()
  const current = rows().find((row) => Number(row.id) === id)
  if (!current) {
    return fail(`没有找到编号为 ${id} 的监测对象`)
  }
  const target = targetUnit.trim()
  if (!getOwnerUnit(target)) {
    return fail(`“${target}”不是已登记的权属单位，移交拒收`)
  }
  if (target === String(current['权属单位'] ?? '')) {
    return fail(`${target} 已经是当前权属单位，无需重复移交`)
  }
  if (!canTransfer(s, current)) {
    return fail(`只有 ${current['权属单位']} 的监测负责人或值班管理员能发起移交，越权改动已拒收`)
  }
  const stamp = nowText()
  const history = String(current['权属轨迹'] ?? '').replace(/（[^）]*起）$/, '')
  const trail = `${history}（${current['布点时间'] || '历史布点'}起）→ ${stamp.slice(0, 10)}移交${target}`
  const updated: EntryRow = {
    ...current,
    权属单位: target,
    监测负责人: leaderOf(target),
    权属轨迹: trail,
  }
  const next = rows().map((row) => (Number(row.id) === id ? updated : row))
  if (!commit(next)) {
    return fail('写入失败，移交已整条抽回')
  }
  return { ok: true, message: `${current['对象编号']} 已移交 ${target}，此后仅该单位可维护` }
}

// 布设测点：待布点 -> 监测中，回填布点时间，随后按实测值同步报警结论。
export function deployPoint(id: number): ActionResult {
  const s = session()
  const current = rows().find((row) => Number(row.id) === id)
  if (!current) {
    return fail(`没有找到编号为 ${id} 的监测对象`)
  }
  if (String(current.status) !== '待布点') {
    return fail(`${current['对象编号']} 已布点，不用重复操作`)
  }
  if (!canDeploy(s, current)) {
    return fail(`该记录归属 ${current['权属单位']}，跨单位布设已拒收`)
  }
  const today = nowText().slice(0, 10)
  const updated: EntryRow = {
    ...current,
    status: '监测中',
    pending: true,
    布点时间: String(current['布点时间'] ?? '') || today,
    权属轨迹: String(current['权属轨迹'] ?? '') || `${current['权属单位']}（${today}布点起）`,
    监测状态: '监测中',
  }
  const next = rows().map((row) => (Number(row.id) === id ? updated : row))
  if (!persistWithAlarmSync(next)) {
    return fail('写入失败，布点已整条抽回')
  }
  return { ok: true, message: `${current['对象编号']} 已布设测点，布点时间 ${updated['布点时间']}` }
}

// 解除报警：必须实测值已回到允许值以内，否则保持报警并说明标准。
export function releaseAlarm(id: number): ActionResult {
  const s = session()
  const current = rows().find((row) => Number(row.id) === id)
  if (!current) {
    return fail(`没有找到编号为 ${id} 的监测对象`)
  }
  if (!canDeploy(s, current)) {
    return fail(`该记录归属 ${current['权属单位']}，跨单位解除已拒收`)
  }
  const conclusion = evaluateAlarm(current)
  if (conclusion.level === '报警') {
    return fail(
      `${current['对象编号']} 实测 ${conclusion.measuredMm}mm 仍超允许值 ${conclusion.allowMm}mm（超 ${conclusion.overMm}mm，${ALARM_STANDARD}），不能解除`,
    )
  }
  const updated: EntryRow = {
    ...current,
    status: '已解除',
    pending: false,
    abnormal: false,
    监测状态: '已解除',
  }
  delete updated['报警时间']
  const next = rows().map((row) => (Number(row.id) === id ? updated : row))
  if (!commit(next)) {
    return fail('写入失败，解除已整条抽回')
  }
  return { ok: true, message: `${current['对象编号']} 报警已解除，监测闭环` }
}

export function alarmStandard(): string {
  return ALARM_STANDARD
}

export function ownerOptions(): string[] {
  return OWNER_UNITS.map((unit) => unit.name)
}
