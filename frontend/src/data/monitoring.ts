import type { EntryRow } from './types'

// 监测领域的固定口径（需求里「由你拍板」的部分，全部在这里定死，页面与服务只引用、不再各判一遍）。
//
// 1) 权属划开：每条监测对象唯一归属一个「当前权属单位」。责任单位交接后按布点时间划断：
//    早于交接基准日归老单位，基准日及以后归新单位；缺布点时间的存量数据按对象编号确定性补。
// 2) 报警同源：越限报警统一落到地表沉降（settlement）模块，作为报警台账行（报警来源=building）。
//    建筑监测页与地表沉降页的报警点数都由 listAlarms() 这一个函数给出，任何一边都不另存一份。
// 3) 取值判据：实测沉降 > 允许沉降（统一毫米）即报警；老数据数值无法解析的，保留人工状态并标「待复核」。
export const BUILDING_KEY = 'building'
export const SETTLEMENT_KEY = 'settlement'
export const ALARM_SOURCE = 'building'

export const OWNER_OLD = '中铁城建设备管理部'
export const OWNER_NEW = '宏晟盾构监测中心'
const LEAD_BY_OWNER: Record<string, string> = {
  [OWNER_OLD]: '陈建国',
  [OWNER_NEW]: '周敏',
}

// 责任单位交接基准日：存量记录按布点时间回填权属的唯一分界线。
export const HANDOVER_DATE = '2026-06-01'
export const ALARM_STANDARD = 'GB 50911-2013《城市轨道交通工程监测技术规范》及产权方控制值'

const BUILDING_STATUSES = ['待布点', '监测中', '已报警', '已解除']

// 从「20」「20mm」「20 毫米」这类值里读出毫米数；占位文字等非数值口径一律返回 null，走兼容分支。
export function readMm(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value ?? '').replace(/毫米|mm/gi, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return null
  }
  return Number(text)
}

function formatMm(value: number): string {
  return `${Math.round(value * 100) / 100}`
}

// 老存量没有布点时间：按对象编号做确定性回填（编号尾号为奇数落在交接前、偶数落在交接后），
// 同一条记录反复迁移结果一致，不会这次归老单位、下次归新单位。
function fallbackDeployDate(row: EntryRow): string {
  const tail = String(row['对象编号'] ?? '').match(/(\d+)\s*$/)
  const seed = tail ? Number(tail[1]) : Number(row.id)
  return Number(seed) % 2 === 1 ? '2026-05-15' : '2026-06-15'
}

export function ownerOfDeployDate(deployDate: string): string {
  return deployDate < HANDOVER_DATE ? OWNER_OLD : OWNER_NEW
}

export type OverLimitResult = {
  parseable: boolean
  measured: number | null
  limit: number | null
  over: boolean
  margin: number | null
}

// 统一的越限判定口径，两处页面/报警/对账都调它，杜绝两边各算各的。
export function evaluateOverLimit(row: EntryRow): OverLimitResult {
  const measured = readMm(row['实测沉降'])
  const limit = readMm(row['允许沉降'])
  if (measured === null || limit === null) {
    return { parseable: false, measured, limit, over: false, margin: null }
  }
  const margin = Math.round((measured - limit) * 100) / 100
  return { parseable: true, measured, limit, over: margin > 0, margin }
}

function normalizeBuildingRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  if (!BUILDING_STATUSES.includes(String(next.status))) {
    next.status = '待布点'
  }
  const deployDate = String(next['布点时间'] ?? '').trim() || fallbackDeployDate(next)
  next['布点时间'] = deployDate
  if (!String(next['权属单位'] ?? '').trim()) {
    next['权属单位'] = ownerOfDeployDate(deployDate)
  }
  const owner = String(next['权属单位'])
  if (!String(next['监测负责人'] ?? '').trim()) {
    next['监测负责人'] = LEAD_BY_OWNER[owner] ?? '监测负责人'
  }
  if (!String(next['测点位置'] ?? '').trim()) {
    next['测点位置'] = String(next['建筑物名称'] ?? next['对象编号'] ?? '未标注位置')
  }
  // 口径区分两种缺失：真空值填安全默认；老存量里的占位文字（如「建筑样例2」）原样保留，
  // 交给越限判定走「待复核」分支——绝不能编一个 30mm 把历史报警静默抹掉。
  const limitText = String(next['允许沉降'] ?? '').trim()
  if (!limitText) {
    next['允许沉降'] = '30'
  }
  const measuredText = String(next['实测沉降'] ?? '').trim()
  if (!measuredText) {
    next['实测沉降'] = '0'
  }
  if (readMm(next['允许沉降']) === null || readMm(next['实测沉降']) === null) {
    next['数据复核'] = '待复核'
  }
  if (!String(next['监测频次'] ?? '').trim()) {
    next['监测频次'] = '1次/日'
  }
  if (!String(next['判据标准'] ?? '').trim()) {
    next['判据标准'] = 'GB 50911-2013'
  }
  if (!String(next['监测状态'] ?? '').trim()) {
    next['监测状态'] = String(next.status)
  }
  return next
}

