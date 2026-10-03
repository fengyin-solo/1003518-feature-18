<template>
  <section class="page" data-module="stationhouse">
    <header class="page-head">
      <div>
        <h2>站房维护管理</h2>
        <p class="page-desc">维护站房维护记录；巡检发现故障回放后自动生成维修待办，待办与巡检台账、故障清单读取同一批数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记站房维护记录</button>
        <button class="btn" type="button" @click="exportRows">导出站房维护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">待回放暂存预览：{{ pendingPreviewCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>数据来源</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span :class="row['同步状态'] === '待回放' ? 'badge pending' : 'badge'">
              {{ sourceLabel(row) }}
            </span>
          </td>
          <td class="row-actions">
            <template v-if="row['同步状态'] === '待回放'">
              <span class="form-hint">巡检暂存回放后生成</span>
            </template>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无站房维护数据，巡检发现故障回放后会自动生成维修待办</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条站房维护记录（含巡检故障待办）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { stationhouseTodos } from '@/data/inspection-sync'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stationhouse')
const columns = ['记录编号', '站点编号', '维护类型', '维护内容', '维护单位', '维护日期', '费用支出']
const actions = ['安排维护', '确认完工', '通过验收']
const statuses = ['待安排', '已安排', '施工中', '已完成', '已验收']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '站点编号', '维护类型']

const filteredRows = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  return rows.value.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
})
const pendingPreviewCount = computed(
  () => rows.value.filter((row) => String(row['同步状态']) === '待回放').length,
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待维护项数', value: rows.value.filter((row) => String(row.status) === '待安排').length },
  { label: '施工中项数', value: rows.value.filter((row) => String(row.status) === '施工中').length },
  {
    label: '巡检故障待办',
    value: rows.value.filter((row) => String(row['维护类型']) === '巡检故障维修').length,
  },
])

function sourceLabel(row: EntryRow): string {
  const sync = String(row['同步状态'] ?? '')
  if (sync === '待回放') return '离线暂存·待回放'
  if (sync === '巡检回放') return '巡检回放'
  return '手工登记'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '站房维护记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  // 待回放的是投影出来的预览行，尚未入库，不能执行状态动作
  if (String(row['同步状态']) === '待回放') {
    errorMessage.value = '该待办来自尚未回放的巡检暂存，请先在巡检记录页回放'
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = stationhouseTodos()
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站房维护列表读取失败'
  }
}

onMounted(reload)
</script>
