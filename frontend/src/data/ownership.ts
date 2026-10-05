/** 权属单位、角色与报警判定标准：建筑监测台账的归属和权限都以这里为准。 */

export type OwnerUnit = {
  name: string
  leader: string
  member: string
}

// 平台内有资格作为监测对象权属单位的三家单位，leader 即该单位的监测负责人。
export const OWNER_UNITS: OwnerUnit[] = [
  { name: '中隧第一工程处', leader: '张建国', member: '孙监测' },
  { name: '中隧第二工程处', leader: '李守诚', member: '周一凡' },
  { name: '市政建设中心', leader: '王临管', member: '吴荻' },
]

// 监理拿到的是只读共享副本，不属于任何记录的权属单位。
export const SUPERVISOR_UNIT = '华铁建设监理站'
export const SUPERVISOR_NAME = '赵监理'
export const ADMIN_NAME = '值班管理员'
export const PLATFORM_UNIT = '平台管理岗'

// 报警/预警判定依据：按每个监测对象各自的允许沉降控制值判定。
export const ALARM_STANDARD = '《城市轨道交通工程监测技术规范》GB 50911-2013（按对象允许沉降控制值判定）'

// 老数据缺少允许沉降时的兜底控制值（mm），兼容存量记录。
export const DEFAULT_ALLOW_MM = 30
export const WARNING_RATIO = 0.8

export function getOwnerUnit(name: string): OwnerUnit | undefined {
  return OWNER_UNITS.find((unit) => unit.name === name)
}

export function leaderOf(unitName: string): string {
  return getOwnerUnit(unitName)?.leader ?? ''
}
