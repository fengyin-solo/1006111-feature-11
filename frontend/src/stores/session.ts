import { defineStore } from 'pinia'

// 身份口径：「单位 + 角色」决定能不能改。
// - 权属单位的监测负责人：可调频次、可维护本单位对象、可提交实测；
// - 权属单位的普通监测员：可维护本单位对象、可提交实测，但不能调频次；
// - 监理单位：只有只读共享副本，页面不给修改入口，服务层也一律拒收。
export type RoleKey = 'owner_lead' | 'owner_staff' | 'supervisor'

export type Identity = {
  key: string
  label: string
  org: string
  role: RoleKey
}

// 责任单位交接后，老单位与新单位各有身份；监理单独一份只读。
export const IDENTITIES: Identity[] = [
  { key: 'new-lead', label: '周敏（新单位·监测负责人）', org: '宏晟盾构监测中心', role: 'owner_lead' },
  { key: 'new-staff', label: '李航（新单位·监测员）', org: '宏晟盾构监测中心', role: 'owner_staff' },
  { key: 'old-lead', label: '陈建国（老单位·监测负责人）', org: '中铁城建设备管理部', role: 'owner_lead' },
  { key: 'old-staff', label: '王磊（老单位·监测员）', org: '中铁城建设备管理部', role: 'owner_staff' },
  { key: 'supervisor', label: '赵工（监理单位·只读）', org: '城市轨道监理公司', role: 'supervisor' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '周敏',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    identityKey: 'new-lead',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    identity(state): Identity {
      return IDENTITIES.find((item) => item.key === state.identityKey) ?? IDENTITIES[0]
    },
    // 当前登录单位
    org(): string {
      return this.identity.org
    },
    role(): RoleKey {
      return this.identity.role
    },
    isSupervisor(): boolean {
      return this.identity.role === 'supervisor'
    },
    isOwnerLead(): boolean {
      return this.identity.role === 'owner_lead'
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(key: string) {
      const target = IDENTITIES.find((item) => item.key === key)
      if (!target) {
        return
      }
      this.identityKey = target.key
      this.operator = target.label.replace(/（.*$/, '')
    },
  },
})
