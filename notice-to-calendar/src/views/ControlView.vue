<script setup>
/**
 * 本地知识库控制台
 *
 * 把「微信采集器 / 托盘 / 本地 API / 知识库前端」放到一个应用式页面里：
 *   - 状态：托盘、API、前端、当前聊天、队列、倒计时、自检
 *   - 操作：立即扫描、暂停/恢复、状态面板、日志、目录、知识库
 *
 * 后端：api_server.py 的 /api/status、/api/control、/api/open/*
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

const status = ref({})
const error = ref('')
const loading = ref(false)
const busy = ref('')

let timer = null
let controller = null

const trayOnline = computed(() => Boolean(status.value.tray_online))
const apiOnline = computed(() => Boolean(status.value.api_online))
const frontendOnline = computed(() => Boolean(status.value.frontend_online))
const paused = computed(() => Boolean(status.value.paused))
const gameMode = computed(() => Boolean(status.value.game_mode))
const autoPause = computed(() => String(status.value.auto_pause_reason || ''))
const selfCheckError = computed(() => String(status.value.self_check_error || ''))
const chatName = computed(() => String(status.value.current_chat || '未识别'))
const queueDepth = computed(() => Number(status.value.queue_depth || 0))
const todayArchived = computed(() => Number(status.value.today_archived || 0))
const recentFiles = computed(() => Array.isArray(status.value.recent_files) ? status.value.recent_files : [])

const overall = computed(() => {
  if (!apiOnline.value) return { text: 'API 未连接', tone: 'off' }
  if (gameMode.value) return { text: '全屏应用，自动化挂起', tone: 'warn' }
  if (autoPause.value) return { text: '自动暂停', tone: 'warn' }
  if (paused.value) return { text: '已暂停', tone: 'warn' }
  if (trayOnline.value) return { text: '采集器运行中', tone: 'on' }
  return { text: '托盘未运行', tone: 'off' }
})

const pauseLabel = computed(() => paused.value ? '恢复监听' : '暂停监听')

function remain(epoch) {
  const value = Number(epoch || 0)
  if (!value) return '--'
  return `${Math.max(0, Math.round(value - Date.now() / 1000))}s`
}

const scanCountdown = computed(() => {
  if (!trayOnline.value || paused.value) return '暂停'
  return remain(status.value.next_scan_epoch)
})
const messageCountdown = computed(() => {
  if (!trayOnline.value || paused.value) return '暂停'
  return remain(status.value.next_message_epoch)
})
const aggregateCountdown = computed(() => remain(status.value.aggregate_due_epoch))

const strategyText = computed(() => {
  if (gameMode.value) return `全屏/游戏：${status.value.game_reason || '已挂起'}`
  if (autoPause.value) return autoPause.value
  if (paused.value) return '手动暂停'
  return '正常自动运行'
})

async function request(path, options = {}) {
  controller?.abort()
  controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || `HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timerId)
  }
}

async function loadStatus() {
  if (loading.value) return
  loading.value = true
  try {
    status.value = await request('/api/status')
    error.value = ''
  } catch (err) {
    if (err?.name === 'AbortError') {
      error.value = '连接本地 API 超时，请确认 api_server.py 已启动'
    } else if (err instanceof TypeError) {
      error.value = '无法连接本地 API（127.0.0.1:8000），请先启动 api_server.py'
    } else {
      error.value = `读取状态失败：${err?.message || err}`
    }
  } finally {
    loading.value = false
  }
}

async function control(command) {
  if (busy.value) return
  busy.value = command
  try {
    await request('/api/control', {
      method: 'POST',
      body: JSON.stringify({ command })
    })
    await loadStatus()
  } catch (err) {
    error.value = `操作失败：${err?.message || err}`
  } finally {
    busy.value = ''
  }
}

async function openTarget(target) {
  if (busy.value) return
  busy.value = target
  try {
    await request(`/api/open/${target}`, { method: 'POST' })
  } catch (err) {
    error.value = `打开失败：${err?.message || err}`
  } finally {
    busy.value = ''
  }
}

function openStandalone() {
  window.open(window.location.href, '_blank', 'width=1180,height=820,noopener')
}

onMounted(() => {
  loadStatus()
  timer = setInterval(loadStatus, 2000)
})

onBeforeUnmount(() => {
  controller?.abort()
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="console-page">
    <div class="pagebar">
      <RouterLink to="/" class="back-link">← 返回日程</RouterLink>
      <span class="page-name">知识库控制台</span>
      <button class="standalone" type="button" @click="openStandalone">🪟 独立窗口</button>
    </div>

    <div v-if="error" class="banner" role="alert">
      <span>⚠️ {{ error }}</span>
      <button type="button" @click="loadStatus">重试</button>
    </div>

    <!-- 顶部状态卡 -->
    <header class="hero" :class="overall.tone">
      <div class="hero-left">
        <div class="pulse" :class="overall.tone"></div>
        <div>
          <p class="eyebrow">微信本地知识库</p>
          <h1>{{ overall.text }}</h1>
          <p class="hero-sub">
            当前聊天：<b>{{ chatName }}</b>
            <span class="dot-sep">·</span>
            自动策略：{{ strategyText }}
          </p>
        </div>
      </div>
      <div class="hero-right">
        <button class="primary" type="button" :disabled="Boolean(busy)" @click="control('scan')">
          {{ busy === 'scan' ? '扫描中…' : '立即扫描' }}
        </button>
        <button class="ghost" type="button" :disabled="Boolean(busy)" @click="control('toggle_pause')">
          {{ pauseLabel }}
        </button>
      </div>
    </header>

    <!-- 运行状态胶囊 -->
    <div class="pills">
      <span class="pill" :class="trayOnline ? 'ok' : 'bad'">● 托盘 {{ trayOnline ? '在线' : '离线' }}</span>
      <span class="pill" :class="apiOnline ? 'ok' : 'bad'">● API {{ apiOnline ? '在线' : '离线' }}</span>
      <span class="pill" :class="frontendOnline ? 'ok' : 'muted'">● 前端 {{ frontendOnline ? '运行中' : '未检测到' }}</span>
      <span class="pill" :class="paused ? 'warn' : 'ok'">● {{ paused ? '已暂停' : '监听中' }}</span>
      <span v-if="gameMode" class="pill warn">● 全屏免打扰</span>
      <span v-if="autoPause" class="pill warn">● {{ autoPause }}</span>
    </div>

    <!-- 指标 -->
    <div class="metrics">
      <article class="metric">
        <span class="metric-icon blue">📥</span>
        <div><p>队列深度</p><strong>{{ queueDepth }}</strong><small>条待处理</small></div>
      </article>
      <article class="metric">
        <span class="metric-icon green">📚</span>
        <div><p>今日归档</p><strong>{{ todayArchived }}</strong><small>个 Markdown</small></div>
      </article>
      <article class="metric">
        <span class="metric-icon orange">⏱️</span>
        <div><p>下次记录扫描</p><strong>{{ scanCountdown }}</strong><small>空闲时执行</small></div>
      </article>
      <article class="metric">
        <span class="metric-icon purple">💬</span>
        <div><p>下次消息轮询</p><strong>{{ messageCountdown }}</strong><small>15 秒一次</small></div>
      </article>
    </div>

    <!-- 操作宫格 -->
    <h2 class="section-title">快捷操作</h2>
    <div class="actions">
      <article class="action-card">
        <span class="action-icon blue">🔍</span>
        <h3>立即扫描</h3>
        <p>忽略空闲、夜间和游戏限制，处理当前「锦」会话的可见记录。</p>
        <button type="button" :disabled="Boolean(busy)" @click="control('scan')">开始扫描</button>
      </article>
      <article class="action-card">
        <span class="action-icon orange">⏸️</span>
        <h3>{{ pauseLabel }}</h3>
        <p>暂停自动扫描和 Ctrl+Alt+K；手动扫描仍然可用。</p>
        <button type="button" :disabled="Boolean(busy)" @click="control('toggle_pause')">切换状态</button>
      </article>
      <article class="action-card">
        <span class="action-icon purple">🧭</span>
        <h3>状态面板</h3>
        <p>打开 Tkinter 原生状态窗口，查看队列、倒计时和自检。</p>
        <button type="button" :disabled="Boolean(busy)" @click="control('open_panel')">打开面板</button>
      </article>
      <article class="action-card">
        <span class="action-icon gray">📄</span>
        <h3>查看日志</h3>
        <p>直接打开 tray_app.log，排查扫描、热键或 API 问题。</p>
        <button type="button" :disabled="Boolean(busy)" @click="openTarget('log')">打开日志</button>
      </article>
      <article class="action-card">
        <span class="action-icon green">📁</span>
        <h3>知识库目录</h3>
        <p>打开 D:\KnowledgeBase，查看 Markdown、图片和 manifest。</p>
        <button type="button" :disabled="Boolean(busy)" @click="openTarget('folder')">打开目录</button>
      </article>
      <article class="action-card">
        <span class="action-icon blue">📖</span>
        <h3>浏览知识库</h3>
        <p>进入知识栏目，按日程/知识分类查看已归档内容。</p>
        <RouterLink to="/knowledge" class="action-link">进入知识库 →</RouterLink>
      </article>
    </div>

    <!-- 详情 -->
    <div class="details">
      <article class="panel">
        <h2>运行详情</h2>
        <dl>
          <div><dt>托盘心跳</dt><dd>{{ status.updated_at || '暂无' }}</dd></div>
          <div><dt>上次记录扫描</dt><dd>{{ status.last_scan_at || '尚未扫描' }}</dd></div>
          <div><dt>上次消息扫描</dt><dd>{{ status.last_message_scan_at || '尚未扫描' }}</dd></div>
          <div><dt>消息聚合</dt><dd>{{ aggregateCountdown === '--' ? '无缓冲' : `${aggregateCountdown} 后提交` }}</dd></div>
          <div><dt>微信 UI 自检</dt><dd :class="{ danger: selfCheckError }">{{ selfCheckError || (status.self_check_ok ? '正常' : '检查中') }}</dd></div>
          <div><dt>热键</dt><dd>{{ status.hotkeys || '未注册' }}</dd></div>
          <div><dt>最近错误</dt><dd :class="{ danger: status.last_error }">{{ status.last_error || '无' }}</dd></div>
        </dl>
      </article>

      <article class="panel">
        <h2>最近归档</h2>
        <ul v-if="recentFiles.length" class="recent">
          <li v-for="file in recentFiles" :key="file">
            <span>📝</span><span class="file-name">{{ file }}</span>
          </li>
        </ul>
        <p v-else class="empty">还没有归档记录。</p>
      </article>
    </div>

    <footer class="console-foot">
      <span>本地只读 · 不发送消息 · 数据只写 D:\KnowledgeBase</span>
      <span>最后刷新：{{ status.server_time || '—' }}</span>
    </footer>
  </section>
</template>

<style scoped>
.console-page {
  min-height: 100vh;
  padding: 20px 24px 40px;
  background: #f5f7fb;
  color: #1f2328;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  box-sizing: border-box;
}
.pagebar { display: flex; align-items: center; gap: 10px; max-width: 1180px; margin: 0 auto 16px; }
.back-link { padding: 7px 14px; font-size: 13px; color: #57606a; background: #fff; border: 1px solid #e6eaf0; border-radius: 9px; text-decoration: none; }
.back-link:hover { color: #1677ff; background: #f2f7ff; }
.page-name { font-size: 13px; color: #8f959e; }
.standalone { margin-left: auto; padding: 7px 12px; font-size: 12px; color: #57606a; background: #fff; border: 1px solid #e6eaf0; border-radius: 9px; cursor: pointer; }
.standalone:hover { color: #1677ff; border-color: #b3d4ff; }
.banner { display: flex; justify-content: space-between; align-items: center; max-width: 1180px; margin: 0 auto 12px; padding: 10px 14px; font-size: 13px; color: #b42318; background: #fff5f4; border: 1px solid #ffd6d2; border-radius: 11px; }
.banner button { padding: 4px 12px; color: #b42318; background: #fff; border: 1px solid #ffc9c4; border-radius: 7px; cursor: pointer; }

.hero { display: flex; justify-content: space-between; gap: 20px; max-width: 1180px; margin: 0 auto 14px; padding: 24px 26px; background: #fff; border: 1px solid #e9edf3; border-left: 6px solid #1677ff; border-radius: 18px; box-shadow: 0 10px 30px rgba(15, 35, 70, 0.06); }
.hero.warn { border-left-color: #d97706; }
.hero.off { border-left-color: #9ca3af; }
.hero-left { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
.pulse { width: 14px; height: 14px; margin-top: 6px; border-radius: 50%; background: #12a150; box-shadow: 0 0 0 6px rgba(18, 161, 80, 0.12); flex-shrink: 0; }
.pulse.warn { background: #d97706; box-shadow: 0 0 0 6px rgba(217, 119, 6, 0.14); }
.pulse.off { background: #9ca3af; box-shadow: 0 0 0 6px rgba(156, 163, 175, 0.16); }
.eyebrow { margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8f959e; }
.hero h1 { margin: 0 0 8px; font-size: 26px; font-weight: 750; letter-spacing: -0.02em; }
.hero-sub { margin: 0; font-size: 13px; color: #6b7684; }
.dot-sep { margin: 0 8px; color: #c4cad2; }
.hero-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.primary, .ghost { padding: 10px 18px; font-size: 13px; border-radius: 10px; cursor: pointer; font-family: inherit; }
.primary { color: #fff; background: #1677ff; border: 1px solid #1677ff; box-shadow: 0 4px 14px rgba(22, 119, 255, 0.25); }
.primary:hover:not(:disabled) { background: #0f5fd6; }
.ghost { color: #374151; background: #fff; border: 1px solid #dfe4ea; }
.ghost:hover:not(:disabled) { background: #f7f9fc; }
.primary:disabled, .ghost:disabled { opacity: 0.55; cursor: not-allowed; }

.pills { display: flex; flex-wrap: wrap; gap: 8px; max-width: 1180px; margin: 0 auto 16px; }
.pill { padding: 6px 11px; font-size: 12px; color: #57606a; background: #fff; border: 1px solid #e6eaf0; border-radius: 999px; }
.pill.ok { color: #0f7b3f; background: #eefaf2; border-color: #c9efd7; }
.pill.bad { color: #b42318; background: #fff5f4; border-color: #ffd6d2; }
.pill.warn { color: #9a5b00; background: #fff8e8; border-color: #ffe2ad; }
.pill.muted { color: #8f959e; }

.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; max-width: 1180px; margin: 0 auto 22px; }
.metric { display: flex; gap: 12px; align-items: center; padding: 14px 16px; background: #fff; border: 1px solid #e9edf3; border-radius: 14px; min-width: 0; }
.metric-icon { display: grid; place-items: center; width: 42px; height: 42px; font-size: 20px; border-radius: 12px; flex-shrink: 0; }
.metric-icon.blue, .action-icon.blue { background: #e8f2ff; }
.metric-icon.green, .action-icon.green { background: #e9f8ef; }
.metric-icon.orange, .action-icon.orange { background: #fff4e5; }
.metric-icon.purple, .action-icon.purple { background: #f2edff; }
.metric-icon.gray, .action-icon.gray { background: #f3f4f6; }
.metric p { margin: 0 0 3px; font-size: 11.5px; color: #8f959e; }
.metric strong { display: block; font-size: 21px; font-weight: 750; line-height: 1.1; }
.metric small { font-size: 11px; color: #9aa4af; }

.section-title { max-width: 1180px; margin: 0 auto 10px; font-size: 16px; font-weight: 700; }
.actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; max-width: 1180px; margin: 0 auto 22px; }
.action-card { display: flex; flex-direction: column; gap: 7px; padding: 16px; background: #fff; border: 1px solid #e9edf3; border-radius: 15px; transition: transform 0.18s ease, box-shadow 0.18s ease; min-width: 0; }
.action-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15, 35, 70, 0.07); }
.action-icon { display: grid; place-items: center; width: 44px; height: 44px; font-size: 21px; border-radius: 13px; }
.action-card h3 { margin: 3px 0 0; font-size: 14.5px; font-weight: 700; }
.action-card p { margin: 0; min-height: 38px; font-size: 12px; line-height: 1.6; color: #7a8492; }
.action-card button, .action-link { align-self: flex-start; margin-top: 2px; padding: 6px 12px; font-size: 12px; color: #1677ff; background: #f2f7ff; border: 1px solid #d6e6ff; border-radius: 8px; cursor: pointer; text-decoration: none; font-family: inherit; }
.action-card button:hover:not(:disabled), .action-link:hover { background: #e8f2ff; border-color: #b3d4ff; }
.action-card button:disabled { opacity: 0.55; cursor: not-allowed; }

.details { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 12px; max-width: 1180px; margin: 0 auto 20px; }
.panel { padding: 18px; background: #fff; border: 1px solid #e9edf3; border-radius: 15px; min-width: 0; }
.panel h2 { margin: 0 0 12px; font-size: 14px; font-weight: 700; }
.panel dl { margin: 0; display: flex; flex-direction: column; gap: 9px; }
.panel dl div { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 8px; border-bottom: 1px dashed #eef1f5; font-size: 12.5px; }
.panel dl div:last-child { border-bottom: none; padding-bottom: 0; }
.panel dt { color: #8f959e; flex-shrink: 0; }
.panel dd { margin: 0; color: #374151; text-align: right; word-break: break-word; }
.panel dd.danger { color: #b42318; font-weight: 600; }
.recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.recent li { display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: #57606a; min-width: 0; }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { margin: 0; font-size: 12.5px; color: #9aa4af; }
.console-foot { display: flex; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; padding-top: 12px; border-top: 1px solid #e9edf3; font-size: 11.5px; color: #9aa4af; }

@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .details { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .console-page { padding: 14px 12px 28px; }
  .hero { flex-direction: column; padding: 18px; }
  .hero-right { width: 100%; }
  .hero-right button { flex: 1; }
  .metrics, .actions { grid-template-columns: 1fr; }
  .console-foot { flex-direction: column; }
}
</style>
