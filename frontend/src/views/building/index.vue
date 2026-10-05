<template>
  <section class="page" data-module="building">
    <header class="page-head">
      <div>
        <h2>建筑监测管理</h2>
        <p class="page-desc">
          按权属单位划开：对象编号与允许沉降只由当前权属单位维护，越权或跨单位改动直接拒收；
          存量记录按布点时间回填归属（交接基准日 {{ handoverDate }}），越限自动报警并同源进入地表沉降清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记监测对象</button>
        <button class="btn" type="button" @click="exportRows">导出建筑监测清单</button>
      </div>
    </header>

    <div v-if="store.isSupervisor" class="readonly-note">
      当前为监理只读身份：本清单是共享给监理的只读副本，不提供任何修改入口。
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">监测中对象</span>
        <strong class="stat-value">{{ view.monitoringCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">报警对象（与地表沉降同源）</span>
        <strong class="stat-value" style="color:#d92d20">{{ view.alarmCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待布点对象</span>
        <strong class="stat-value">{{ view.pendingDeployCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前单位：{{ store.org }}（{{ roleLabel }}）</span>
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
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in view.items" :key="String(row.id)" :class="{ 'row-alarm': String(row.status) === '已报警' }">
            <td v-for="column in columns" :key="column">
              <template v-if="column === '允许沉降'">
                {{ mmText(row[column]) }}
                <span v-if="mmText(row[column]) === '待复核'" class="alarm-badge" style="background:#b54708">待复核</span>
                <button v-if="canMaintain(row)" class="link" type="button" @click="openEdit('allowable', row)">改</button>
              </template>
              <template v-else-if="column === '实测沉降'">
                {{ mmText(row[column]) }}
                <button v-if="canMaintain(row)" class="link" type="button" @click="openEdit('measured', row)">提交实测</button>
              </template>
              <template v-else-if="column === '对象编号'">
                {{ row[column] }}
                <button v-if="canMaintain(row)" class="link" type="button" @click="openEdit('code', row)">改编号</button>
              </template>
              <template v-else-if="column === '监测频次'">
                {{ row[column] }}
                <button v-if="canLead(row)" class="link" type="button" @click="openEdit('frequency', row)">调频次</button>
              </template>
              <template v-else-if="column === '权属单位'">
                {{ row[column] }}
                <span v-if="!canMaintain(row) && !store.isSupervisor" class="own-mark">（非本单位）</span>
              </template>
              <template v-else>{{ row[column] ?? '—' }}</template>
            </td>
            <td>
              {{ row.status }}
              <span v-if="String(row.status) === '已报警'" class="alarm-badge">报警</span>
            </td>
            <td class="row-actions">
              <template v-if="store.isSupervisor">
                <span class="own-mark">只读</span>
              </template>
              <template v-else-if="!canMaintain(row)">
                <span class="own-mark">归属{{ row['权属单位'] }}，拒收改动</span>
              </template>
              <template v-else>
                <button v-if="String(row.status) === '待布点'" class="link" type="button" @click="applyDeploy(row)">布设测点</button>
                <button v-if="String(row.status) === '已报警'" class="link" type="button" @click="applyRelease(row)">解除报警</button>
                <span v-if="!['待布点','已报警'].includes(String(row.status))" class="own-mark">维护中</span>
              </template>
            </td>
          </tr>
          <tr v-if="!view.items.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无建筑监测数据，可先登记监测对象</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ view.total }} 条监测对象；报警点 {{ view.alarmCount }} 个，与地表沉降页「监测对象越限报警」读的是同一份取数。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 登记监测对象 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <div class="modal">
        <h3>登记监测对象</h3>
        <div class="modal-form">
          <label>对象编号</label><input v-model="draft.code" placeholder="如 BLD-2026-007" />
          <label>建筑物名称</label><input v-model="draft.name" />
          <label>结构类型</label><input v-model="draft.structure" placeholder="如 框架3层" />
          <label>距隧道距离</label><input v-model="draft.distance" placeholder="如 7.2m" />
          <label>布点时间</label><input v-model="draft.deployDate" type="date" />
          <label>测点位置</label><input v-model="draft.pointLocation" placeholder="报警提示会带出这个位置" />
          <label>允许沉降(mm)</label><input v-model="draft.allowable" placeholder="如 20" />
          <label>监测频次</label><input v-model="draft.frequency" placeholder="如 1次/日" />
        </div>
        <p class="page-desc">权属不手填：系统按布点时间相对交接基准日 {{ handoverDate }} 自动划归老单位/新单位。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 行内编辑：实测 / 频次 / 允许沉降 / 编号 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h3>{{ editingTitle }} · {{ editing.row['对象编号'] }}</h3>
        <div class="modal-form">
          <label>{{ editingLabel }}</label>
          <input
            v-model="editingValue"
            :type="editing.kind === 'frequency' || editing.kind === 'code' ? 'text' : 'number'"
            step="0.1"
            @keyup.enter="submitEdit"
          />
          <template v-if="editing.kind === 'measured'">
            <span></span><span class="page-desc">判据：{{ editing.row['判据标准'] }}；实测 &gt; 允许沉降（{{ mmText(editing.row['允许沉降']) }}）即自动报警。</span>
          </template>
          <template v-else-if="editing.kind === 'frequency'">
            <span></span><span class="page-desc">仅本单位监测负责人可改，重复调整只保留最后一次生效的值。</span>
          </template>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editing = null">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">提交</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  adjustFrequency,
  deployBuildingPoint,
  downloadEntries,
  listMonitoring,
  moduleMeta,
  registerBuilding,
  releaseBuildingAlarm,
  submitMeasuredSettlement,
  updateOwnershipFields,
} from '@/api/local-service'
import { HANDOVER_DATE } from '@/data/monitoring'
import { useSessionStore } from '@/stores/session'
import type { BuildingDraft } from '@/api/local-service'
import type { EntryRow, MonitoringViewResult } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('building')
const columns = meta.fields
const filterFields = ['对象编号', '建筑物名称', '权属单位']
const handoverDate = HANDOVER_DATE

const emptyView: MonitoringViewResult = {
  items: [],
  total: 0,
  alarmCount: 0,
  alarms: [],
  monitoringCount: 0,
  pendingDeployCount: 0,
}
const view = reactive<MonitoringViewResult>(emptyView)
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const successMessage = ref('')

const roleLabel = computed(() =>
  store.isSupervisor ? '监理只读' : store.isOwnerLead ? '监测负责人' : '监测员',
)

const statusSummary = computed(() =>
  ['待布点', '监测中', '已报警', '已解除'].map((status) => ({
    status,
    count: view.items.filter((row) => String(row.status) === status).length,
  })),
)

function canMaintain(row: EntryRow): boolean {
  return !store.isSupervisor && store.org === String(row['权属单位'])
}
function canLead(row: EntryRow): boolean {
  return canMaintain(row) && store.isOwnerLead
}

// 数值统一显示为 mm；老数据占位文字等非数值显示「待复核」，与越限判据同一口径。
function mmText(value: unknown): string {
  const text = String(value ?? '').replace(/毫米|mm/gi, '').trim()
  return /^-?\d+(\.\d+)?$/.test(text) ? `${text}mm` : '待复核'
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  const payload = listMonitoring(filters.value)
  Object.assign(view, payload)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ---- 登记 ----
const creating = ref(false)
const draft = reactive<BuildingDraft>({
  code: '',
  name: '',
  structure: '',
  distance: '',
  deployDate: '',
  pointLocation: '',
  allowable: '',
  frequency: '',
})

function openCreate() {
  errorMessage.value = ''
  successMessage.value = ''
  if (store.isSupervisor) {
    errorMessage.value = '监理只有只读共享副本，不能登记监测对象'
    return
  }
  creating.value = true
}

function submitCreate() {
  const result = registerBuilding({ ...draft }, store.identity)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  creating.value = false
  Object.assign(draft, {
    code: '', name: '', structure: '', distance: '',
    deployDate: '', pointLocation: '', allowable: '', frequency: '',
  })
  successMessage.value = result.message
  reload()
}

// ---- 行内编辑 ----
type EditKind = 'measured' | 'frequency' | 'allowable' | 'code'
type EditingState = { kind: EditKind; row: EntryRow }
const editing = ref<EditingState | null>(null)
const editingValue = ref('')

const EDIT_META: Record<EditKind, { title: string; label: string }> = {
  measured: { title: '提交实测沉降', label: '实测沉降(mm)' },
  frequency: { title: '调整监测频次', label: '监测频次' },
  allowable: { title: '修改允许沉降', label: '允许沉降(mm)' },
  code: { title: '修改对象编号', label: '对象编号' },
}

const editingTitle = computed(() => (editing.value ? EDIT_META[editing.value.kind].title : ''))
const editingLabel = computed(() => (editing.value ? EDIT_META[editing.value.kind].label : ''))

function openEdit(kind: EditKind, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const current =
    kind === 'measured'
      ? String(row['实测沉降'] ?? '')
      : kind === 'frequency'
        ? String(row['监测频次'] ?? '')
        : kind === 'allowable'
          ? String(row['允许沉降'] ?? '')
          : String(row['对象编号'] ?? '')
  editing.value = { kind, row }
  editingValue.value = current.replace(/mm/gi, '').trim()
}

function submitEdit() {
  if (!editing.value) {
    return
  }
  const { kind, row } = editing.value
  const id = Number(row.id)
  let result
  if (kind === 'measured') {
    result = submitMeasuredSettlement(id, editingValue.value, store.identity)
  } else if (kind === 'frequency') {
    result = adjustFrequency(id, editingValue.value, store.identity)
  } else if (kind === 'allowable') {
    result = updateOwnershipFields(id, { allowable: editingValue.value }, store.identity)
  } else {
    result = updateOwnershipFields(id, { code: editingValue.value }, store.identity)
  }
  editing.value = null
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    successMessage.value = result.message
  }
  reload()
}

function applyDeploy(row: EntryRow) {
  const result = deployBuildingPoint(Number(row.id), store.identity)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    successMessage.value = result.message
  }
  reload()
}

function applyRelease(row: EntryRow) {
  const result = releaseBuildingAlarm(Number(row.id), store.identity)
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    successMessage.value = result.message
  }
  reload()
}

onMounted(reload)
</script>
