import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_DEV_BACKEND_ORIGIN || 'http://localhost:8081'
  const wsBackend = backend.replace(/^http/, 'ws')

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      proxy: {
        // Match the production nginx contract: client always talks to
        // /api, /ws, /upload, /static. In dev, Vite proxies to the
        // backend origin (default localhost:8081). In production, nginx
        // does the same in nginx.conf.
        '/api': {
          target: backend,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
        '/ws': {
          target: wsBackend,
          ws: true,
          changeOrigin: true,
        },
        '/upload': {
          target: backend,
          changeOrigin: true,
        },
        '/static': {
          target: backend,
          changeOrigin: true,
        },
      },
    },
  }
})
