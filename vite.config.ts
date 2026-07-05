import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/fund-assistant/',
  server: {
    proxy: {
      // 开发模式下代理基金实时估算 API（fundgz.1234567.com.cn 无 CORS）
      '/fundgz': {
        target: 'https://fundgz.1234567.com.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fundgz/, ''),
      },
      // 开发模式下代理基金数据 JS（pingzhongdata 无 CORS）
      '/pingzhongdata': {
        target: 'https://fund.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pingzhongdata/, ''),
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
