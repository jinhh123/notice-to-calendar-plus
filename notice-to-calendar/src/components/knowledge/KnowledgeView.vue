<script setup>
/**
 * 知识库插件视图（可选模块）
 *
 * 职责：请求本地 FastAPI（http://127.0.0.1:8000/api/knowledge），
 *      把微信采集来的 Markdown 渲染成卡片列表。
 *
 * 注意：本组件被 App.vue 用 defineAsyncComponent 懒加载，
 *      只有用户开启插件时才会执行这里的代码、才会发出 fetch。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 接口地址：默认本地 8000 端口；如需改动，可在 .env 里配置 VITE_KB_API
const API_URL = import.meta.env.VITE_KB_API || 'http://127.0.0.1:8000/api/knowledge'
const REQUEST_TIMEOUT = 8000 // 8 秒超时，避免本地服务没开时一直转圈

const items = ref([])        // 归一化后的知识条目
const loading = ref(false)   // 是否正在请求
const error = ref('')        // 错误提示文案
const hasLoaded = ref(false) // 是否成功加载过（用于区分「空数据」和「还没加载」）
const expandedKeys = ref([]) // 已展开全文的卡片 key

let controller = null // 用于组件卸载 / 重复请求时中断上一次 fetch

// 类型 -> 展示信息（颜色由 CSS 里的 .type-xxx 控制）
const TYPE_META = {
  schedule: { label: '日程', icon: '📅' },
  knowledge: { label: '知识', icon: '📘' }
}

function metaOf(type) {
  return TYPE_META[type] || { label: '未分类', icon: '📄' }
}

function typeClass(type) {
  return TYPE_META[type] ? `type-${type}` : 'type-other'
}

// 2026-11-02 15:00:00 -> 2026-11-02 15:00（只展示到分钟，卡片更紧凑）
function formatDate(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace('T', ' ').slice(0, 16)
}

// 后端字段归一化：任何字段缺失/类型不对都不能让渲染崩掉
function normalize(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const type = String(raw.type || 'knowledge').toLowerCase()
  const title = String(raw.title || raw.filename || '未命名条目')
  return {
    key: raw.filename || `${type}-${index}-${title}`,
    type,
    title,
    date: formatDate(raw.date),
    source: String(raw.source || ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [],
    content: String(raw.content || '')
  }
}

function isExpanded(key) {
  return expandedKeys.value.includes(key)
}

function toggleExpand(key) {
  expandedKeys.value = isExpanded(key)
    ? expandedKeys.value.filter((item) => item !== key)
    : [...expandedKeys.value, key]
}

async function loadKnowledge() {
  if (loading.value) return

  loading.value = true
  error.value = ''

  // 中断上一次未完成的请求，避免快速连点产生竞态
  controller?.abort()
  controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store' // 本地数据，永远要最新的
    })

    if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`)

    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('接口返回的数据格式不是数组')

    // 后端已按日期倒序，这里再兜一次，防止接口改动导致顺序错乱
    items.value = data
      .map(normalize)
      .filter(Boolean)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))

    hasLoaded.value = true
  } catch (err) {
    // 关键：所有异常都在这里接住，组件只显示提示，绝不向上抛导致页面白屏
    if (err?.name === 'AbortError') {
      error.value = '请求超时，本地服务可能未启动，或 8000 端口被占用'
    } else if (err instanceof TypeError) {
      // 本地服务没启动时，fetch 抛的就是 TypeError（对应 ERR_CONNECTION_REFUSED）
      error.value = '无法连接到本地服务，请确保电脑端启动了 api_server.py'
    } else {
      error.value = `加载失败：${err?.message || err}`
    }
    console.warn('[知识库] 加载失败：', err)
  } finally {
    clearTimeout(timer)
    loading.value = false
  }
}

onMounted(loadKnowledge)

// 组件被卸载（用户关闭插件）时中断请求，避免回调打到已销毁的组件上
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="knowledge-view">
    <!-- 独立路由页面：给一个明确的返回入口 -->
    <div class="kv-pagebar">
      <RouterLink to="/" class="kv-back">← 返回日程</RouterLink>
      <span class="kv-page-name">知识栏目</span>
    </div>

    <header class="kv-head">
      <div class="kv-title">
        <h2>我的知识库</h2>
        <span class="kv-sub">{{ loading ? '同步中…' : `共 ${items.length} 条` }}</span>
      </div>
      <button class="kv-refresh" :disabled="loading" @click="loadKnowledge">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <!-- 完全连不上：给出可执行的排查步骤，而不是空白页 -->
    <div v-if="error && !items.length" class="kv-state kv-error" role="alert">
      <div class="kv-state-icon">🔌</div>
      <p class="kv-state-title">{{ error }}</p>
      <ul class="kv-tips">
        <li>在项目目录运行：<code>.\venv\Scripts\python.exe api_server.py</code></li>
        <li>看到 <code>Uvicorn running on http://127.0.0.1:8000</code> 即启动成功</li>
        <li>浏览器访问<a :href="API_URL" target="_blank" rel="noreferrer">接口地址</a>，能返回 JSON 就说明正常</li>
      </ul>
      <button class="kv-retry" @click="loadKnowledge">重新连接</button>
    </div>

    <template v-else>
      <!-- 已有数据时刷新失败：只在顶部提示，不清空列表 -->
      <div v-if="error" class="kv-banner">
        <span>{{ error }}</span>
        <button @click="loadKnowledge">重试</button>
      </div>

      <!-- 首次加载骨架屏 -->
      <div v-if="loading && !hasLoaded" class="kv-grid">
        <div v-for="n in 6" :key="n" class="kv-card skeleton">
          <div class="sk-line w60"></div>
          <div class="sk-line w90"></div>
          <div class="sk-line w80"></div>
          <div class="sk-line w60"></div>
        </div>
      </div>

      <!-- 空数据 -->
      <div v-else-if="!items.length" class="kv-state">
        <div class="kv-state-icon">🗂️</div>
        <p class="kv-state-title">还没有任何知识条目</p>
        <p class="kv-state-desc">
          在微信里给「文件传输助手」发一条消息，采集脚本会自动生成 Markdown，刷新即可看到。
        </p>
      </div>

      <!-- 卡片列表 -->
      <div v-else class="kv-grid">
        <article
          v-for="item in items"
          :key="item.key"
          class="kv-card"
          :class="typeClass(item.type)"
        >
          <div class="kv-card-top">
            <span class="kv-badge">{{ metaOf(item.type).icon }} {{ metaOf(item.type).label }}</span>
            <time v-if="item.date" class="kv-date">{{ item.date }}</time>
          </div>

          <h3 class="kv-card-title">{{ item.title }}</h3>

          <p class="kv-card-content" :class="{ expanded: isExpanded(item.key) }">
            {{ item.content }}
          </p>
          <button
            v-if="item.content.length > 80"
            class="kv-more"
            type="button"
            @click="toggleExpand(item.key)"
          >
            {{ isExpanded(item.key) ? '收起' : '展开全文' }}
          </button>

          <footer class="kv-card-foot">
            <span class="kv-source">来源：{{ item.source || '未知' }}</span>
            <span v-if="item.tags.length" class="kv-tags">
              <span v-for="tag in item.tags.slice(0, 4)" :key="tag" class="kv-tag">#{{ tag }}</span>
            </span>
          </footer>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.knowledge-view {
  min-height: 100vh;
  padding: 20px 24px 40px;
  background: #f9fafb;
  box-sizing: border-box;
  font-family: -apple-system, "PingFang SC", sans-serif;
}

/* ---------- 独立页面的返回条 ---------- */
.kv-pagebar {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 1200px;
  margin: 0 auto 16px;
}
.kv-back {
  display: inline-flex;
  align-items: center;
  padding: 7px 14px;
  font-size: 13px;
  color: #57606a;
  background: #fff;
  border: 1px solid #eceef1;
  border-radius: 9px;
  text-decoration: none;
  transition: all 0.2s ease;
}
.kv-back:hover {
  color: #1677ff;
  background: #f2f7ff;
  border-color: #b3d4ff;
}
.kv-page-name {
  font-size: 13px;
  color: #8f959e;
}

