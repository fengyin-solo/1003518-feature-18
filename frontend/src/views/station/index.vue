<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>监测站点管理</h2>
        <p class="page-desc">维护水文监测站，围绕站点编号、站点名称、站点类型、所在河流做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水文监测站</button>
        <button class="btn" type="button" @click="exportRows">导出监测站点清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无监测站点数据，可先登记水文监测站</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测站点记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <h3 class="section-title">巡检故障台账（读取回放后的巡检结果）</h3>
    <p class="page-desc">数据来自巡检终端离线补录回放后的统一视图：发现故障、已处置的巡检记录都会列在这里。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th><th>站点编号</th><th>巡检日期</th><th>巡检人员</th>
          <th>发现问题</th><th>处理措施</th><th>故障状态</th><th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fault in faultRows" :key="String(fault.id)">
          <td>{{ fault['记录编号'] }}</td>
          <td>{{ fault['站点编号'] }}</td>
          <td>{{ fault['巡检日期'] }}</td>
          <td>{{ fault['巡检人员'] }}</td>
          <td>{{ fault['发现问题'] || '—' }}</td>
          <td>{{ fault['处理措施'] || '待处置' }}</td>
          <td>{{ fault.status }}</td>
          <td>{{ fault['数据来源'] || '在线登记' }}</td>
        </tr>
        <tr v-if="!faultRows.length">
          <td colspan="8" class="empty-state">暂无巡检故障记录，请在巡检记录模块完成离线回放</td>
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
import { faultLedger } from '@/data/inspection-sync'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('station')
const columns = ["站点编号", "站点名称", "站点类型", "所在河流", "经纬度坐标", "建站年份", "管理单位", "运行状态"]
const actions = ["升级为加强", "登记故障", "撤销站点"]
const statuses = ["正常运行", "设备故障", "汛期加强", "暂停运行", "已撤销"]
const stats = [{"label": "站点总数", "value": 0}, {"label": "正常运行数", "value": 0}, {"label": "故障站点数", "value": 0}]

const rows = ref<EntryRow[]>([])
const faultRows = ref<EntryRow[]>([])
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
  errorMessage.value = '水文监测站登记入口尚未接入审批流'
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
    // 别的模块的故障台账：读巡检离线补录回放后的统一结果，不另存一份。
    faultRows.value = faultLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测站点列表读取失败'
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
