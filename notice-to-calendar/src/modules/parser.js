// 生成随机颜色
function getRandomColor() {
  const colors = [
    '#1677ff', '#52c41a', '#faad14', '#eb2f96',
    '#13c2c2', '#722ed1', '#fa541c', '#1890ff',
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

// AI 请求超时：超过这个时间直接中断，走本地正则，避免弱网下无限等待
// 8000ms：实测 DeepSeek 首字延迟常见 2~6s，3s 会导致几乎每次都降级
const AI_TIMEOUT_MS = 8000

// 带超时的 fetch：用 AbortController 在超时后主动中断
async function fetchWithTimeout(url, options, timeout = AI_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// 修正 AI 可能提取错的年份（按北京时间的年份）
function fixDateYear(dateStr) {
  if (!dateStr) return ''
  const currentYear = beijingYear()
  // 如果 AI 给了 "2023-10-20" 这种格式，强行替换成 2026
  const match = dateStr.match(/\d{4}-(\d{2})-(\d{2})/)
  if (match) {
    return `${currentYear}-${match[1]}-${match[2]}`
  }
  return dateStr
}

export async function parseText(text) {
  try {
    // 构造给 DeepSeek 的提示词
    const systemPrompt = `你是一个校园通知提取助手。请提取文本信息并返回严格的 JSON。
注意：
- title：必须是核心事件总结（限 10 字以内）；如果原文没有明显的标题，请直接从原文本中提取前 10 个字符作为标题（例如"文科楼开会"），绝对禁止返回"未命名日程"！
- time：提取时间描述（如"明天"）。
- isDuration：如果是持续多天的日程才设为 true。
- startDate/endDate：如果不是明确的持续多天日程，这两个字段必须填空字符串 ""，绝对禁止自行编造日期（如 2026-01-01）。
- items, unit, credit, location：如果没有就填空字符串或空数组。
只返回 JSON，不要其他文字。`

    const response = await fetchWithTimeout('/api/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    }, AI_TIMEOUT_MS)

    if (!response.ok) throw new Error(`接口返回 ${response.status}`)

    const data = await response.json()
    if (!data.choices || !data.choices[0]) throw new Error('AI 返回数据格式错误')

    const result = JSON.parse(data.choices[0].message.content)
    result.source = text
    result.color = getRandomColor()

    // 补齐字段并修复年份
    if (!result.items) result.items = []
    if (result.isImportant === undefined) result.isImportant = false
    if (result.isDuration === undefined) result.isDuration = false
    
    // 修复 AI 提取的年份错误
    result.startDate = fixDateYear(result.startDate)
    result.endDate = fixDateYear(result.endDate)
    if (!result.time) result.time = ''

    // 如果 AI 漏填了起止日期，但提取了时间，尝试用本地逻辑补充
    // 注意：localFallbackParse 现在会抛错，这里必须单独兜住，避免把 AI 的有效结果一起丢掉
    if (result.isDuration && (!result.startDate || !result.endDate)) {
      try {
        const localCheck = localFallbackParse(text)
        if (localCheck.isDuration) {
          result.startDate = localCheck.startDate
          result.endDate = localCheck.endDate
        }
      } catch (e) {
        // 本地也判断不出日期，保留 AI 的原始结果
      }
    }

    // 正常走 AI 解析
    result.isFallback = false
    return result
  } catch (err) {
    const reason = err.name === 'AbortError' ? `请求超时 ${AI_TIMEOUT_MS}ms` : err.message
    console.warn('AI 解析失败，已降级使用本地正则:', reason)
    // 标记为降级结果，前端可据此提示「网络延迟，已启用本地极速解析」
    return { ...localFallbackParse(text), isFallback: true }
  }
}

// 明确日期：10月15日 / 10-15 / 2026-10-15
const DATE_RE = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}/
// 明确的活动动作词
const ACTION_WORDS = [
  '开会', '会议', '例会', '班会', '活动', '讲座', '报告', '宣讲', '座谈', '研讨',
  '培训', '课程', '上课', '实验', '考试', '答辩', '面试', '招聘', '比赛', '竞赛',
  '报名', '签到', '缴费', '领取', '体检', '演出', '晚会', '展览', '典礼', '仪式',
  '提交', '截止', '投稿', '实习', '实践'
]

// 相对日期同样算「明确的时间信号」（明天开会 = 有效日程）
const RELATIVE_DAY_RE = /(今天|明天|后天|大后天|今日|明日)/

function hasScheduleSignal(text) {
  if (DATE_RE.test(text)) return true
  if (RELATIVE_DAY_RE.test(text)) return true
  return ACTION_WORDS.some(w => text.includes(w))
}

// 去掉时间片段，剩下的才是「事件本身」，用于本地降级时生成标题
function stripTimeText(raw) {
  return String(raw || '')
    // 10月15日 / 10月15日-10月17日 / 10月15日至17日
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号](\s*[-—至到~]\s*(\d{1,2}\s*月\s*)?\d{1,2}\s*[日号])?/g, '')
    // 今天 / 明天 / 后天 / 大后天
    .replace(/(今天|明天|后天|大后天|今日|明日)/g, '')
    // 周三 / 下周三 / 本周日 / 星期一
    .replace(/(下下|下|这|本)?\s*(周|星期|礼拜)\s*[一二三四五六日天1-7]/g, '')
    // 下午2点 / 14:30 / 9点30分
    .replace(/(上午|下午|中午|晚上|凌晨|早上|傍晚)?\s*\d{1,2}\s*[点:：]\s*(\d{1,2}\s*分?)?/g, '')
    // 残留的时段词
    .replace(/(上午|下午|中午|晚上|凌晨|早上|傍晚)/g, '')
    // 开头常见的「请于 / 请 / 望」
    .replace(/^(请于|请|务必|望)+/, '')
    // 标点与空白
    .replace(/[，,。；;：:、！!？?\s]+/g, '')
}

// 本地正则解析（备用方案）
function localFallbackParse(text) {
  const normalized = String(text || '')

  // 兜底门槛：既没有日期也没有动作词，直接判定为无效文本
  if (!hasScheduleSignal(normalized)) {
    throw new Error('文本中未检测到有效日程')
  }

  const currentYear = beijingYear()
  const result = {
    title: '未命名日程', time: '', location: '', items: [], unit: '',
    credit: '', source: text, isImportant: false, isDuration: false,
    startDate: '', endDate: '', color: getRandomColor()
  }

  const durationMatch = text.match(/(\d{1,2})月(\d{1,2})日\s*[-—至到~]\s*(?:(\d{1,2})月)?(\d{1,2})日/)
  if (durationMatch) {
    result.isDuration = true
    const startM = durationMatch[1].padStart(2, '0')
    const startD = durationMatch[2].padStart(2, '0')
    const endM = durationMatch[3] ? durationMatch[3].padStart(2, '0') : startM
    const endD = durationMatch[4].padStart(2, '0')
    result.startDate = `${currentYear}-${startM}-${startD}`
    result.endDate = `${currentYear}-${endM}-${endD}`
    result.time = `${durationMatch[1]}月${durationMatch[2]}日-${endM}月${endD}日`
  } else {
    const timePatterns = [
      /(\d{1,2}月\d{1,2}日[^\s，,。；;]*)/,
      /((?:下下|下|这|本)?\s*(?:周|星期|礼拜)[一二三四五六日天1-7][^\s，,。；;]*)/,
      /(\d{1,2}\s*天(?:之?后|以后)[^\s，,。；;]*)/,
      /(明天[^\s，,。；;]*)/,
      /(今天[^\s，,。；;]*)/,
      /(\d{1,2}[:：]\d{2})/
    ]
    for (const p of timePatterns) {
      const m = text.match(p)
      if (m) { result.time = m[1]; break }
    }
  }

  const titleMatch = text.match(/(关于[^的]{2,20}的通知)/)
  if (titleMatch) {
    result.title = titleMatch[1]
  } else {
    // 先把时间片段剔除，再截断，避免标题变成「10月15日下午2点」
    const stripped = stripTimeText(text)
    result.title = stripped.slice(0, 10) || '未命名日程'
  }

  const locMatch = text.match(/([^\s，,。；;]{2,15}(报告厅|图书馆|教学楼|体育馆|会议室|楼|室|厅|馆|场))/)
  if (locMatch) result.location = locMatch[1]

  const itemMatches = text.match(/带([^\s，,。；;]+)/g)
  if (itemMatches) result.items = itemMatches.map(s => s.replace(/^带/, ''))

  const unitMatch = text.match(/([^\s，,。；;]{2,10}(学院|学部|系|处|中心|办公室))/)
  if (unitMatch) result.unit = unitMatch[1]

  const creditMatch = text.match(/(\d+(\.\d+)?)\s*学分/)
  if (creditMatch) result.credit = creditMatch[1]

  return result
}

// 中国无夏令时，固定 UTC+8
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// 北京时间的“天序号”（1970-01-01 起的天数），与运行环境时区无关
function beijingDayNumber(date = new Date()) {
  return Math.floor((date.getTime() + BEIJING_OFFSET_MS) / ONE_DAY_MS)
}

// 天序号转 YYYY-MM-DD
function dayNumberToString(dayNumber) {
  const d = new Date(dayNumber * ONE_DAY_MS)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 北京时间的年份（跨年零点也不会取错）
function beijingYear(date = new Date()) {
  return Number(dayNumberToString(beijingDayNumber(date)).slice(0, 4))
}

// 北京时间的今天（YYYY-MM-DD），供日历等组件统一取用
export function getBeijingToday(date = new Date()) {
  return dayNumberToString(beijingDayNumber(date))
}

// 天序号对应的星期几（周一=1 … 周日=7）
function weekdayOfDayNumber(dayNumber) {
  const dow = new Date(dayNumber * ONE_DAY_MS).getUTCDay()
  return dow === 0 ? 7 : dow
}

const WEEKDAY_CHAR = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7
}

// 解析相对时间，返回天序号；无法解析返回 null
// 支持：今天/明天/后天/大后天、周三/本周三/下周三/下下周三、N天后
function resolveRelativeDay(timeStr, now = new Date()) {
  const today = beijingDayNumber(now)

  // 周几
  const weekMatch = timeStr.match(/(下下|下|这|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/)
  if (weekMatch) {
    const prefix = weekMatch[1] || ''
    const target = WEEKDAY_CHAR[weekMatch[2]]
    const base = weekdayOfDayNumber(today)
    let delta
    if (prefix === '下') delta = 7 - base + target // 下周的周 X
    else if (prefix === '下下') delta = 14 - base + target // 下下周的周 X
    else if (prefix === '这' || prefix === '本') delta = target - base // 本周，可能已过去
    else delta = (target - base + 7) % 7 // 裸「周三」取最近的一次（含今天）
    return today + delta
  }

  // N 天后 / N 天以后
  const afterMatch = timeStr.match(/(\d{1,2})\s*天(?:之?后|以后)/)
  if (afterMatch) return today + Number(afterMatch[1])

  if (timeStr.includes('大后天')) return today + 3
  if (timeStr.includes('后天')) return today + 2
  if (timeStr.includes('明天') || timeStr.includes('明日')) return today + 1
  if (timeStr.includes('今天') || timeStr.includes('今日')) return today

  return null
}

// 日期规范化（日历组件依赖此函数）
export function normalizeDate(timeStr) {
  if (!timeStr) return ''
  const now = new Date()

  // 明确的「X月X日」优先
  const mdMatch = timeStr.match(/(\d{1,2})月(\d{1,2})日/)
  if (mdMatch) {
    const currentYear = dayNumberToString(beijingDayNumber(now)).slice(0, 4)
    const month = mdMatch[1].padStart(2, '0')
    const day = mdMatch[2].padStart(2, '0')
    return `${currentYear}-${month}-${day}`
  }

  // 相对时间：今天 / 明天 / 周三 / 下周三 / 3天后 …
  const relativeDay = resolveRelativeDay(timeStr, now)
  if (relativeDay !== null) return dayNumberToString(relativeDay)

  return ''
}