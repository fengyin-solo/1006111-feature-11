<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">盾构隧道掘进施工管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。</span>
        <div class="identity-bar">
          <label class="identity-item">
            身份
            <select :value="store.role" @change="onRoleChange(($event.target as HTMLSelectElement).value)">
              <option v-for="role in roleOptions" :key="role.value" :value="role.value">{{ role.label }}</option>
            </select>
          </label>
          <label v-if="store.role === 'leader' || store.role === 'member'" class="identity-item">
            权属单位
            <select :value="store.unit" @change="onUnitChange(($event.target as HTMLSelectElement).value)">
              <option v-for="unit in ownerUnits" :key="unit" :value="unit">{{ unit }}</option>
            </select>
          </label>
          <span class="identity-readout">
            当前：{{ store.name }}
            <em v-if="store.role === 'leader' || store.role === 'member'">（{{ store.unit }}）</em>
            <em v-else>（{{ store.unit }}）</em>
          </span>
          <span class="head-shift">{{ store.shiftLabel }}</span>
        </div>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore, type RoleCode, ROLE_LABELS } from '@/stores/session'
import { OWNER_UNITS } from '@/data/ownership'

const store = useSessionStore()

const roleOptions: { value: RoleCode; label: string }[] = [
  { value: 'leader', label: ROLE_LABELS.leader },
  { value: 'member', label: ROLE_LABELS.member },
  { value: 'supervisor', label: ROLE_LABELS.supervisor },
  { value: 'admin', label: ROLE_LABELS.admin },
]
const ownerUnits = OWNER_UNITS.map((unit) => unit.name)

function onRoleChange(value: string) {
  store.switchIdentity(value as RoleCode, store.unit)
}

function onUnitChange(value: string) {
  store.switchIdentity(store.role, value)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "盾构机台账", path: "/shield" }, { label: "掘进环次", path: "/ring" }, { label: "管片拼装", path: "/segment" }, { label: "同步注浆", path: "/grouting" }, { label: "渣土外运", path: "/muck" }, { label: "地表沉降", path: "/settlement" }, { label: "轴线偏差", path: "/axis" }, { label: "刀具磨损", path: "/cutter" }, { label: "管片生产", path: "/segmentprod" }, { label: "浆液拌制", path: "/mortar" }, { label: "洞内通风", path: "/ventilation" }, { label: "建筑监测", path: "/building" }, { label: "管线探查", path: "/utility" }, { label: "进度节点", path: "/progress" }, { label: "试验检测", path: "/testing" }, { label: "应急演练", path: "/drill" }, { label: "班组进场", path: "/crew" }, { label: "安全巡检", path: "/safety" }]
</script>
