<script setup>
import { computed, ref } from 'vue'
import { normalizeDate, getBeijingToday } from '../modules/parser'
import { withAlpha, darken } from '../modules/color'

const props = defineProps(['schedules'])
const emit = defineEmits(['day-click'])

const pad = (n) => String(n).padStart(2, '0')
const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 全站统一按北京时间判定“今天”，避免半夜跨日
const todayStr = getBeijingToday()

// 当前展示的年月（0-11 表示月份），也取北京时间的年月
const currentYear = ref(Number(todayStr.slice(0, 4)))
const currentMonth = ref(Number(todayStr.slice(5, 7)) - 1)

const weekDays = ['一', '二', '三', '四', '五', '六', '日']
const MAX_BARS = 2 // 顶部多日横条最多显示几条
const MAX_SINGLES = 3 // 单日文字列表最多显示几条

const monthLabel = computed(() => `${currentYear.value}年${currentMonth.value + 1}月`)

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value -= 1
  } else {
    currentMonth.value -= 1
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value += 1
  } else {
    currentMonth.value += 1
  }
}

function goToday() {
  const today = getBeijingToday()
  currentYear.value = Number(today.slice(0, 4))
  currentMonth.value = Number(today.slice(5, 7)) - 1
}

// 固定 42 格：上月补尾 + 本月 + 下月补头
const days = computed(() => {
  const singleMap = new Map()
  const durationList = []

  for (const s of props.schedules) {
    if (s.isDuration && s.startDate && s.endDate) {
      durationList.push(s)
      continue
    }
    const key = normalizeDate(s.time)
    if (!key) continue
    if (!singleMap.has(key)) singleMap.set(key, [])
    singleMap.get(key).push(s)
  }

  const firstDay = new Date(currentYear.value, currentMonth.value, 1)
  const offset = (firstDay.getDay() + 6) % 7 // 周一为一周起点
  const startDate = new Date(currentYear.value, currentMonth.value, 1 - offset)

  const list = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i)
    const dateStr = formatDate(date)
    const singles = singleMap.get(dateStr) || []
    const durations = durationList.filter(s => dateStr >= s.startDate && dateStr <= s.endDate)

    const shownDuration = durations.slice(0, MAX_BARS)
    const shownSingle = singles.slice(0, MAX_SINGLES)
    const rest = (durations.length - shownDuration.length) + (singles.length - shownSingle.length)

    list.push({
      dateStr,
      day: date.getDate(),
      inMonth: date.getMonth() === currentMonth.value,
      isToday: dateStr === todayStr,
      singles,
      durations,
      shownDuration,
      shownSingle,
      rest,
      all: [...durations, ...singles]
    })
  }
  return list
})

// 本月涉及多少条日程（持续日程只算一次）
const monthCount = computed(() => {
  const ids = new Set()
  days.value.filter(d => d.inMonth).forEach(d => d.all.forEach(s => ids.add(s.id)))
  return ids.size
})

function cellTitle(day) {
  return day.all.map(s => `${s.title || '未命名日程'}${s.time ? ' · ' + s.time : ''}`).join('\n')
}

function handleDayClick(day) {
  if (day.all.length) {
    emit('day-click', { day: day.day, dateStr: day.dateStr, schedules: day.all })
  }
}

// 右下角拖拽调整大小（带边界限制）
const containerRef = ref(null)
let isResizing = false
let startX = 0, startY = 0, startWidth = 0, startHeight = 0

function startResize(e) {
  isResizing = true
  startX = e.clientX
  startY = e.clientY
  startWidth = containerRef.value.offsetWidth
  startHeight = containerRef.value.offsetHeight
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', stopResize)
  e.preventDefault()
  e.stopPropagation()
}

function onMouseMove(e) {
  if (!isResizing) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  const maxWidth = window.innerWidth * 0.95
  const maxHeight = window.innerHeight * 0.9
  const newWidth = Math.max(320, Math.min(maxWidth, startWidth + dx))
  const newHeight = Math.max(300, Math.min(maxHeight, startHeight + dy))
  containerRef.value.style.width = newWidth + 'px'
  containerRef.value.style.height = newHeight + 'px'
}

function stopResize() {
  isResizing = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', stopResize)
}
</script>

