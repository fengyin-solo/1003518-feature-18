<template>
  <section class="page" data-module="stationhouse">
    <header class="page-head">
      <div>
        <h2>站房维护管理</h2>
        <p class="page-desc">维护站房维护记录，围绕记录编号、站点编号、维护类型、维护内容做登记、筛选与状态流转。</p>
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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无站房维护数据，可先登记站房维护记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条站房维护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <h3 class="section-title">巡检产生的站房维护待办（读回放后的巡检结果）</h3>
    <p class="page-desc">与巡检台账、故障清单读取同一批数据：巡检发现故障即生成待办，现场处置完成后自动办结。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>来源记录</th><th>站点编号</th><th>巡检日期</th><th>巡检人员</th>
          <th>维护内容</th><th>处理措施</th><th>待办状态</th><th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in todoRows" :key="`${String(todo.id)}-todo`">
          <td>{{ todo['记录编号'] }}</td>
          <td>{{ todo['站点编号'] }}</td>
          <td>{{ todo['巡检日期'] }}</td>
          <td>{{ todo['巡检人员'] }}</td>
          <td>{{ todo['发现问题'] }}</td>
          <td>{{ todo['处理措施'] || '待安排维护' }}</td>
          <td>{{ todo.status === '发现故障' ? '待维护' : '已办结' }}</td>
          <td>{{ todo['数据来源'] || '在线登记' }}</td>
        </tr>
        <tr v-if="!todoRows.length">
          <td colspan="8" class="empty-state">暂无巡检维护待办，请在巡检记录模块完成离线回放</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { inspectionView } from '@/data/inspection-sync'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stationhouse')
const columns = ["记录编号", "站点编号", "维护类型", "维护内容", "维护单位", "维护日期", "费用支出", "维护状态"]
const actions = ["安排维护", "确认完工", "通过验收"]
const statuses = ["待安排", "已安排", "施工中", "已完成", "已验收"]
const stats = [{"label": "待维护项数", "value": 0}, {"label": "施工中项数", "value": 0}, {"label": "本月已验收", "value": 0}]

const rows = ref<EntryRow[]>([])
const todoRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 站房维护待办直接读巡检回放后的统一视图，与巡检台账、故障清单同源。
    todoRows.value = inspectionView().maintenanceTodos
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站房维护列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  font-size: 14px;
  margin: 18px 0 8px;
}
</style>
