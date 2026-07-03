import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
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