/* ---------- 顶部 ---------- */
.kv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  max-width: 1200px;
  margin: 0 auto 14px;
}
.kv-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.kv-title h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  color: #1f2328;
}
.kv-sub {
  font-size: 12px;
  color: #9aa4af;
  white-space: nowrap;
}
.kv-refresh {
  flex-shrink: 0;
  padding: 7px 14px;
  font-size: 12.5px;
  color: #1677ff;
  background: #fff;
  border: 1px solid #d6e6ff;
  border-radius: 9px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}
.kv-refresh:hover:not(:disabled) {
  background: #f2f7ff;
  border-color: #b3d4ff;
}
.kv-refresh:disabled {
  color: #b6bcc4;
  border-color: #eceef1;
  cursor: not-allowed;
}

/* ---------- 网格：窄屏自动一列 ---------- */
.kv-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  max-width: 1200px;
  margin: 0 auto;
}

/* ---------- 卡片 ---------- */
.kv-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 14px 12px;
  background: #fbfcfd;
  border: 1px solid #eceef1;
  border-left: 4px solid var(--accent, #8b949e);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
  box-sizing: border-box;
  min-width: 0;
}
.kv-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.07);
  border-color: #e3e7ec;
}

/* 两种类型用不同主色：日程=蓝，知识=绿 */
.kv-card.type-schedule {
  --accent: #1677ff;
  --accent-soft: #e8f2ff;
}
.kv-card.type-knowledge {
  --accent: #12a150;
  --accent-soft: #e9f8ef;
}
.kv-card.type-other {
  --accent: #8b949e;
  --accent-soft: #f2f4f7;
}

