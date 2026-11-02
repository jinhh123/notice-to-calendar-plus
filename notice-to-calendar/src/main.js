import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

createApp(App).use(router).mount('#app')

// Service Worker：新版本接管（controllerchange）时自动刷新，
// 否则用户会一直看到旧缓存里的 CSS/JS，直到手动关掉应用。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // 首次安装时 clientsClaim 也会触发 controllerchange，那次不应该刷新
  const hadController = Boolean(navigator.serviceWorker.controller)
  let refreshing = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return
    refreshing = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker 注册失败:', err)
    })
  })
}
