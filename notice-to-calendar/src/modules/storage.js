// 当前用 localStorage，后续可换 IndexedDB 或云端，调用方不用改。

const KEY = 'notice_schedules'

export function loadSchedules() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // 数据结构被手动改坏时同样不能崩，直接当作空列表
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('本地日程数据读取失败，已降级为空列表:', err)
    return []
  }
}

export function saveSchedules(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function addSchedule(item) {
  const list = loadSchedules()
  // 用 UUID 代替 Date.now()：同一毫秒并发写入也不会撞 id，避免误删两条
  item.id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  list.unshift(item)
  saveSchedules(list)
  return list
}

export function removeSchedule(id) {
  const list = loadSchedules().filter(i => i.id !== id)
  saveSchedules(list)
  return list
}
export function updateSchedule(id, updates) {
  const list = loadSchedules()
  const index = list.findIndex(i => i.id === id)
  if (index !== -1) {
    list[index] = { ...list[index], ...updates }
    saveSchedules(list)
  }
  return list
}