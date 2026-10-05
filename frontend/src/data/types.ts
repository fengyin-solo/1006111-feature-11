/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 报警等级：正常 / 预警（达到允许沉降的80%）/ 报警（超过允许沉降）。
export type AlarmLevel = '正常' | '预警' | '报警'

// 报警清单里的一条结论：全部由建筑监测台账派生，地表沉降页只读投影同一份取数。
export type AlarmPoint = {
  objectNo: string
  name: string
  location: string
  ownerUnit: string
  level: AlarmLevel
  measuredMm: number
  allowMm: number
  overMm: number
  standard: string
  deployDate: string
  status: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
