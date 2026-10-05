import { MODULE_BY_KEY } from '@/data/modules'
import {
  ALARM_SOURCE,
  alarmCodeOf,
  ALARM_STANDARD,
  BUILDING_KEY,
  evaluateOverLimit,
  HANDOVER_DATE,
  listAlarms,
  OWNER_NEW,
  OWNER_OLD,
  ownerOfDeployDate,
  SETTLEMENT_KEY,
} from '@/data/monitoring'
import {
  allRows,
  commitBuildingTables,
  listRows,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type { Identity } from '@/stores/session'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  MonitoringViewResult,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 动作需要带上当前身份：监理在任何模块都只读，直接拒收（页面虽然不给入口，服务层再拦一道）。
export function runAction(key: string, id: number, action: string, identity?: Identity): ActionResult {
  if (identity?.role === 'supervisor') {
    return { ok: false, message: '当前是监理只读身份，不允许修改任何记录' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------------------------------------------------------------------------
// 建筑监测：按权属单位划开，越权拒收；越限自动报警，报警与地表沉降同一份取数。
// ---------------------------------------------------------------------------

const NEXT_BUILDING_ID_KEY = 'next-building-id'

type WriteContext = {
  buildings: EntryRow[]
  settlement: EntryRow[]
}

function snapshot(): WriteContext {
  return { buildings: [...listRows(BUILDING_KEY)], settlement: [...listRows(SETTLEMENT_KEY)] }
}

// 统一落库：先在内存里把两张表改全，再一次性原子提交；中途任一步抛错都不提交（整条抽回）。
function commit(ctx: WriteContext): void {
  commitBuildingTables(ctx.buildings, ctx.settlement)
}

function buildingIndex(ctx: WriteContext, id: number): number {
  return ctx.buildings.findIndex((row) => Number(row.id) === id)
}

function findBuildingByCode(ctx: WriteContext, code: string): EntryRow | undefined {
  return ctx.buildings.find((row) => String(row['对象编号'] ?? '') === code)
}

function nativeSettlement(ctx: WriteContext): EntryRow[] {
  return ctx.settlement.filter((row) => row['报警来源'] !== ALARM_SOURCE)
}

function alarmLedger(ctx: WriteContext): EntryRow[] {
  return listAlarms(ctx.settlement)
}

function denyOwner(row: EntryRow, identity: Identity): string | null {
  if (identity.role === 'supervisor') {
    return '该清单仅向监理开放只读权限，不提供修改入口'
  }
  if (identity.org !== String(row['权属单位'])) {
    return `对象「${row['对象编号']}」归属${row['权属单位']}，${identity.org}跨单位改动一律拒收`
  }
  return null
}

function nextBuildingId(): number {
  const current = listRows(BUILDING_KEY).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const stored =
    typeof window !== 'undefined' && window.localStorage
      ? Number(window.localStorage.getItem(NEXT_BUILDING_ID_KEY) || 0)
      : 0
  const id = Math.max(current, stored) + 1
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(NEXT_BUILDING_ID_KEY, String(id))
  }
  return id
}

// 把内存里改过的建筑监测表重新对账到地表沉降：报警结论只由越限判定产生，台账有行 ⇔ 对象已报警。
// 与存储层 reconcileTables 同口径：数值判不了的老报警保留为「待复核」，不擅自解除。
function reconcileInMemory(ctx: WriteContext, today: string): void {
  const native = nativeSettlement(ctx)
  const usedIds = new Set(native.map((row) => Number(row.id)))
  const ledger: EntryRow[] = []
  for (const row of ctx.buildings) {
    const verdict = evaluateOverLimit(row)
    const released = String(row.status) === '已解除'
    let alarm = false
    let reviewOnly = false
    if (!released) {
      if (verdict.parseable) {
        alarm = verdict.over
      } else {
        alarm = String(row.status) === '已报警'
        reviewOnly = alarm
      }
    }
    row.status = alarm ? '已报警' : String(row.status) === '已报警' ? '监测中' : String(row.status)
    row.pending = String(row.status) !== '已解除'
    row.abnormal = alarm
    row['监测状态'] = String(row.status)
    if (alarm) {
      const code = String(row['对象编号'])
      const existing = alarmLedger(ctx).find((item) => String(item['对象编号']) === code)
      let id: number
      if (existing) {
        id = Number(existing.id)
      } else {
        let hash = 0
        for (const ch of code) {
          hash = (hash * 31 + ch.charCodeAt(0)) % 90000
        }
        id = 900000 + hash
        while (usedIds.has(id)) {
          id += 1
        }
        usedIds.add(id)
      }
      ledger.push({
        id,
        status: '报警',
        pending: false,
        abnormal: true,
        测点编号: alarmCodeOf(code),
        测点位置: String(row['测点位置']),
        初始高程: '—',
        累计沉降: reviewOnly || verdict.measured === null ? '待复核' : `${verdict.measured}mm`,
        沉降速率: String(row['监测频次'] ?? ''),
        预警阈值: reviewOnly || verdict.limit === null ? '待复核' : `${verdict.limit}mm`,
        监测日期: String(row['最近监测时间'] ?? today),
        测点状态: reviewOnly ? '监测对象越限报警（待复核）' : '监测对象越限报警',
        报警来源: ALARM_SOURCE,
        对象编号: code,
        建筑物名称: String(row['建筑物名称'] ?? ''),
        权属单位: String(row['权属单位'] ?? ''),
        超限幅度: reviewOnly
          ? '待复核（老数据控制值缺失）'
          : `+${Math.round((verdict.margin ?? 0) * 100) / 100}mm`,
        判据标准: ALARM_STANDARD,
      })
    }
  }
  ledger.sort((a, b) => Number(a.id) - Number(b.id))
  ctx.settlement = [...native, ...ledger]
}

function todayLabel(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// 建筑监测列表：条数、报警点数都在这一份取数结果里，报警点数与地表沉降页同源。
export function listMonitoring(
  filters: Record<string, string> = {},
): MonitoringViewResult {
  const buildings = filterRows(listRows(BUILDING_KEY), filters)
  const alarms = listAlarms(listRows(SETTLEMENT_KEY))
  return {
    items: buildings,
    total: buildings.length,
    alarmCount: alarms.length,
    alarms,
    monitoringCount: buildings.filter((row) => String(row.status) === '监测中').length,
    pendingDeployCount: buildings.filter((row) => String(row.status) === '待布点').length,
  }
}

// 地表沉降页同一份取数：除本模块测点外，附同源的「监测对象越限报警」行数。
export function listSettlement(filters: Record<string, string> = {}) {
  const rows = listRows(SETTLEMENT_KEY)
  const alarms = listAlarms(rows)
  const matched = filterRows(rows, filters)
  return {
    items: matched,
    total: matched.length,
    buildingAlarms: alarms,
    buildingAlarmCount: alarms.length,
  }
}

export type BuildingDraft = {
  code: string
  name: string
  structure: string
  distance: string
  deployDate: string
  pointLocation: string
  allowable: string
  frequency: string
}

// 登记监测对象：编号反复提交只入一条（按对象编号幂等）；归属由布点时间按交接基准日自动划定。
export function registerBuilding(draft: BuildingDraft, identity: Identity): ActionResult {
  if (identity.role === 'supervisor') {
    return { ok: false, message: '监理只有只读共享副本，不能登记监测对象' }
  }
  const code = draft.code.trim()
  if (!code) {
    return { ok: false, message: '对象编号不能为空' }
  }
  const deployDate = draft.deployDate.trim()
  if (!deployDate) {
    return { ok: false, message: '布点时间是划定权属单位的依据，不能为空' }
  }
  const ctx = snapshot()
  if (findBuildingByCode(ctx, code)) {
    return { ok: false, message: `对象编号「${code}」已存在，重复提交只保留原记录这一条` }
  }
  const row: EntryRow = {
    id: nextBuildingId(),
    status: '待布点',
    pending: true,
    abnormal: false,
    对象编号: code,
    建筑物名称: draft.name.trim() || '未命名建筑物',
    结构类型: draft.structure.trim() || '—',
    距隧道距离: draft.distance.trim() || '—',
    权属单位: ownerOfDeployDate(deployDate),
    监测负责人: identity.role === 'owner_lead' ? identity.label.replace(/（.*$/, '') : '待指定',
    布点时间: deployDate,
    测点位置: draft.pointLocation.trim() || draft.name.trim() || code,
    允许沉降: draft.allowable.trim() || '30',
    实测沉降: '0',
    监测频次: draft.frequency.trim() || '1次/日',
    判据标准: 'GB 50911-2013',
    监测状态: '待布点',
  }
  ctx.buildings = [...ctx.buildings, row]
  reconcileInMemory(ctx, todayLabel())
  try {
    commit(ctx)
  } catch {
    return { ok: false, message: '登记落库失败，整条记录已抽回，未写入任何数据' }
  }
  return {
    ok: true,
    message: `对象「${code}」已登记，按布点时间${deployDate}划归${row['权属单位']}（交接基准日${HANDOVER_DATE}）`,
  }
}

export type EditOwnershipFields = {
  code?: string
  allowable?: string
}

// 改对象编号 / 允许沉降：只认当前权属单位；越权或跨单位改动直接拒收，并注明记录归属。
export function updateOwnershipFields(
  id: number,
  fields: EditOwnershipFields,
  identity: Identity,
): ActionResult {
  const ctx = snapshot()
  const index = buildingIndex(ctx, id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条监测对象' }
  }
  const row = ctx.buildings[index]
  const denied = denyOwner(row, identity)
  if (denied) {
    return { ok: false, message: denied }
  }
  const code = fields.code?.trim()
  if (code !== undefined) {
    if (!code) {
      return { ok: false, message: '对象编号不能为空' }
    }
    const duplicated = ctx.buildings.some(
      (item) => Number(item.id) !== Number(row.id) && String(item['对象编号']) === code,
    )
    if (duplicated) {
      return { ok: false, message: `对象编号「${code}」已被占用，改动拒收` }
    }
    row['对象编号'] = code
  }
  if (fields.allowable !== undefined) {
    const value = fields.allowable.trim()
    if (!/^\d+(\.\d+)?$/.test(value)) {
      return { ok: false, message: '允许沉降必须是毫米数值，非数值改动拒收' }
    }
    row['允许沉降'] = value
  }
  ctx.buildings[index] = { ...row }
  reconcileInMemory(ctx, todayLabel())
  try {
    commit(ctx)
  } catch {
    return { ok: false, message: '保存失败，整条改动已抽回，原记录未变' }
  }
  return { ok: true, message: `对象「${row['对象编号']}」已更新，归属${row['权属单位']}` }
}

// 提交实测沉降：权属单位可提交，按对象 upsert，反复提交只入一条、以最后一次为准；
// 一旦 实测 > 允许沉降 自动进报警，报警带出测点位置、超限幅度与判定标准。
export function submitMeasuredSettlement(
  id: number,
  measuredText: string,
  identity: Identity,
): ActionResult {
  const value = measuredText.trim()
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return { ok: false, message: '实测沉降必须是毫米数值，非数值提交拒收' }
  }
  const ctx = snapshot()
  const index = buildingIndex(ctx, id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条监测对象' }
  }
  const row = ctx.buildings[index]
  const denied = denyOwner(row, identity)
  if (denied) {
    return { ok: false, message: denied }
  }
  const today = todayLabel()
  row['实测沉降'] = value
  row['最近监测时间'] = today
  if (String(row.status) === '待布点') {
    row.status = '监测中'
  }
  ctx.buildings[index] = { ...row }
  reconcileInMemory(ctx, today)
  const verdict = evaluateOverLimit(ctx.buildings[index])
  try {
    commit(ctx)
  } catch {
    return { ok: false, message: '实测提交落库失败，整条数据已抽回，报警台账也未改动' }
  }
  if (verdict.over) {
    const alarm = listAlarms(ctx.settlement).find(
      (item) => String(item['对象编号']) === String(row['对象编号']),
    )
    return {
      ok: true,
      message:
        `实测${verdict.measured}mm 超过允许沉降${verdict.limit}mm，已自动报警：` +
        `测点位置「${alarm?.['测点位置'] ?? row['测点位置']}」，超限幅度 +${verdict.margin}mm，` +
        `按 ${ALARM_STANDARD} 判定；报警已进入地表沉降清单（报警点 ${alarm?.['测点编号']}）。`,
    }
  }
  return {
    ok: true,
    message: `实测已记录（${verdict.measured}mm ≤ ${verdict.limit}mm），未超限；按 ${ALARM_STANDARD} 判定。`,
  }
}

// 调整监测频次：只有本单位监测负责人能调；直接覆盖，重复调整只保留最后一次生效的值。
export function adjustFrequency(
  id: number,
  frequency: string,
  identity: Identity,
): ActionResult {
  const value = frequency.trim()
  if (!value) {
    return { ok: false, message: '监测频次不能为空' }
  }
  const ctx = snapshot()
  const index = buildingIndex(ctx, id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条监测对象' }
  }
  const row = ctx.buildings[index]
  if (identity.role === 'supervisor') {
    return { ok: false, message: '监理为只读身份，不能调整监测频次' }
  }
  if (identity.org !== String(row['权属单位'])) {
    return { ok: false, message: `对象「${row['对象编号']}」归属${row['权属单位']}，跨单位不能调整频次` }
  }
  if (identity.role !== 'owner_lead') {
    return { ok: false, message: '只有本单位的监测负责人能调整监测频次' }
  }
  const previous = String(row['监测频次'] ?? '')
  row['监测频次'] = value
  ctx.buildings[index] = { ...row }
  reconcileInMemory(ctx, todayLabel())
  try {
    commit(ctx)
  } catch {
    return { ok: false, message: '频次调整落库失败，已整条抽回，仍按原频次「' + previous + '」执行' }
  }
  return { ok: true, message: `监测频次已覆盖：${previous} → ${value}，仅最后一次调整生效` }
}

// 解除报警：权属单位操作，报警台账同源撤回，两边报警点数同时减一。
export function releaseBuildingAlarm(id: number, identity: Identity): ActionResult {
  const ctx = snapshot()
  const index = buildingIndex(ctx, id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条监测对象' }
  }
  const row = ctx.buildings[index]
  const denied = denyOwner(row, identity)
  if (denied) {
    return { ok: false, message: denied }
  }
  if (String(row.status) !== '已报警') {
    return { ok: false, message: '该对象当前不在报警状态，无需解除' }
  }
  row.status = '已解除'
  row['监测状态'] = '已解除'
  ctx.buildings[index] = { ...row }
  reconcileInMemory(ctx, todayLabel())
  try {
    commit(ctx)
  } catch {
    return { ok: false, message: '解除报警落库失败，整条操作已抽回' }
  }
  return { ok: true, message: `对象「${row['对象编号']}」已解除报警，地表沉降清单同源更新` }
}

// 布设测点：待布点对象经权属单位确认进入监测中。
export function deployBuildingPoint(id: number, identity: Identity): ActionResult {
  const ctx = snapshot()
  const index = buildingIndex(ctx, id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条监测对象' }
  }
  const row = ctx.buildings[index]
  const denied = denyOwner(row, identity)
  if (denied) {
    return { ok: false, message: denied }
  }
  if (String(row.status) !== '待布点') {
    return { ok: false, message: '该对象已布点，不用重复操作' }
  }
  row.status = '监测中'
  row['监测状态'] = '监测中'
  ctx.buildings[index] = { ...row }
  reconcileInMemory(ctx, todayLabel())
  try {
    commit(ctx)
  } catch {
    return { ok: false, message: '布点落库失败，整条操作已抽回' }
  }
  return { ok: true, message: `对象「${row['对象编号']}」已布设测点，进入监测中` }
}

export const MONITORING_OWNERS = [OWNER_OLD, OWNER_NEW]

