// ICS（iCalendar）导出：生成标准 .ics 文本并触发下载
// 参考 RFC 5545：全天事件用 VALUE=DATE，且 DTEND 为「开区间」（不含当天）
import { normalizeDate, getBeijingToday } from './parser'

const CRLF = '\r\n'
const PRODID = '-//notice-to-calendar//CN'
const MAX_OCTETS = 75

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' -> 'YYYYMMDD'，非法返回 null
function toCompact(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  return `${m[1]}${m[2]}${m[3]}`
}

// 日期偏移 N 天，返回 'YYYYMMDD'
function shiftCompact(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000
  const d = new Date(t)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

// DTSTAMP 用 UTC 时间
function stampNow() {
  const d = new Date()
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

// 转义 TEXT 类型：反斜杠、分号、逗号、换行
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// 单行不超过 75 字节，超出折行（续行以一个空格开头），按 UTF-8 字节计算，不会切坏中文
function foldLine(line) {
  const encoder = new TextEncoder()
  let out = ''
  let current = ''
  let bytes = 0

  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (bytes + size > MAX_OCTETS) {
      out += current + CRLF + ' '
      current = ch
      bytes = 1 + size // 续行前导空格占 1 字节
    } else {
      current += ch
      bytes += size
    }
  }
  return out + current
}

// 把一条日程转成 VEVENT 的行数组；无法确定日期时返回 null
function buildEvent(s, index) {
  const startSrc = s.isDuration && s.startDate
    ? s.startDate
    : (s.date || normalizeDate(s.time))
  const endSrc = s.isDuration && s.endDate ? s.endDate : startSrc

  const dtStart = toCompact(startSrc)
  if (!dtStart) return null

  // 全天事件的 DTEND 不含当天，所以统一 +1 天
  const dtEnd = shiftCompact(endSrc, 1) || shiftCompact(startSrc, 1)

  const descParts = []
  if (s.time) descParts.push(`时间：${s.time}`)
  if (s.items && s.items.length) descParts.push(`携带：${s.items.join('、')}`)
  if (s.unit) descParts.push(`单位：${s.unit}`)
  if (s.credit) descParts.push(`学分：${s.credit}`)
  if (s.source) descParts.push(`原文：${s.source}`)

  const lines = [
    'BEGIN:VEVENT',
    `UID:${s.id || 'evt-' + index}@notice-to-calendar`,
    `DTSTAMP:${stampNow()}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${escapeText(s.title || '未命名日程')}`
  ]
  if (descParts.length) lines.push(`DESCRIPTION:${escapeText(descParts.join('\n'))}`)
  if (s.location) lines.push(`LOCATION:${escapeText(s.location)}`)
  if (s.isImportant) lines.push('PRIORITY:1')
  lines.push('END:VEVENT')
  return lines
}

/**
 * 纯函数：把日程数组转成 .ics 文本
 * @returns {{ ics: string, count: number, skipped: number }}
 */
export function buildICS(schedules) {
  const list = Array.isArray(schedules) ? schedules : []
  const eventLines = []
  let count = 0
  let skipped = 0

  list.forEach((s, i) => {
    const lines = buildEvent(s || {}, i)
    if (!lines) {
      skipped += 1
      return
    }
    eventLines.push(...lines)
    count += 1
  })

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:通知随手记',
    ...eventLines,
    'END:VCALENDAR'
  ]

  return {
    ics: lines.map(foldLine).join(CRLF) + CRLF,
    count,
    skipped
  }
}

/**
 * 生成 .ics 并触发浏览器下载
 */
export function exportToICS(schedules) {
  const { ics, count, skipped } = buildICS(schedules)

  if (!count) {
    alert('没有可导出的日程（缺少可识别的日期）')
    return { count, skipped }
  }

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `日程-${getBeijingToday()}.ics`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)

  alert(
    skipped
      ? `已导出 ${count} 条日程，另有 ${skipped} 条缺少日期已跳过`
      : `已导出 ${count} 条日程`
  )
  return { count, skipped }
}
