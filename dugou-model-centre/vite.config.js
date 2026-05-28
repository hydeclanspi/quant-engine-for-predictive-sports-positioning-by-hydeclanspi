import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@styles': path.resolve(__dirname, './src/styles'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        // 把体积大、加载时机各异的第三方库切成独立 chunk：
        //   - xlsx 仅在导入/导出时用到，单独成块可让首屏不必下载；
        //   - recharts + d3 是图表层，体积可观；
        //   - react 全家桶变动频率低，独立后浏览器缓存命中率更高。
        // 其余依赖归入通用 vendor 块。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('xlsx')) return 'vendor-xlsx'
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
            return 'vendor-charts'
          }
          // 仅打包"无外部依赖"的 React 核心，使该 chunk 不反向依赖
          // 通用 vendor 块（react-router → @remix-run/router 会引入环路，
          // 故让 router 留在 vendor 中，依赖方向保持单向）。
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react'
          }
          if (id.includes('@supabase')) return 'vendor-supabase'
          return 'vendor'
        },
      },
    },
  },
})
