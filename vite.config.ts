import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/fund-assistant/',
  server: {
    proxy: {
      // 开发模式下代理基金 F10 持仓明细 HTML（fundf10.eastmoney.com 无 CORS，且无 JSONP callback）。
      // 注：fundgz / pingzhongdata 已统一用 <script> JSONP 加载，跨域不受 CORS 限制，无需代理。
      '/fundf10': {
        target: 'https://fundf10.eastmoney.com',
        changeOrigin: true,
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