<template>
  <div ref="containerRef" class="calendar-container">
    <header class="header">
      <button class="today-btn" @click="goToday">今天</button>

      <div class="nav">
        <button class="nav-btn" aria-label="上一月" @click="prevMonth">‹</button>
        <span class="title">{{ monthLabel }}</span>
        <button class="nav-btn" aria-label="下一月" @click="nextMonth">›</button>
      </div>

      <span class="count">{{ monthCount }} 项日程</span>
    </header>

    <div class="calendar-scroll-wrapper">
      <div class="calendar-grid">
        <div class="weekday-cell" v-for="w in weekDays" :key="w">{{ w }}</div>

        <div
          v-for="day in days"
          :key="day.dateStr"
          class="day-cell"
          :class="{
            other: !day.inMonth,
            'is-today': day.isToday,
            'has-event': day.all.length > 0
          }"
          :title="cellTitle(day)"
          @click="handleDayClick(day)"
        >
          <!-- 多日日程：顶部细横条 + 标题 -->
          <div class="bars" v-if="day.shownDuration.length">
            <div
              v-for="s in day.shownDuration"
              :key="'bar-' + s.id"
              class="bar"
              :class="{ mid: s.startDate !== day.dateStr && s.endDate !== day.dateStr }"
              :style="{ backgroundColor: withAlpha(s.color, 0.16), color: darken(s.color) }"
            >
              <span class="bar-title">{{ s.title || '未命名日程' }}</span>
            </div>
          </div>

          <div class="day-number" :class="{ today: day.isToday }">{{ day.day }}</div>

          <!-- 单日日程：圆点 + 标题 -->
          <div class="singles" v-if="day.shownSingle.length">
            <div
              v-for="s in day.shownSingle"
              :key="'ev-' + s.id"
              class="event"
              @click.stop="handleDayClick(day)"
            >
              <span
                class="dot"
                :class="{ important: s.isImportant }"
                :style="{ backgroundColor: s.color || '#1677ff' }"
              ></span>
              <span class="event-title">{{ s.title || '未命名日程' }}</span>
            </div>
          </div>

          <div v-if="day.rest > 0" class="more">+{{ day.rest }} 更多</div>
        </div>
      </div>

      <div v-if="!schedules.length" class="empty-state">
        <p>本月还没有日程</p>
        <p class="sub-hint">去左侧粘贴一条通知试试</p>
      </div>
    </div>

    <div class="resize-handle" @mousedown="startResize"></div>
  </div>
</template>

<style scoped>
.calendar-container {
  width: 100%; max-width: 100%; height: 600px; min-width: 0; min-height: 300px;
  box-sizing: border-box; position: relative;
  display: flex; flex-direction: column;
  background: #fff; padding: 16px 18px; border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  overflow: hidden;
}

/* ---------- Header ---------- */
.header {
  display: grid; grid-template-columns: 1fr auto 1fr;
  align-items: center; margin-bottom: 14px; flex-shrink: 0;
}

