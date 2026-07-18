import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/fund-assistant/',
  server: {
    proxy: {
      // 基金 F10 持仓明细（fundf10.eastmoney.com）：无 CORS、无 JSONP callback，
      // 且强制校验 Referer 必须为 *.eastmoney.com（浏览器 JS 无法伪造跨域 Referer）。
      // 故仅能经服务端代理转发并注入 eastmoney Referer；生产（纯静态）无此代理，调用方降级。
      // 注：fundgz / pingzhongdata / fundsuggest 均不校验 Referer，已用 <script> JSONP 直取，无需代理。
      '/fundf10': {
        target: 'https://fundf10.eastmoney.com',
        changeOrigin: true,
        headers: { Referer: 'https://fundf10.eastmoney.com/' },
        rewrite: (path) => path.replace(/^\/fundf10/, ''),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 3600 },
            },
          },
        ],
      },
      manifest: {
        name: '基金投资助手',
        short_name: '基投助手',
        description: '跨平台基金持仓管理与投资决策辅助工具',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/fund-assistant/',
        icons: [
          {
            src: '/fund-assistant/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/fund-assistant/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/fund-assistant/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
