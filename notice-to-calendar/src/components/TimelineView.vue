<script setup>
import { computed } from 'vue'
import { normalizeDate, getBeijingToday } from '../modules/parser'
import { withAlpha } from '../modules/color'

const props = defineProps(['schedules'])
const emit = defineEmits(['day-click'])

const DAY_COUNT = 30 // 时间轴长度：从今天起往后 30 天
const DAY_WIDTH = 44 // 每天占的宽度
const MIN_BAR_WIDTH = 80 // 胶囊最小宽度，保证单日/多日视觉对齐
const ONE_DAY = 86400000

// 'YYYY-MM-DD' -> 天序号（用 UTC 计算，避开本地时区偏移）
function toDayNumber(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return null
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / ONE_DAY)
}

const axisStart = getBeijingToday()
const startDayNum = toDayNumber(axisStart)

const totalWidth = DAY_COUNT * DAY_WIDTH

const days = computed(() => {
  const list = []
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = new Date((startDayNum + i) * ONE_DAY)
    const weekdayIdx = d.getUTCDay()
    list.push({
      key: i,
      left: i * DAY_WIDTH,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      weekday: '周' + ['日', '一', '二', '三', '四', '五', '六'][weekdayIdx],
      isToday: i === 0,
      isWeekend: weekdayIdx === 0 || weekdayIdx === 6
    })
  }
  return list
})

// 每条日程 -> 一行，算出相对时间轴的 left / width
const rows = computed(() => {
  const list = []
  let outside = 0

  for (const s of props.schedules) {
    let startStr = ''
    let endStr = ''

    if (s.isDuration && s.startDate && s.endDate) {
      startStr = s.startDate
      endStr = s.endDate
    } else {
      const day = normalizeDate(s.time)
      if (day) {
        startStr = day
        endStr = day
      }
    }

    const startNum = toDayNumber(startStr)
    const endNum = toDayNumber(endStr)
    if (startNum === null || endNum === null) {
      outside += 1
      continue
    }

    const rawStart = startNum - startDayNum
    const rawEnd = endNum - startDayNum

    // 完全落在 30 天窗口外
    if (rawEnd < 0 || rawStart > DAY_COUNT - 1) {
      outside += 1
      continue
    }

    const from = Math.max(rawStart, 0)
    const to = Math.min(rawEnd, DAY_COUNT - 1)
    const isSingle = rawStart === rawEnd

    // 左边界严格对齐日期列，宽度不足时宁可裁窄（文字走省略号），也不左移错位
    const barLeft = from * DAY_WIDTH + 2
    const barWidth = Math.min(
      Math.max(MIN_BAR_WIDTH, (to - from + 1) * DAY_WIDTH - 4),
      totalWidth - barLeft
    )

    list.push({
      id: s.id,
      title: s.title || '未命名日程',
      time: s.time || '',
      color: s.color || '#1677ff',
      important: !!s.isImportant,
      isSingle,
      dateStr: startStr,
      schedule: s,
      left: barLeft,
      width: barWidth,
      clippedLeft: rawStart < 0,
      clippedRight: rawEnd > DAY_COUNT - 1,
      duration: (rawEnd - rawStart + 1) + ' 天'
    })
  }

  list.sort((a, b) => a.left - b.left)
  return { list, outside }
})

// 网格线更淡，避免视觉上穿透胶囊
const gridImage = `repeating-linear-gradient(to right, #f5f5f5 0 1px, transparent 1px ${DAY_WIDTH}px)`

// 点击胶囊：复用日历的弹窗逻辑
function handleBarClick(row) {
  emit('day-click', {
    day: Number(row.dateStr.slice(8, 10)),
    dateStr: row.dateStr,
    schedules: [row.schedule]
  })
}
</script>

<template>
  <div class="timeline">
    <div class="timeline-head">
      <div>
        <h2>未来 {{ DAY_COUNT }} 天排期</h2>
        <p class="sub">{{ axisStart }} 起 · 共 {{ rows.list.length }} 条</p>
      </div>
      <span v-if="rows.outside" class="outside">另有 {{ rows.outside }} 条不在该区间</span>
    </div>

    <div class="timeline-scroll" v-if="rows.list.length">
      <div class="canvas" :style="{ width: totalWidth + 'px', '--day-w': DAY_WIDTH + 'px' }">
        <!-- 日期轴 -->
        <div class="axis">
          <div
            v-for="d in days"
            :key="d.key"
            class="axis-cell"
            :class="{ today: d.isToday, weekend: d.isWeekend }"
          >
            <span class="axis-date">{{ d.label }}</span>
            <span class="axis-week">{{ d.weekday }}</span>
          </div>
        </div>

        <!-- 行区域 -->
        <div class="rows" :style="{ backgroundImage: gridImage }">
          <div
            v-for="d in days"
            :key="'bg-' + d.key"
            class="day-bg"
            :class="{ weekend: d.isWeekend, today: d.isToday }"
            :style="{ left: d.left + 'px' }"
          ></div>

          <div class="today-line"></div>

          <div v-for="row in rows.list" :key="row.id" class="row">
            <div
              class="bar"
              :class="{
                important: row.important,
                'clip-left': row.clippedLeft,
                'clip-right': row.clippedRight
              }"
              :style="{
                left: row.left + 'px',
                width: row.width + 'px',
                backgroundColor: withAlpha(row.color, 0.18)
              }"
              :title="`${row.title}${row.time ? ' · ' + row.time : ''}（${row.duration}）`"
              @click="handleBarClick(row)"
            >
              <span class="bar-title">{{ row.title }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <p>未来 {{ DAY_COUNT }} 天还没有排期</p>
      <p class="sub">在左侧粘贴一条带日期的通知试试</p>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  height: 100%; display: flex; flex-direction: column;
  background: #fff; border-radius: 12px; padding: 16px 18px;
  box-sizing: border-box; overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.06);
}

