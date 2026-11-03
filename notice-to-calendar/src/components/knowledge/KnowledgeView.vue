<script setup>
/**
 * 知识库卡片视图
 *
 * 交互：
 *   - 点击卡片 -> 弹窗浏览全文（Markdown 渲染，图片直接显示）
 *   - 多选 -> 合并成一张新卡片
 *   - 拖拽卡片到分类 -> 本地分类（localStorage）
 *   - 搜索、类型筛选、星标、图片灯箱
 *
 * 后端：api_server.py
 *   GET  /api/knowledge
 *   POST /api/knowledge/merge
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MarkdownIt from 'markdown-it'

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')
const API_URL = `${API_BASE}/api/knowledge`
const REQUEST_TIMEOUT = 8000

const CATEGORY_KEY = 'kb_category_map_v1'
const CUSTOM_CATEGORY_KEY = 'kb_custom_categories_v1'
const STAR_KEY = 'kb_starred_v1'
const DEFAULT_CATEGORIES = ['未分类', '学习', '工作', '生活', '重要']

const items = ref([])
const loading = ref(false)
const error = ref('')
const hasLoaded = ref(false)

const query = ref('')
const typeFilter = ref('all')
const categoryFilter = ref('全部')
const starredOnly = ref(false)

const selecting = ref(false)
const selected = ref([])
const detail = ref(null)
const lightbox = ref('')
const mergeOpen = ref(false)
const mergeTitle = ref('')
const mergeType = ref('knowledge')
const mergeTags = ref('')
const merging = ref(false)
const toast = ref('')

const categoryMap = ref(loadJson(CATEGORY_KEY, {}))
const customCategories = ref(loadJson(CUSTOM_CATEGORY_KEY, []))
const starred = ref(new Set(loadJson(STAR_KEY, [])))

const md = createMarkdown()
const renderCache = new Map()

let controller = null
let toastTimer = null

const categories = computed(() => {
  const set = new Set([...DEFAULT_CATEGORIES, ...customCategories.value])
  return ['全部', ...set]
})

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  return items.value.filter((item) => {
    if (typeFilter.value !== 'all' && item.type !== typeFilter.value) return false
    if (starredOnly.value && !starred.value.has(item.filename)) return false
    if (categoryFilter.value !== '全部' && categoryOf(item) !== categoryFilter.value) return false
    if (!text) return true
    return [item.title, item.content, item.source, ...(item.tags || [])]
      .join(' ')
      .toLowerCase()
      .includes(text)
  })
})

const typeCounts = computed(() => ({
  all: items.value.length,
  schedule: items.value.filter((x) => x.type === 'schedule').length,
  knowledge: items.value.filter((x) => x.type === 'knowledge').length
}))

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式/存储满时忽略，不阻塞浏览
  }
}

function createMarkdown() {
  const engine = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true
  })

  const defaultImage = engine.renderer.rules.image
  engine.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = token.attrGet('src') || ''
    token.attrSet('src', imageUrl(src))
    token.attrSet('loading', 'lazy')
    token.attrSet('decoding', 'async')
    token.attrSet('class', 'kb-md-image')
    return defaultImage
      ? defaultImage(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }

  const defaultLink = engine.renderer.rules.link_open
  engine.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noreferrer noopener')
    return defaultLink
      ? defaultLink(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }
  return engine
}

function imageUrl(src) {
  if (!src) return ''
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  let path = src.replace(/^\.?\//, '')
  if (path.startsWith('images/')) return `${API_BASE}/${path}`
  if (path.startsWith('assets/')) return `${API_BASE}/${path}`
  return `${API_BASE}/images/${path.split('/').pop()}`
}

function renderMarkdown(item) {
  if (!item) return ''
  if (renderCache.has(item.filename)) return renderCache.get(item.filename)
  const html = md.render(item.content || '')
  renderCache.set(item.filename, html)
  return html
}

function imageList(content) {
  const matches = [...String(content || '').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
  return [...new Set(matches.map((m) => imageUrl(m[1].trim())))]
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function typeMeta(type) {
  if (type === 'schedule') return { label: '日程', icon: '📅', className: 'type-schedule' }
  if (type === 'knowledge') return { label: '知识', icon: '📘', className: 'type-knowledge' }
  return { label: '未分类', icon: '📄', className: 'type-other' }
}

function formatDate(value) {
  const text = String(value || '').trim()
  return text ? text.replace('T', ' ').slice(0, 16) : ''
}

function categoryOf(item) {
  return categoryMap.value[item.filename] || '未分类'
}

function hasLink(content) {
  return /https?:\/\//i.test(String(content || ''))
}

function isStarred(item) {
  return starred.value.has(item.filename)
}

function toggleStar(item, event) {
  event?.stopPropagation()
  const next = new Set(starred.value)
  if (next.has(item.filename)) next.delete(item.filename)
  else next.add(item.filename)
  starred.value = next
  saveJson(STAR_KEY, [...next])
}

function setCategory(filename, category) {
  categoryMap.value = { ...categoryMap.value, [filename]: category }
  saveJson(CATEGORY_KEY, categoryMap.value)
  showToast(`已归类到「${category}」`)
}

function addCategory(event) {
  event?.stopPropagation()
  const name = window.prompt('新分类名称')
  const value = String(name || '').trim()
  if (!value) return
  if (!categories.value.includes(value)) {
    customCategories.value = [...customCategories.value, value]
    saveJson(CUSTOM_CATEGORY_KEY, customCategories.value)
  }
}

function onDragStart(item, event) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', item.filename)
}

function onDropCategory(category, event) {
  event.preventDefault()
  const filename = event.dataTransfer.getData('text/plain')
  if (filename) setCategory(filename, category)
}

function isSelected(filename) {
  return selected.value.includes(filename)
}

function toggleSelect(item, event) {
  event?.stopPropagation()
  const next = selected.value.includes(item.filename)
    ? selected.value.filter((x) => x !== item.filename)
    : [...selected.value, item.filename]
  selected.value = next
}

function toggleSelecting() {
  selecting.value = !selecting.value
  if (!selecting.value) selected.value = []
}

function clearSelection() {
  selected.value = []
}

function selectAllVisible() {
  selected.value = filtered.value.map((item) => item.filename)
}

function onCardClick(item) {
  if (selecting.value) {
    toggleSelect(item)
  } else {
    openDetail(item)
  }
}

function openDetail(item) {
  detail.value = item
}

function closeDetail() {
  detail.value = null
  lightbox.value = ''
}

function openImage(src, event) {
  event?.stopPropagation()
  lightbox.value = src
}

function onMarkdownClick(event) {
  if (event.target?.tagName === 'IMG') {
    lightbox.value = event.target.src
  }
}

function openMerge() {
  if (selected.value.length < 2) return
  const first = items.value.find((x) => x.filename === selected.value[0])
  mergeTitle.value = first ? `合并-${first.title.slice(0, 12)}` : '合并知识'
  mergeType.value = first?.type === 'schedule' ? 'schedule' : 'knowledge'
  mergeTags.value = ''
  mergeOpen.value = true
}

async function confirmMerge() {
  if (merging.value || selected.value.length < 2) return
  merging.value = true
  try {
    const response = await fetch(`${API_BASE}/api/knowledge/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        filenames: selected.value,
        title: mergeTitle.value.trim(),
        type: mergeType.value,
        tags: mergeTags.value.split(/[,，;；\s]+/).filter(Boolean)
      })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || `HTTP ${response.status}`)
    }
    mergeOpen.value = false
    selected.value = []
    selecting.value = false
    await loadKnowledge()
    showToast('合并完成，已生成新卡片')
  } catch (err) {
    showToast(`合并失败：${err?.message || err}`, 4000)
  } finally {
    merging.value = false
  }
}

async function copyText(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(String(text || ''))
    showToast(label)
  } catch {
    showToast('复制失败，请手动选择文本')
  }
}

function copyLocate(item) {
  const hint = `${item.title} ${item.date}`
  copyText(hint, '微信不支持深链，已复制标题和日期，请在微信搜索')
}

function showToast(message, duration = 2200) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, duration)
}

async function loadKnowledge() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  controller?.abort()
  controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('接口返回的数据格式不是数组')

    items.value = data
      .filter((raw) => raw && typeof raw === 'object')
      .map((raw, index) => ({
        key: raw.filename || `${raw.type || 'knowledge'}-${index}`,
        filename: String(raw.filename || ''),
        type: String(raw.type || 'knowledge').toLowerCase(),
        title: String(raw.title || raw.filename || '未命名条目'),
        date: formatDate(raw.date),
        source: String(raw.source || ''),
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        content: String(raw.content || '')
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))

    renderCache.clear()
    hasLoaded.value = true
  } catch (err) {
    if (err?.name === 'AbortError') {
      error.value = '请求超时，本地 API 可能未启动'
    } else if (err instanceof TypeError) {
      error.value = '无法连接本地 API，请先启动 api_server.py'
    } else {
      error.value = `加载失败：${err?.message || err}`
    }
  } finally {
    clearTimeout(timer)
    loading.value = false
  }
}

function onKeydown(event) {
  if (event.key !== 'Escape') return
  if (lightbox.value) {
    lightbox.value = ''
  } else if (mergeOpen.value) {
    mergeOpen.value = false
  } else if (detail.value) {
    closeDetail()
  }
}

onMounted(() => {
  loadKnowledge()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  controller?.abort()
  window.removeEventListener('keydown', onKeydown)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <section class="knowledge-view">
    <div class="kv-pagebar">
      <RouterLink to="/" class="kv-back">← 返回日程</RouterLink>
      <span class="kv-page-name">知识栏目</span>
      <RouterLink to="/console" class="kv-console-link">🧭 控制台</RouterLink>
    </div>

    <header class="kv-head">
      <div class="kv-title">
        <h2>我的知识库</h2>
        <span class="kv-sub">{{ loading ? '同步中…' : `共 ${items.length} 条` }}</span>
      </div>
      <div class="kv-actions">
        <button class="kv-btn" :disabled="loading" @click="loadKnowledge">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button class="kv-btn" :class="{ active: selecting }" @click="toggleSelecting">
          {{ selecting ? '退出多选' : '多选合并' }}
        </button>
      </div>
    </header>

    <div class="kv-toolbar">
      <input v-model="query" class="kv-search" type="search" placeholder="搜索标题、正文、来源、标签…" />
      <div class="kv-tabs">
        <button :class="{ active: typeFilter === 'all' }" @click="typeFilter = 'all'">全部 {{ typeCounts.all }}</button>
        <button :class="{ active: typeFilter === 'schedule' }" @click="typeFilter = 'schedule'">日程 {{ typeCounts.schedule }}</button>
        <button :class="{ active: typeFilter === 'knowledge' }" @click="typeFilter = 'knowledge'">知识 {{ typeCounts.knowledge }}</button>
        <button :class="{ active: starredOnly }" @click="starredOnly = !starredOnly">★ 星标</button>
      </div>
    </div>

    <div class="kv-categories">
      <span class="kv-cat-label">分类</span>
      <button
        v-for="cat in categories"
        :key="cat"
        class="kv-cat"
        :class="{ active: categoryFilter === cat }"
        @click="categoryFilter = cat"
        @dragover.prevent
        @drop="cat !== '全部' && onDropCategory(cat, $event)"
      >
        {{ cat }}
      </button>
      <button class="kv-cat add" @click="addCategory">＋ 新建</button>
      <span class="kv-drag-hint">拖拽卡片到分类上即可归类</span>
    </div>

    <div v-if="selecting" class="kv-selectbar">
      <span>已选 {{ selected.length }} 张</span>
      <button @click="selectAllVisible">全选当前</button>
      <button @click="clearSelection">清空</button>
      <button class="primary" :disabled="selected.length < 2" @click="openMerge">合并为一张卡片</button>
    </div>

    <div v-if="error && !items.length" class="kv-state kv-error" role="alert">
      <div class="kv-state-icon">🔌</div>
      <p class="kv-state-title">{{ error }}</p>
      <ul class="kv-tips">
        <li>启动本地服务：<code>.\venv\Scripts\python.exe api_server.py</code></li>
        <li>或双击桌面的「微信知识库管家」→ 一键启动全部</li>
        <li>接口地址：<a :href="`${API_BASE}/api/knowledge`" target="_blank" rel="noreferrer">{{ API_BASE }}/api/knowledge</a></li>
      </ul>
      <button class="kv-retry" @click="loadKnowledge">重新连接</button>
    </div>

    <template v-else>
      <div v-if="error" class="kv-banner">
        <span>{{ error }}</span>
        <button @click="loadKnowledge">重试</button>
      </div>

      <div v-if="loading && !hasLoaded" class="kv-grid">
        <div v-for="n in 6" :key="n" class="kv-card skeleton">
          <div class="sk-line w60"></div>
          <div class="sk-line w90"></div>
          <div class="sk-line w80"></div>
          <div class="sk-line w60"></div>
        </div>
      </div>

      <div v-else-if="!filtered.length" class="kv-state">
        <div class="kv-state-icon">🗂️</div>
        <p class="kv-state-title">{{ items.length ? '没有匹配的卡片' : '还没有任何知识条目' }}</p>
        <p class="kv-state-desc">{{ items.length ? '换个关键词或分类试试。' : '在微信里采集一条记录，刷新即可看到。' }}</p>
      </div>

      <div v-else class="kv-grid">
        <article
          v-for="item in filtered"
          :key="item.filename"
          class="kv-card"
          :class="[typeMeta(item.type).className, { selected: isSelected(item.filename), selecting }]"
          draggable="true"
          @dragstart="onDragStart(item, $event)"
          @click="onCardClick(item)"
        >
          <div class="kv-card-top">
            <label v-if="selecting" class="kv-check" @click.stop>
              <input type="checkbox" :checked="isSelected(item.filename)" @change="toggleSelect(item, $event)" />
            </label>
            <span class="kv-badge">{{ typeMeta(item.type).icon }} {{ typeMeta(item.type).label }}</span>
            <time v-if="item.date" class="kv-date">{{ item.date }}</time>
            <button class="kv-star" :class="{ on: isStarred(item) }" @click="toggleStar(item, $event)">
              {{ isStarred(item) ? '★' : '☆' }}
            </button>
          </div>

          <h3 class="kv-card-title">{{ item.title }}</h3>
          <p class="kv-card-content">{{ stripMarkdown(item.content).slice(0, 180) || '（无正文）' }}</p>

          <div v-if="imageList(item.content).length" class="kv-thumbs">
            <img
              v-for="src in imageList(item.content).slice(0, 3)"
              :key="src"
              :src="src"
              alt=""
              loading="lazy"
              @click="openImage(src, $event)"
            />
            <span v-if="imageList(item.content).length > 3" class="kv-more-img">
              +{{ imageList(item.content).length - 3 }}
            </span>
          </div>

          <footer class="kv-card-foot">
            <span class="kv-source">来源：{{ item.source || '未知' }}</span>
            <span class="kv-cat-badge">{{ categoryOf(item) }}</span>
            <span v-if="hasLink(item.content)" class="kv-link-badge">🔗 链接</span>
          </footer>

          <div class="kv-open-hint">点击查看全文 →</div>
        </article>
      </div>
    </template>

    <!-- 详情弹窗 -->
    <div v-if="detail" class="kv-modal-mask" @click.self="closeDetail">
      <article class="kv-modal">
        <header class="kv-modal-head">
          <div>
            <span class="kv-badge">{{ typeMeta(detail.type).icon }} {{ typeMeta(detail.type).label }}</span>
            <h2>{{ detail.title }}</h2>
            <p class="kv-modal-meta">
              {{ detail.date || '无日期' }} · 来源：{{ detail.source || '未知' }} · {{ detail.filename }}
            </p>
          </div>
          <button class="kv-modal-close" @click="closeDetail">✕</button>
        </header>

        <div class="kv-modal-actions">
          <button @click="copyText(detail.content, '已复制全文')">复制全文</button>
          <button @click="copyLocate(detail)">复制定位信息</button>
          <button @click="toggleStar(detail, $event)">{{ isStarred(detail) ? '★ 已星标' : '☆ 星标' }}</button>
          <select :value="categoryOf(detail)" @change="setCategory(detail.filename, $event.target.value)">
            <option v-for="cat in categories.filter((x) => x !== '全部')" :key="cat">{{ cat }}</option>
          </select>
        </div>

        <div class="markdown-body" @click="onMarkdownClick" v-html="renderMarkdown(detail)"></div>

        <footer class="kv-modal-foot">
          <span>图片点击可放大；微信原文暂不支持深链，可复制标题/日期后到微信搜索。</span>
          <button @click="closeDetail">关闭</button>
        </footer>
      </article>
    </div>

    <!-- 图片灯箱 -->
    <div v-if="lightbox" class="kv-lightbox" @click="lightbox = ''">
      <img :src="lightbox" alt="" @click.stop />
    </div>

    <!-- 合并弹窗 -->
    <div v-if="mergeOpen" class="kv-modal-mask" @click.self="mergeOpen = false">
      <section class="kv-merge">
        <header>
          <h2>合并 {{ selected.length }} 张卡片</h2>
          <button class="kv-modal-close" @click="mergeOpen = false">✕</button>
        </header>
        <label>标题<input v-model="mergeTitle" placeholder="合并后的标题" /></label>
        <label>类型
          <select v-model="mergeType">
            <option value="knowledge">知识</option>
            <option value="schedule">日程</option>
          </select>
        </label>
        <label>标签<input v-model="mergeTags" placeholder="用逗号分隔，例如：学习, 期末" /></label>
        <p class="kv-merge-tip">会生成一张新的 Markdown 卡片，原卡片保留；图片引用仍指向原 images/ 目录。</p>
        <footer>
          <button @click="mergeOpen = false">取消</button>
          <button class="primary" :disabled="merging" @click="confirmMerge">{{ merging ? '合并中…' : '确认合并' }}</button>
        </footer>
      </section>
    </div>

    <div v-if="toast" class="kv-toast">{{ toast }}</div>
  </section>
</template>

<style scoped>
.knowledge-view { min-height: 100vh; padding: 20px 24px 40px; background: #f5f7fb; box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2328; }
.kv-pagebar { display: flex; align-items: center; gap: 10px; max-width: 1200px; margin: 0 auto 16px; }
.kv-back { padding: 7px 14px; font-size: 13px; color: #57606a; background: #fff; border: 1px solid #e6eaf0; border-radius: 9px; text-decoration: none; }
.kv-back:hover { color: #1677ff; background: #f2f7ff; }
.kv-page-name { font-size: 13px; color: #8f959e; }
.kv-console-link { margin-left: auto; padding: 7px 13px; font-size: 12px; color: #1677ff; background: #fff; border: 1px solid #d6e6ff; border-radius: 9px; text-decoration: none; }
.kv-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; max-width: 1200px; margin: 0 auto 12px; }
.kv-title { display: flex; align-items: baseline; gap: 8px; }
.kv-title h2 { margin: 0; font-size: 19px; font-weight: 750; }
.kv-sub { font-size: 12px; color: #9aa4af; }
.kv-actions { display: flex; gap: 8px; }
.kv-btn { padding: 7px 13px; font-size: 12px; color: #57606a; background: #fff; border: 1px solid #e2e7ee; border-radius: 8px; cursor: pointer; font-family: inherit; }
.kv-btn:hover, .kv-btn.active { color: #1677ff; background: #f2f7ff; border-color: #b3d4ff; }
.kv-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.kv-toolbar { display: flex; gap: 10px; max-width: 1200px; margin: 0 auto 10px; flex-wrap: wrap; }
.kv-search { flex: 1; min-width: 240px; padding: 9px 13px; font-size: 13px; background: #fff; border: 1px solid #e2e7ee; border-radius: 10px; outline: none; }
.kv-search:focus { border-color: #9cc4ff; box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1); }
.kv-tabs { display: flex; gap: 4px; background: #fff; border: 1px solid #e2e7ee; border-radius: 10px; padding: 3px; }
.kv-tabs button { padding: 6px 10px; font-size: 12px; color: #6b7684; background: transparent; border: none; border-radius: 7px; cursor: pointer; font-family: inherit; }
.kv-tabs button.active { color: #1677ff; background: #e8f2ff; font-weight: 600; }
.kv-categories { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; max-width: 1200px; margin: 0 auto 10px; }
.kv-cat-label { font-size: 12px; color: #9aa4af; }
.kv-cat { padding: 5px 10px; font-size: 12px; color: #57606a; background: #fff; border: 1px solid #e6eaf0; border-radius: 999px; cursor: pointer; font-family: inherit; }
.kv-cat.active { color: #1677ff; background: #e8f2ff; border-color: #b3d4ff; }
.kv-cat.add { color: #8f959e; border-style: dashed; }
.kv-drag-hint { font-size: 11px; color: #a0a8b3; margin-left: 4px; }
.kv-selectbar { display: flex; align-items: center; gap: 8px; max-width: 1200px; margin: 0 auto 10px; padding: 8px 12px; background: #fff; border: 1px solid #d6e6ff; border-radius: 10px; font-size: 12px; color: #57606a; }
.kv-selectbar button { padding: 4px 10px; font-size: 12px; color: #1677ff; background: #f2f7ff; border: 1px solid #d6e6ff; border-radius: 7px; cursor: pointer; font-family: inherit; }
.kv-selectbar button.primary { color: #fff; background: #1677ff; border-color: #1677ff; }
.kv-selectbar button:disabled { opacity: 0.45; cursor: not-allowed; }
.kv-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); max-width: 1200px; margin: 0 auto; }
.kv-card { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 14px; background: #fbfcfd; border: 1px solid #e9edf3; border-left: 4px solid var(--accent, #8b949e); border-radius: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.035); cursor: pointer; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; box-sizing: border-box; min-width: 0; }
.kv-card:hover { transform: translateY(-2px); box-shadow: 0 9px 24px rgba(15,35,70,0.08); border-color: #dfe5ee; }
.kv-card.selected { border-color: #1677ff; box-shadow: 0 0 0 3px rgba(22,119,255,0.12); }
.kv-card.type-schedule { --accent: #1677ff; --soft: #e8f2ff; }
.kv-card.type-knowledge { --accent: #12a150; --soft: #e9f8ef; }
.kv-card.type-other { --accent: #8b949e; --soft: #f2f4f7; }
.kv-card-top { display: flex; align-items: center; gap: 8px; }
.kv-badge { padding: 3px 8px; font-size: 11px; font-weight: 600; color: var(--accent, #57606a); background: var(--soft, #f2f4f7); border-radius: 999px; white-space: nowrap; }
.kv-date { margin-left: auto; font-size: 11px; color: #9aa4af; white-space: nowrap; }
.kv-star { margin-left: 2px; padding: 0 3px; font-size: 16px; color: #c4cad2; background: none; border: none; cursor: pointer; }
.kv-star.on { color: #f59e0b; }
.kv-check input { width: 15px; height: 15px; accent-color: #1677ff; cursor: pointer; }
.kv-card-title { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.4; word-break: break-word; }
.kv-card-content { margin: 0; font-size: 12.5px; line-height: 1.65; color: #66707c; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.kv-thumbs { display: flex; gap: 6px; margin-top: 2px; overflow: hidden; }
.kv-thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid #eef1f5; cursor: zoom-in; }
.kv-more-img { align-self: center; font-size: 11px; color: #8f959e; }
.kv-card-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: auto; padding-top: 8px; border-top: 1px dashed #eef1f5; font-size: 11px; color: #9aa4af; }
.kv-source { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kv-cat-badge { padding: 2px 7px; color: #7a8492; background: #f3f5f8; border-radius: 999px; }
.kv-link-badge { color: #1677ff; }
.kv-open-hint { font-size: 11px; color: #1677ff; opacity: 0; transition: opacity .18s; }
.kv-card:hover .kv-open-hint { opacity: 1; }
.kv-state { margin: 24px auto; max-width: 480px; padding: 24px 20px; text-align: center; background: #fff; border: 1px solid #eceef1; border-radius: 14px; }
.kv-error { background: #fffafa; border-color: #ffe0dc; }
.kv-state-icon { font-size: 28px; }
.kv-state-title { margin: 10px 0 6px; font-size: 14px; font-weight: 600; }
.kv-state-desc { margin: 0; font-size: 12.5px; line-height: 1.7; color: #8f959e; }
.kv-tips { margin: 12px 0 0; padding-left: 18px; text-align: left; font-size: 12px; line-height: 1.9; color: #6b7684; }
.kv-tips code { padding: 1px 5px; font-size: 11.5px; background: #f2f4f7; border-radius: 5px; word-break: break-all; }
.kv-tips a { color: #1677ff; }
.kv-retry { margin-top: 14px; padding: 8px 18px; font-size: 13px; color: #fff; background: #1677ff; border: none; border-radius: 9px; cursor: pointer; }
.kv-banner { display: flex; justify-content: space-between; gap: 10px; max-width: 1200px; margin: 0 auto 12px; padding: 9px 12px; font-size: 12px; color: #d4380d; background: #fff7f0; border: 1px solid #ffd8bf; border-radius: 9px; }
.kv-banner button { padding: 4px 10px; font-size: 12px; color: #d4380d; background: #fff; border: 1px solid #ffbb96; border-radius: 7px; cursor: pointer; }
.kv-card.skeleton { cursor: default; border-left-color: #eceef1; gap: 10px; }
.sk-line { height: 10px; border-radius: 6px; background: linear-gradient(90deg, #f0f2f5 25%, #f7f8fa 37%, #f0f2f5 63%); background-size: 400% 100%; animation: kv-shimmer 1.3s ease infinite; }
.w60 { width: 60%; } .w80 { width: 80%; } .w90 { width: 90%; }
@keyframes kv-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }

/* 弹窗 */
.kv-modal-mask { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(17, 24, 39, 0.45); backdrop-filter: blur(3px); }
.kv-modal { display: flex; flex-direction: column; width: min(900px, 100%); max-height: 88vh; background: #fff; border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,0.25); overflow: hidden; }
.kv-modal-head { display: flex; justify-content: space-between; gap: 16px; padding: 20px 22px 12px; border-bottom: 1px solid #eef1f5; }
.kv-modal-head h2 { margin: 7px 0 5px; font-size: 21px; line-height: 1.35; }
.kv-modal-meta { margin: 0; font-size: 12px; color: #8f959e; word-break: break-all; }
.kv-modal-close { flex-shrink: 0; width: 34px; height: 34px; color: #57606a; background: #f5f7fa; border: none; border-radius: 50%; cursor: pointer; font-size: 15px; }
.kv-modal-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 10px 22px; border-bottom: 1px solid #f1f4f8; }
.kv-modal-actions button, .kv-modal-actions select { padding: 6px 10px; font-size: 12px; color: #57606a; background: #f7f9fc; border: 1px solid #e6eaf0; border-radius: 8px; cursor: pointer; font-family: inherit; }
.kv-modal-actions button:hover { color: #1677ff; border-color: #b3d4ff; }
.markdown-body { flex: 1; overflow: auto; padding: 18px 24px 24px; font-size: 13.5px; line-height: 1.85; color: #374151; word-break: break-word; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3) { margin: 18px 0 8px; color: #1f2328; line-height: 1.35; }
.markdown-body :deep(h1) { font-size: 19px; } .markdown-body :deep(h2) { font-size: 17px; } .markdown-body :deep(h3) { font-size: 15px; }
.markdown-body :deep(p) { margin: 8px 0; }
.markdown-body :deep(a) { color: #1677ff; }
.markdown-body :deep(img) { display: block; max-width: 100%; height: auto; margin: 10px 0; border-radius: 10px; border: 1px solid #eef1f5; cursor: zoom-in; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 22px; }
.markdown-body :deep(blockquote) { margin: 10px 0; padding: 4px 12px; color: #6b7684; border-left: 3px solid #d6e6ff; background: #f7faff; }
.markdown-body :deep(code) { padding: 1px 5px; font-size: 12px; background: #f2f4f7; border-radius: 5px; }
.markdown-body :deep(pre) { padding: 12px; overflow: auto; background: #f6f8fa; border-radius: 9px; }
.markdown-body :deep(hr) { border: none; border-top: 1px solid #eef1f5; margin: 16px 0; }
.kv-modal-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 20px; border-top: 1px solid #eef1f5; font-size: 11px; color: #9aa4af; }
.kv-modal-foot button { padding: 6px 14px; font-size: 12px; color: #fff; background: #1677ff; border: none; border-radius: 8px; cursor: pointer; }
.kv-lightbox { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 30px; background: rgba(0,0,0,0.82); cursor: zoom-out; }
.kv-lightbox img { max-width: 92vw; max-height: 88vh; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); cursor: default; }
.kv-merge { width: min(480px, 100%); padding: 20px; background: #fff; border-radius: 16px; box-shadow: 0 30px 80px rgba(0,0,0,0.25); }
.kv-merge header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.kv-merge h2 { margin: 0; font-size: 17px; }
.kv-merge label { display: flex; flex-direction: column; gap: 5px; margin: 10px 0; font-size: 12px; color: #6b7684; }
.kv-merge input, .kv-merge select { padding: 8px 10px; font-size: 13px; border: 1px solid #e2e7ee; border-radius: 8px; font-family: inherit; }
.kv-merge-tip { font-size: 11px; line-height: 1.6; color: #9aa4af; }
.kv-merge footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.kv-merge footer button { padding: 8px 16px; font-size: 12px; color: #57606a; background: #f5f7fa; border: 1px solid #e2e7ee; border-radius: 8px; cursor: pointer; }
.kv-merge footer button.primary { color: #fff; background: #1677ff; border-color: #1677ff; }
.kv-toast { position: fixed; left: 50%; bottom: 28px; z-index: 100; transform: translateX(-50%); max-width: 80vw; padding: 9px 16px; font-size: 12.5px; color: #fff; background: rgba(31, 35, 40, 0.92); border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); }

@media (max-width: 640px) {
  .knowledge-view { padding: 14px 12px 28px; }
  .kv-grid { grid-template-columns: minmax(0, 1fr); }
  .kv-tabs { flex-wrap: wrap; }
  .kv-modal-mask { padding: 10px; }
  .kv-modal { max-height: 94vh; }
  .kv-modal-head { padding: 16px 16px 10px; }
  .kv-modal-actions, .markdown-body { padding-left: 16px; padding-right: 16px; }
  .kv-modal-foot { flex-direction: column; align-items: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .sk-line { animation: none; }
  .kv-card { transition: none; }
}
</style>
