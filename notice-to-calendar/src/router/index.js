import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    // 主页面懒加载：首屏只加载路由表，点进来才下载页面代码
    component: () => import('../views/HomeView.vue')
  },
  {
    path: '/knowledge',
    name: 'Knowledge',
    // 知识栏目：路由级懒加载。
    // 用户不访问 /knowledge，就绝不会下载这份 JS，也不会触发组件内的 fetch。
    component: () => import('../components/knowledge/KnowledgeView.vue')
  },
  {
    path: '/console',
    name: 'Control',
    // 本地知识库控制台：状态 + 扫描/暂停/日志/目录
    component: () => import('../views/ControlView.vue')
  },
  {
    // 兜底：未知路径回首页
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  // history 模式：地址栏是干净的 /knowledge；开发由 Vite 兜底，
  // 线上 PWA 已有 navigateFallback=/index.html，刷新深链不会 404
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

export default router