/* ---------- 顶部说明 ---------- */
.timeline-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  margin-bottom: 12px; flex-shrink: 0; gap: 12px;
}
.timeline-head h2 { margin: 0; font-size: 16px; font-weight: 600; color: #1f2328; }
.sub { margin: 4px 0 0; font-size: 12px; color: #a1a8b3; }
.outside { font-size: 11px; color: #c2c9d1; white-space: nowrap; }

/* ---------- 滚动容器 ---------- */
.timeline-scroll { flex: 1; overflow: auto; border-radius: 10px; }
.canvas { position: relative; min-height: 100%; }

/* ---------- 日期轴 ---------- */
.axis {
  position: sticky; top: 0; z-index: 3;
  display: flex; background: #fff;
  border-bottom: 1px solid #f1f2f4;
}
.axis-cell {
  width: var(--day-w); flex: 0 0 var(--day-w); padding: 6px 0 7px;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
}
.axis-cell.weekend { background: #fafbfc; }
.axis-cell.today { background: #f0f7ff; }
.axis-date { font-size: 11px; font-weight: 600; color: #57606a; }
.axis-cell.today .axis-date { color: #1677ff; }
.axis-week { font-size: 9px; color: #b3bac4; }
.axis-cell.today .axis-week { color: #69a8ff; }

/* ---------- 行区域 ---------- */
.rows {
  position: relative;
  background-repeat: repeat-x;
  background-size: 100% 100%;
}

.day-bg {
  position: absolute; top: 0; bottom: 0; width: var(--day-w); pointer-events: none;
}
.day-bg.weekend { background: #fafbfc; }
.day-bg.today { background: #f5f9ff; }

.today-line {
  position: absolute; z-index: 3; top: 0; bottom: 0; left: 0; width: 1px;
  background: #cfe3ff; pointer-events: none;
}

.row {
  position: relative; z-index: 1; height: 40px;
  border-bottom: 1px solid #f6f7f8;
  transition: background 0.15s ease;
}
.row:hover { background: rgba(22, 119, 255, 0.03); }

/* ---------- 长条 ---------- */
.bar {
  position: absolute; z-index: 2; top: 7px; height: 26px;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  padding: 0 10px; box-sizing: border-box; overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  cursor: pointer; transition: all 0.2s ease;
}
.bar:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08); }
.bar.important { box-shadow: 0 0 0 2px rgba(245, 34, 45, 0.18); }
.bar.clip-left { border-top-left-radius: 2px; border-bottom-left-radius: 2px; }
.bar.clip-right { border-top-right-radius: 2px; border-bottom-right-radius: 2px; }

.bar-title {
  font-size: 11px; font-weight: 600; line-height: 1;
  /* 强制深色字 + 白色描边，浅色胶囊背景上也读得清 */
  color: #1f2328;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.65);
  width: 100%; text-align: center;
  padding: 0 6px; /* 避免文字顶到圆角 */
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ---------- 空状态 ---------- */
.empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; color: #b3bac4;
}
.empty p { margin: 0 0 6px; font-size: 14px; }
.empty .sub { font-size: 12px; color: #c9cfd8; margin: 0; }

/* ================= 移动端适配 ================= */
@media (max-width: 768px) {
  .timeline { padding: 10px 8px; border-radius: 10px; }

  .timeline-head { margin-bottom: 8px; }
  .timeline-head h2 { font-size: 14px; }
  .sub { font-size: 11px; margin-top: 2px; }
  .outside { display: none; } /* 太窄，先隐藏 */

  .axis-cell { padding: 4px 0 5px; }
  .axis-date { font-size: 10px; }
  .axis-week { font-size: 8px; }

  .row { height: 36px; }
  .bar { top: 5px; height: 26px; padding: 0 6px; }
  .bar-title { font-size: 10px; }
}
</style>