.kv-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.kv-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  white-space: nowrap;
}
.kv-date {
  font-size: 11px;
  color: #9aa4af;
  white-space: nowrap;
}
.kv-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.45;
  color: #1f2328;
  word-break: break-word;
}
.kv-card-content {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: #57606a;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kv-card-content.expanded {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}
.kv-more {
  align-self: flex-start;
  padding: 0;
  font-size: 12px;
  color: #1677ff;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
}
.kv-more:hover {
  text-decoration: underline;
}
.kv-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed #eceef1;
  font-size: 11px;
  color: #9aa4af;
}
.kv-source {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kv-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kv-tag {
  color: #8f959e;
}

/* ---------- 状态区 ---------- */
.kv-state {
  margin: 24px auto;
  max-width: 460px;
  padding: 24px 20px;
  text-align: center;
  background: #fbfcfd;
  border: 1px solid #eceef1;
  border-radius: 14px;
  box-sizing: border-box;
}
.kv-error {
  background: #fffafa;
  border-color: #ffe0dc;
}
.kv-state-icon {
  font-size: 28px;
  line-height: 1.2;
}
.kv-state-title {
  margin: 10px 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2328;
  word-break: break-word;
}
.kv-state-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: #8f959e;
}
.kv-tips {
  margin: 12px 0 0;
  padding-left: 18px;
  text-align: left;
  font-size: 12px;
  line-height: 1.9;
  color: #6b7684;
}
.kv-tips code {
  padding: 1px 5px;
  font-size: 11.5px;
  background: #f2f4f7;
  border-radius: 5px;
  word-break: break-all;
}
.kv-tips a {
  color: #1677ff;
}
.kv-retry {
  margin-top: 14px;
  padding: 8px 18px;
  font-size: 13px;
  color: #fff;
  background: #1677ff;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.25);
  font-family: inherit;
}
.kv-retry:hover {
  background: #0f5fd6;
}
.kv-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  max-width: 1200px;
  margin: 0 auto 12px;
  padding: 9px 12px;
  font-size: 12px;
  color: #d4380d;
  background: #fff7f0;
  border: 1px solid #ffd8bf;
  border-radius: 9px;
}
.kv-banner button {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 12px;
  color: #d4380d;
  background: #fff;
  border: 1px solid #ffbb96;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
}

/* ---------- 骨架屏 ---------- */
.kv-card.skeleton {
  border-left-color: #eceef1;
  gap: 10px;
}
.sk-line {
  height: 10px;
  border-radius: 6px;
  background: linear-gradient(90deg, #f0f2f5 25%, #f7f8fa 37%, #f0f2f5 63%);
  background-size: 400% 100%;
  animation: kv-shimmer 1.3s ease infinite;
}
.w60 { width: 60%; }
.w80 { width: 80%; }
.w90 { width: 90%; }
@keyframes kv-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

/* ---------- 响应式 ---------- */
@media (max-width: 640px) {
  .knowledge-view {
    padding: 14px 12px 28px;
  }
  .kv-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .kv-state {
    margin: 12px 0;
  }
  .kv-head {
    margin-bottom: 10px;
  }
  .kv-banner {
    margin: 0 0 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sk-line { animation: none; }
  .kv-card { transition: none; }
}
</style>
