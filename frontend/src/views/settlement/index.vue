<template>
  <section class="page" data-module="settlement">
    <header class="page-head">
      <div>
        <h2>地表沉降管理</h2>
        <p class="page-desc">维护沉降测点，同时承接监测对象越限报警：报警行与建筑监测页读的是同一份取数，两边报警点数永远一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记沉降测点</button>
        <button class="btn" type="button" @click="exportRows">导出地表沉降清单</button>
      </div>
    </header>

    <div v-if="store.isSupervisor" class="readonly-note">
      当前为监理只读身份：测点台账与监测对象报警均只可查看，不提供修改入口。
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">正常测点</span>
        <strong class="stat-value">{{ normalCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">监测对象越限报警（同源）</span>
        <strong class="stat-value" style="color:#d92d20">{{ payload.buildingAlarmCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">最大累计沉降</span>
        <strong class="stat-value">{{ maxCumulative }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>来源</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in payload.items"
            :key="String(row.id)"
            :class="{ 'row-alarm': row['报警来源'] === 'building' }"
          >
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>
              <span v-if="row['报警来源'] === 'building'" class="source-tag building">建筑监测越限</span>
              <span v-else class="own-mark">地表测点</span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <template v-if="row['报警来源'] === 'building'">
                <span class="own-mark">只读·归属{{ row['权属单位'] }}</span>
              </template>
              <template v-else-if="store.isSupervisor">
                <span class="own-mark">只读</span>
              </template>
              <template v-else>
                <button
                  v-for="action in actions"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runAction(action, row)"
                >
                  {{ action }}
                </button>
              </template>
            </td>
          </tr>
          <tr v-if="!payload.items.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无地表沉降数据，可先登记沉降测点</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>
        共 {{ payload.total }} 条（含监测对象越限报警 {{ payload.buildingAlarmCount }} 条）；
        该报警数与建筑监测页同源，取值口径统一按 GB 50911-2013，越限/解除两侧同步。
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listSettlement,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('settlement')
const columns = ['测点编号', '测点位置', '初始高程', '累计沉降', '沉降速率', '预警阈值', '监测日期', '测点状态']
const actions = ['提交监测', '发布预警', '确认稳定']
const filterFields = columns.slice(0, 3)

const payload = ref<{
  items: EntryRow[]
  total: number
  buildingAlarms: EntryRow[]
  buildingAlarmCount: number
}>({ items: [], total: 0, buildingAlarms: [], buildingAlarmCount: 0 })
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const nativeRows = computed(() => payload.value.items.filter((row) => row['报警来源'] !== 'building'))

const statusSummary = computed(() =>
  ['正常', '预警', '报警', '已稳定'].map((status) => ({
    status,
    // 台账自带的报警行单独在「监测对象越限报警」卡里展示，不混进地表测点的状态计数。
    count: nativeRows.value.filter((row) => String(row.status) === status).length,
  })),
)

const normalCount = computed(
  () => nativeRows.value.filter((row) => String(row.status) === '正常').length,
)

const maxCumulative = computed(() => {
  const values = nativeRows.value
    .map((row) => Number(String(row['累计沉降'] ?? '').replace(/毫米|mm/gi, '').trim()))
    .filter((value) => Number.isFinite(value))
  if (!values.length) {
    return '—'
  }
  return `${Math.max(...values)}mm`
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value =
    store.isSupervisor ? '监理为只读身份，不能登记沉降测点' : '沉降测点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.identity)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  payload.value = listSettlement(filters.value)
}

onMounted(reload)
</script>