.today-btn {
  justify-self: start;
  padding: 6px 14px; font-size: 13px; font-weight: 500;
  color: #57606a; background: #fff; border: 1px solid #eceef1; border-radius: 8px;
  cursor: pointer; transition: all 0.2s ease;
}
.today-btn:hover { background: #f4f4f5; color: #1f2328; }

.nav { display: flex; align-items: center; gap: 4px; }

.nav-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: 8px;
  color: #8b949e; font-size: 17px; line-height: 1; cursor: pointer;
  transition: all 0.2s ease;
}
.nav-btn:hover { background: #f4f4f5; color: #1f2328; }

.title {
  min-width: 118px; text-align: center;
  font-size: 16px; font-weight: 600; color: #1f2328; letter-spacing: 0.2px;
}

.count { justify-self: end; font-size: 12px; color: #a1a8b3; }

/* ---------- Grid ---------- */
.calendar-scroll-wrapper { flex: 1; width: 100%; min-width: 0; overflow: auto; position: relative; }

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-auto-rows: minmax(84px, 1fr);
  gap: 1px;
  background: #f4f4f5;
  border-radius: 10px;
  overflow: hidden;
  min-height: 100%;
  width: 100%; min-width: 0; max-width: 100%;
}

.weekday-cell {
  background: #fff; text-align: center; padding: 5px 0 8px;
  font-size: 11px; font-weight: 500; color: #a1a8b3;
}

.day-cell {
  position: relative; background: #fff; overflow: hidden;
  display: flex; flex-direction: column; align-items: center;
  padding: 5px 4px 4px;
  cursor: pointer; transition: background 0.2s ease;
  container-type: inline-size;
  min-width: 0; max-width: 100%;
}
.day-cell:hover { background: #fafafa; }
.day-cell.other .day-number { color: #ccc; }
.day-cell.is-today { background: #f5f9ff; }
.day-cell.is-today:hover { background: #eef5ff; }

/* 多日日程：顶部细横条（内嵌标题） */
.bars {
  width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  margin-bottom: 2px;
}
.bar {
  height: 10px; margin: 0 2px; border-radius: 3px; overflow: hidden;
  display: flex; align-items: center; transition: filter 0.2s ease;
}
.bar.mid { margin: 0 -4px; border-radius: 0; }
.bar:hover { filter: brightness(1.1); }
.bar-title {
  display: block; width: 100%; padding: 0 4px;
  font-size: 8.5px; line-height: 10px; font-weight: 600; color: inherit;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 格子太窄、放不下文字时，只保留色条 */
@container (max-width: 64px) {
  .bar-title { display: none; }
}

/* 日期数字 */
.day-number {
  width: 18px; height: 18px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #333; border-radius: 50%;
  transition: all 0.2s ease;
}
.day-cell:hover .day-number:not(.today) { background: #f0f1f3; }
.day-number.today {
  background: #1677ff; color: #fff; font-weight: 600;
  box-shadow: 0 2px 6px rgba(22, 119, 255, 0.35);
}

/* 单日日程：圆点 + 文字列表 */
.singles {
  width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 0;
  margin-top: 2px; overflow: hidden;
}
.event {
  display: flex; align-items: center; gap: 3px;
  padding: 1px 3px; border-radius: 4px; width: 100%; min-width: 0;
  transition: background 0.15s ease;
}
.event:hover { background: #f3f4f6; }
.dot {
  width: 6px; height: 6px; border-radius: 50%; display: block; flex-shrink: 0;
}
.dot.important { box-shadow: 0 0 0 2px rgba(245, 34, 45, 0.18); }
.event-title {
  font-size: 9.5px; line-height: 1.3; color: #3f4650;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.more { font-size: 9px; color: #a1a8b3; line-height: 1.5; margin-top: 1px; }

/* 空状态 */
.empty-state {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #b3bac4; pointer-events: none;
}
.empty-state p { font-size: 15px; margin: 0 0 6px; }
.empty-state .sub-hint { font-size: 13px; color: #c9cfd8; margin: 0; }

/* 拖拽手柄 */
.resize-handle {
  position: absolute; bottom: 0; right: 0; width: 16px; height: 16px;
  cursor: nwse-resize; z-index: 10;
  background: linear-gradient(135deg, transparent 50%, #e6e9ed 50%);
  border-radius: 0 0 12px 0; transition: background 0.2s ease;
}
.resize-handle:hover { background: linear-gradient(135deg, transparent 50%, #c2c9d1 50%); }

/* ================= 移动端适配 ================= */
@media (max-width: 768px) {
  .calendar-container {
    height: calc(100dvh - 104px); min-height: 360px;
    padding: 10px 8px; border-radius: 10px;
  }
  .resize-handle { display: none; } /* 触屏拖拽体验差，直接关掉 */

  .header { margin-bottom: 8px; min-width: 0; }
  .title { min-width: 0; font-size: 14px; }
  .today-btn { padding: 5px 10px; font-size: 12px; }
  .nav-btn { width: 26px; height: 26px; font-size: 15px; }
  .count { display: none; } /* 标题栏太窄，隐藏统计 */

  /* 一屏看全七天：7 列等分，不再横向滚动 */
  .calendar-grid {
    min-width: 0;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-auto-rows: minmax(58px, 1fr);
  }
  .weekday-cell { padding: 4px 0 6px; font-size: 10px; }
  .day-cell { padding: 4px 2px 3px; }
  .day-number { width: 16px; height: 16px; font-size: 10px; }

  .bars { gap: 1px; margin-bottom: 1px; }
  .bar { height: 8px; margin: 0 1px; border-radius: 2px; }
  .bar.mid { margin: 0 -2px; }
  .bar-title { font-size: 7px; line-height: 8px; padding: 0 2px; }

  .singles { margin-top: 1px; }
  .event { padding: 0 2px; gap: 2px; }
  .dot { width: 5px; height: 5px; }
  .event-title { font-size: 8.5px; }
  .more { font-size: 8px; }

  .empty-state p { font-size: 13px; }
  .empty-state .sub-hint { font-size: 11px; }
}

/* 小屏手机（≤400px）：一屏七天时单格只有 ~45px，文字必须再收一档 */
@media (max-width: 400px) {
  .calendar-container { padding: 8px 6px; }
  .calendar-grid { grid-auto-rows: minmax(52px, 1fr); }

  .weekday-cell { padding: 3px 0 5px; font-size: 9px; }
  .day-cell { padding: 3px 1px 2px; }
  .day-number { width: 15px; height: 15px; font-size: 9px; }

  /* 多日横条只留色条，放不下标题 */
  .bars { gap: 1px; margin-bottom: 1px; }
  .bar { height: 6px; margin: 0; border-radius: 2px; }
  .bar.mid { margin: 0 -1px; }
  .bar-title { display: none; }

  /* 单日日程只留小圆点，横向排布不占高度 */
  .singles {
    flex-direction: row; flex-wrap: wrap; justify-content: center;
    gap: 2px; margin-top: 2px;
  }
  .event { width: auto; padding: 0; gap: 0; justify-content: center; }
  .event:hover { background: none; }
  .event-title { display: none; }
  .dot { width: 5px; height: 5px; }
  .more { font-size: 7px; margin-top: 1px; }
}
</style>
