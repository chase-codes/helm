import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __FEEDBACK_ENDPOINT__: JSON.stringify(process.env.HELM_FEEDBACK_ENDPOINT ?? ''),
      __FEEDBACK_CLIENT__: JSON.stringify(process.env.HELM_FEEDBACK_CLIENT ?? ''),
    },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    build: {
      rollupOptions: {
        input: {
          operator: resolve(__dirname, 'src/renderer/operator/index.html'),
          output: resolve(__dirname, 'src/renderer/output/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
