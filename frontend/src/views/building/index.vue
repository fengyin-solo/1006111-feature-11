<template>
  <section class="page" data-module="building">
    <header class="page-head">
      <div>
        <h2>建筑监测管理</h2>
        <p class="page-desc">
          按权属单位归属的监测对象台账：对象编号与允许沉降仅当前权属单位的监测负责人可维护，越权或跨单位改动直接拒收；报警按
          {{ standard }} 判定，报警结论与地表沉降页同源。
        </p>
      </div>
      <div class="page-actions">
        <button v-if="!store.isSupervisor" class="btn primary" type="button" @click="openCreate">登记监测对象</button>
        <button class="btn" type="button" @click="exportRows">导出建筑监测清单</button>
      </div>
    </header>

    <div v-if="store.isSupervisor" class="readonly-banner">
      监理共享副本为只读：仅可查看，不提供任何修改入口。
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">监测对象总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card stat-alarm">
        <span class="stat-label">监测报警点（同源于本台账）</span>
        <strong class="stat-value">{{ alarmCount }}</strong>
      </article>
      <article class="stat-card stat-warn">
        <span class="stat-label">预警对象</span>
        <strong class="stat-value">{{ warningCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待布点对象</span>
        <strong class="stat-value">{{ pendingDeployCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>对象编号/名称</span>
        <input v-model="keyword" placeholder="按对象编号或名称检索" />
      </label>
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="ownerFilter">
          <option value="">全部单位</option>
          <option v-for="unit in ownerUnits" :key="unit" :value="unit">{{ unit }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>记录归属</th>
            <th>监测结论（判定口径）</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in viewRows" :key="String(row.id)" :class="{ 'row-other': !isOwner(row), 'row-alarm': conclusion(row).level === '报警' }">
            <td v-for="column in columns" :key="column">
              <template v-if="column === '实测沉降'">
                <span :class="conclusion(row).level === '报警' ? 'text-alarm' : conclusion(row).level === '预警' ? 'text-warn' : ''">
                  {{ row[column] || '—' }}
                </span>
              </template>
              <template v-else>{{ row[column] || '—' }}</template>
            </td>
            <td>
              <div class="owner-cell">
                <span class="owner-badge" :class="isOwner(row) ? 'owner-self' : 'owner-other'">
                  {{ isOwner(row) ? '本单位' : '外单位' }}
                </span>
                <strong>{{ row['权属单位'] }}</strong>
                <small>负责人：{{ row['监测负责人'] }}</small>
                <small v-if="row['权属轨迹']" class="owner-trail">{{ row['权属轨迹'] }}</small>
              </div>
            </td>
            <td>
              <span class="level-tag" :class="`level-${levelClass(conclusion(row).level)}`">{{ conclusion(row).level }}</span>
              <small v-if="conclusion(row).level === '报警'" class="conclusion-detail">
                位置：{{ row['建筑物名称'] }}（{{ row['对象编号'] }}）；超限 {{ conclusion(row).overMm }}mm
                （实测 {{ conclusion(row).measuredMm }}mm / 允许 {{ conclusion(row).allowMm }}mm）
              </small>
              <small v-else-if="conclusion(row).level === '预警'" class="conclusion-detail">
                已达允许值 80%，按 {{ standard }} 预警
              </small>
              <small v-else class="conclusion-detail muted">按 {{ standard }}</small>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions stacked">
              <template v-if="!store.isSupervisor">
                <button v-if="String(row.status) === '待布点' && canDeploy(store, row)" class="link" type="button" @click="doDeploy(row)">
                  布设测点
                </button>
                <button
                  v-if="canEdit(row)"
                  class="link"
                  type="button"
                  :disabled="editDisabled(row)"
                  :title="editDisabled(row) ? editDisabledHint(row) : '维护本对象'"
                  @click="openEdit(row)"
                >
                  维护
                </button>
                <button
                  v-if="canAdjustFreq(row)"
                  class="link"
                  type="button"
                  title="仅本单位监测负责人可调整，重复调整保留最后一次"
                  @click="openFrequency(row)"
                >
                  调整频次
                </button>
                <button v-if="canTransfer(row)" class="link" type="button" @click="openTransfer(row)">
                  权属移交
                </button>
                <button v-if="String(row.status) !== '已解除' && canDeploy(store, row)" class="link" type="button" @click="doRelease(row)">
                  解除报警
                </button>
                <small v-if="!isOwner(row) && !store.isAdmin" class="muted">归属外单位，改动将被拒收</small>
              </template>
              <span v-else class="muted">只读</span>
            </td>
          </tr>
          <tr v-if="!viewRows.length">
            <td :colspan="columns.length + 4" class="empty-state">暂无符合条件的建筑监测记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条建筑监测记录（与运营概览、地表沉降页同一份取数，不另存第二份）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记监测对象 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记监测对象</h3>
        <p class="modal-hint">同一对象编号反复提交只入一条；写失败整条抽回。新记录归属：{{ createOwnerHint }}</p>
        <label v-for="field in createFields" :key="field" class="modal-field">
          <span>{{ field }}</span>
          <input v-model="createForm[field]" :placeholder="field === '允许沉降' ? '如 30mm' : `请输入${field}`" />
        </label>
        <label v-if="store.isAdmin" class="modal-field">
          <span>权属单位</span>
          <select v-model="createForm.权属单位">
            <option value="" disabled>请选择权属单位</option>
            <option v-for="unit in ownerUnits" :key="unit" :value="unit">{{ unit }}</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 维护（专属字段+普通字段） -->
    <div v-if="editOpen" class="modal-mask" @click.self="editOpen = false">
      <div class="modal">
        <h3>维护监测对象 {{ editForm.对象编号 }}</h3>
        <p class="modal-hint">
          对象编号、允许沉降仅当前权属单位监测负责人可改；其余字段本单位可维护。越权或跨单位改动提交时直接拒收。
        </p>
        <label v-for="field in editableFields" :key="field" class="modal-field">
          <span>
            {{ field }}
            <em v-if="isExclusive(field)" class="field-tag exclusive">权属专属</em>
            <em v-if="fieldDisabled(field)" class="field-tag locked">无权修改</em>
          </span>
          <input v-model="editForm[field]" :disabled="fieldDisabled(field)" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editOpen = false">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitEdit">保存</button>
        </div>
      </div>
    </div>

    <!-- 调整监测频次 -->
    <div v-if="frequencyOpen" class="modal-mask" @click.self="frequencyOpen = false">
      <div class="modal modal-sm">
        <h3>调整监测频次 · {{ frequencyTargetNo }}</h3>
        <p class="modal-hint">仅本单位监测负责人可调整；重复调整只保留最后一次生效的值。</p>
        <label class="modal-field">
          <span>监测频次</span>
          <input v-model="frequencyValue" placeholder="如 2次/天" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="frequencyOpen = false">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitFrequency">确认调整</button>
        </div>
      </div>
    </div>

    <!-- 权属移交 -->
    <div v-if="transferOpen" class="modal-mask" @click.self="transferOpen = false">
      <div class="modal modal-sm">
        <h3>权属移交 · {{ transferTargetNo }}</h3>
        <p class="modal-hint">移交后仅新单位可维护，老单位改动一律拒收；归属轨迹会记录在该条记录上。</p>
        <label class="modal-field">
          <span>接收权属单位</span>
          <select v-model="transferTarget">
            <option value="" disabled>请选择接收单位</option>
            <option v-for="unit in transferOptions" :key="unit" :value="unit">{{ unit }}</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="transferOpen = false">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitTransfer">确认移交</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  adjustFrequency,
  canAdjustFrequency,
  canDeploy,
  canEditExclusive,
  canEditOrdinary,
  canTransfer as canTransferRow,
  createBuilding,
  deployPoint,
  evaluateAlarm,
  listAlarmPoints,
  releaseAlarm,
  transferOwnership,
  updateBuilding,
  alarmStandard,
  ownerOptions,
  EXCLUSIVE_FIELDS,
  ORDINARY_FIELDS,
} from '@/api/building-service'
import { downloadEntries, listEntries } from '@/api/local-service'
import type { AlarmLevel, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const standard = alarmStandard()
const ownerUnits = ownerOptions()

const columns = [
  '对象编号',
  '建筑物名称',
  '结构类型',
  '距隧道距离',
  '允许沉降',
  '实测沉降',
  '监测频次',
  '布点时间',
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const keyword = ref('')
const ownerFilter = ref('')
const submitting = ref(false)

const alarmPoints = ref(listAlarmPoints())
const alarmCount = computed(() => alarmPoints.value.filter((point) => point.level === '报警').length)
const warningCount = computed(() => alarmPoints.value.filter((point) => point.level === '预警').length)
const pendingDeployCount = computed(() => rows.value.filter((row) => String(row.status) === '待布点').length)

const statuses = ['待布点', '监测中', '已报警', '已解除']
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const viewRows = computed(() => {
  const kw = keyword.value.trim()
  return rows.value.filter((row) => {
    const hitKeyword =
      !kw ||
      String(row['对象编号'] ?? '').includes(kw) ||
      String(row['建筑物名称'] ?? '').includes(kw)
    const hitOwner = !ownerFilter.value || String(row['权属单位'] ?? '') === ownerFilter.value
    return hitKeyword && hitOwner
  })
})

function conclusion(row: EntryRow) {
  return evaluateAlarm(row)
}

function levelClass(level: AlarmLevel): string {
  return level === '报警' ? 'alarm' : level === '预警' ? 'warn' : 'ok'
}

function isOwner(row: EntryRow): boolean {
  if (store.isAdmin) {
    return true
  }
  return (store.role === 'leader' || store.role === 'member') && store.unit === String(row['权属单位'] ?? '')
}

function canEdit(row: EntryRow): boolean {
  return canEditExclusive(store, row) || canEditOrdinary(store, row)
}

function editDisabled(row: EntryRow): boolean {
  // 外单位监测员/负责人：按钮可见但禁用，真正的拦截仍在服务层。
  if (store.isSupervisor) {
    return true
  }
  if (store.isAdmin) {
    return false
  }
  return store.unit !== String(row['权属单位'] ?? '')
}

function editDisabledHint(row: EntryRow): string {
  return `该记录归属 ${row['权属单位']}，跨单位改动会被拒收`
}

function canAdjustFreq(row: EntryRow): boolean {
  return canAdjustFrequency(store, row)
}

function canTransfer(row: EntryRow): boolean {
  return canTransferRow(store, row)
}

function isExclusive(field: string): boolean {
  return (EXCLUSIVE_FIELDS as readonly string[]).includes(field)
}

// 维护弹窗：监理不应进入；管理员可改普通字段但专属字段禁用；成员仅普通字段。
const editableFields = computed(() => {
  return [...EXCLUSIVE_FIELDS, ...ORDINARY_FIELDS]
})

const editOwnerRow = ref<EntryRow | null>(null)

function fieldDisabled(field: string): boolean {
  const row = editOwnerRow.value
  if (!row) {
    return true
  }
  if (isExclusive(field)) {
    return !canEditExclusive(store, row)
  }
  return !canEditOrdinary(store, row)
}

function resetFilters() {
  keyword.value = ''
  ownerFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries('building')
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

// ---- 登记 ----
const createOpen = ref(false)
const createFields = ['对象编号', '建筑物名称', '结构类型', '距隧道距离', '允许沉降', '实测沉降', '监测频次']
const createForm = reactive<Record<string, string>>({
  对象编号: '',
  建筑物名称: '',
  结构类型: '',
  距隧道距离: '',
  允许沉降: '30mm',
  实测沉降: '',
  监测频次: '1次/天',
  权属单位: '',
})
const createOwnerHint = computed(() => (store.isAdmin ? '按下方选择' : store.unit))

function openCreate() {
  if (store.isSupervisor) {
    return
  }
  createOpen.value = true
}

function submitCreate() {
  if (submitting.value) {
    return
  }
  submitting.value = true
  const result = createBuilding({
    对象编号: createForm.对象编号,
    建筑物名称: createForm.建筑物名称,
    结构类型: createForm.结构类型,
    距隧道距离: createForm.距隧道距离,
    允许沉降: createForm.允许沉降,
    实测沉降: createForm.实测沉降,
    监测频次: createForm.监测频次,
    权属单位: createForm.权属单位,
  })
  submitting.value = false
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  createOpen.value = false
  Object.assign(createForm, {
    对象编号: '',
    建筑物名称: '',
    结构类型: '',
    距隧道距离: '',
    允许沉降: '30mm',
    实测沉降: '',
    监测频次: '1次/天',
    权属单位: '',
  })
  reload()
  flash(true, result.message)
}

// ---- 维护 ----
const editOpen = ref(false)
const editId = ref(0)
const editForm = reactive<Record<string, string>>({})

function openEdit(row: EntryRow) {
  if (store.isSupervisor) {
    return
  }
  editId.value = Number(row.id)
  editOwnerRow.value = row
  for (const field of [...EXCLUSIVE_FIELDS, ...ORDINARY_FIELDS]) {
    editForm[field] = String(row[field] ?? '')
  }
  editOpen.value = true
}

function submitEdit() {
  if (submitting.value) {
    return
  }
  const patch: Record<string, string> = {}
  const current = rows.value.find((row) => Number(row.id) === editId.value)
  for (const field of [...EXCLUSIVE_FIELDS, ...ORDINARY_FIELDS]) {
    const value = editForm[field] ?? ''
    if (String(current?.[field] ?? '') !== value) {
      patch[field] = value
    }
  }
  if (!Object.keys(patch).length) {
    editOpen.value = false
    return
  }
  submitting.value = true
  const result = updateBuilding(editId.value, patch)
  submitting.value = false
  editOpen.value = false
  reload()
  flash(result.ok, result.message)
}

// ---- 调整频次 ----
const frequencyOpen = ref(false)
const frequencyId = ref(0)
const frequencyTargetNo = ref('')
const frequencyValue = ref('')

function openFrequency(row: EntryRow) {
  frequencyId.value = Number(row.id)
  frequencyTargetNo.value = String(row['对象编号'] ?? '')
  frequencyValue.value = String(row['监测频次'] ?? '1次/天')
  frequencyOpen.value = true
}

function submitFrequency() {
  if (submitting.value) {
    return
  }
  submitting.value = true
  const result = adjustFrequency(frequencyId.value, frequencyValue.value)
  submitting.value = false
  frequencyOpen.value = false
  reload()
  flash(result.ok, result.message)
}

// ---- 权属移交 ----
const transferOpen = ref(false)
const transferId = ref(0)
const transferTargetNo = ref('')
const transferTarget = ref('')
const transferOptions = ref<string[]>(ownerUnits)

function openTransfer(row: EntryRow) {
  transferId.value = Number(row.id)
  transferTargetNo.value = String(row['对象编号'] ?? '')
  transferTarget.value = ''
  transferOptions.value = ownerUnits.filter((unit) => unit !== String(row['权属单位'] ?? ''))
  transferOpen.value = true
}

function submitTransfer() {
  if (submitting.value) {
    return
  }
  if (!transferTarget.value) {
    flash(false, '请选择接收权属单位')
    return
  }
  submitting.value = true
  const result = transferOwnership(transferId.value, transferTarget.value)
  submitting.value = false
  transferOpen.value = false
  reload()
  flash(result.ok, result.message)
}

// ---- 状态动作 ----
function doDeploy(row: EntryRow) {
  const result = deployPoint(Number(row.id))
  reload()
  flash(result.ok, result.message)
}

function doRelease(row: EntryRow) {
  const result = releaseAlarm(Number(row.id))
  reload()
  flash(result.ok, result.message)
}

function reload() {
  message.value = ''
  try {
    const payload = listEntries('building', {})
    rows.value = payload.items
    total.value = payload.total
    // 报警清单：本台账投影，与地表沉降页读到的是同一份取数。
    alarmPoints.value = listAlarmPoints()
  } catch (error) {
    flash(false, error instanceof Error ? error.message : '建筑监测列表读取失败')
  }
}

onMounted(reload)
</script>