function alarmPointId(code: string, taken: Set<number>): number {
  let hash = 0
  for (const ch of code) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 90000
  }
  let id = 900000 + hash
  while (taken.has(id)) {
    id += 1
  }
  taken.add(id)
  return id
}

export function alarmCodeOf(objectCode: string): string {
  return `ALM-${objectCode}`
}

// 台账行 = 报警结论在地表沉降清单里的唯一落点。id 由对象编号稳定派生，反复对账不会新增重复行。
function buildAlarmRow(building: EntryRow, id: number, measuredAt: string, reviewOnly: boolean): EntryRow {
  const verdict = evaluateOverLimit(building)
  const limitText = verdict.limit === null ? '待复核' : `${formatMm(verdict.limit)}mm`
  const measuredText = verdict.measured === null ? '待复核' : `${formatMm(verdict.measured)}mm`
  const marginText = reviewOnly
    ? '待复核（老数据控制值缺失）'
    : `+${formatMm(verdict.margin ?? 0)}mm`
  return {
    id,
    status: '报警',
    pending: false,
    abnormal: true,
    测点编号: alarmCodeOf(String(building['对象编号'])),
    测点位置: String(building['测点位置']),
    初始高程: '—',
    累计沉降: measuredText,
    沉降速率: String(building['监测频次'] ?? ''),
    预警阈值: limitText,
    监测日期: measuredAt,
    测点状态: reviewOnly ? '监测对象越限报警（待复核）' : '监测对象越限报警',
    报警来源: ALARM_SOURCE,
    对象编号: String(building['对象编号']),
    建筑物名称: String(building['建筑物名称'] ?? ''),
    权属单位: String(building['权属单位'] ?? ''),
    超限幅度: marginText,
    判据标准: ALARM_STANDARD,
  }
}

// 读存储时执行一次：回填存量 + 以报警台账为准双向对账。台账有行 ⇔ 对象处于已报警。
// 规则冲突时由本函数拍板：数值可判按数值（实测>允许），数值缺失的老报警按「待复核」保留。
export function reconcileTables(
  tables: Record<string, EntryRow[]>,
  today: string,
): { tables: Record<string, EntryRow[]>; changed: boolean } {
  const buildings = (tables[BUILDING_KEY] ?? []).map(normalizeBuildingRow)
  const native = (tables[SETTLEMENT_KEY] ?? []).filter((row) => row['报警来源'] !== ALARM_SOURCE)

  const ledger = new Map<string, EntryRow>()
  const takenIds = new Set(native.map((row) => Number(row.id)))
  let buildingChanged = false

  for (const raw of tables[BUILDING_KEY] ?? []) {
    const before = JSON.stringify(raw)
    const after = buildings.find((row) => row.id === raw.id)
    if (after && before !== JSON.stringify(after)) {
      buildingChanged = true
    }
  }

  for (const row of buildings) {
    const isReleased = String(row.status) === '已解除'
    const verdict = evaluateOverLimit(row)
    let alarm = false
    let reviewOnly = false
    if (!isReleased) {
      if (verdict.parseable) {
        alarm = verdict.over
      } else {
        alarm = String(row.status) === '已报警'
        reviewOnly = alarm
      }
    }
    const targetStatus = alarm ? '已报警' : String(row.status) === '已报警' ? '监测中' : String(row.status)
    if (String(row.status) !== targetStatus) {
      row.status = targetStatus
      buildingChanged = true
    }
    row.pending = String(row.status) !== '已解除'
    row.abnormal = alarm
    row['监测状态'] = String(row.status)
    if (alarm) {
      const code = String(row['对象编号'])
      const existing = (tables[SETTLEMENT_KEY] ?? []).find(
        (item) => item['报警来源'] === ALARM_SOURCE && String(item['对象编号']) === code,
      )
      const id = existing ? Number(existing.id) : alarmPointId(code, takenIds)
      const measuredAt = String(existing?.['监测日期'] ?? row['最近监测时间'] ?? today)
      ledger.set(code, buildAlarmRow(row, id, measuredAt, reviewOnly))
    }
  }

  const ledgerRows = [...ledger.values()].sort((a, b) => Number(a.id) - Number(b.id))
  const beforeLedger = (tables[SETTLEMENT_KEY] ?? []).filter((row) => row['报警来源'] === ALARM_SOURCE)
  const ledgerChanged =
    beforeLedger.length !== ledgerRows.length ||
    beforeLedger.some((row, index) => JSON.stringify(row) !== JSON.stringify(ledgerRows[index]))

  const next: Record<string, EntryRow[]> = {
    ...tables,
    [BUILDING_KEY]: buildings,
    [SETTLEMENT_KEY]: [...native, ...ledgerRows],
  }
  return { tables: next, changed: buildingChanged || ledgerChanged }
}

// 报警点数的唯一取数口径：建筑监测页与地表沉降页都读它，两处永远同一个数。
export function listAlarms(settlementRows: EntryRow[]): EntryRow[] {
  return settlementRows.filter((row) => row['报警来源'] === ALARM_SOURCE)
}
