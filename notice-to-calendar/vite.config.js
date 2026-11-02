import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  // 读取 .env 文件中的密钥
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate', // 新版本发布后自动更新 SW，用户无需手动清缓存
        injectRegister: false, // 改为在 main.js 手动注册，便于监听 controllerchange
        includeAssets: [],
        manifest: {
          name: '通知随手记',
          short_name: '通知随手记',
          description: '把校园通知粘进来，自动变成日历日程',
          lang: 'zh-CN',
          theme_color: '#1677ff',
          background_color: '#f9fafb',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          // 预缓存构建产物，首次访问后断网也能打开完整 UI
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          sourcemap: false,
          runtimeCaching: [
            {
              // 静态资源：先给缓存，后台静默更新
              urlPattern: ({ request }) =>
                ['style', 'script', 'font', 'worker'].includes(request.destination),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-resources',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 }
              }
            },
            {
              // 图片：缓存优先
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }
              }
            },
            {
              // 同源 GET 请求（含未来的接口读操作）：网络优先，3s 超时后回落缓存
              urlPattern: ({ request, url }) =>
                request.method === 'GET' && url.origin === self.location.origin,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'same-origin-get',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 }
              }
            }
          ]
        },
        devOptions: {
          enabled: false // 开发环境不启 SW，避免 HMR 被缓存干扰
        }
      })
    ],
    server: {
      proxy: {
        // 拦截 /api/deepseek 请求（本地开发时代替 Pages Function）
        '/api/deepseek': {
          target: 'https://api.deepseek.com', // 实际转发给 DeepSeek
          changeOrigin: true,
          // 线上由 functions/api/deepseek.js 补上 /chat/completions，本地这里补
          rewrite: () => '/chat/completions',
          configure: (proxy, options) => {
            // 在服务端偷偷加上 API Key
            proxy.on('proxyReq', (proxyReq, req, res) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`)
            })
          }
        }
      }
    }
  }
})
