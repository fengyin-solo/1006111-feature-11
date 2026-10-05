<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>监测报警点 {{ alarmCount }} 个，取数自建筑监测台账，与地表沉降页同源同数；其余条数同样各页共用一份数据。</span>
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { countAlarmPoints } from '@/api/building-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const alarmCount = ref(0)

function refresh() {
  const payload = loadOverview()
  alarmCount.value = countAlarmPoints()
  // 监测报警点插进卡片：各页与这里读的是同一份台账取数。
  const withAlarm = payload.cards.flatMap((card) =>
    card.label === '异常量'
      ? [card, { label: '监测报警点（建筑台账同源）', value: alarmCount.value }]
      : [card],
  )
  cards.value = withAlarm
  moduleRows.value = payload.modules
}

onMounted(refresh)
</script>
