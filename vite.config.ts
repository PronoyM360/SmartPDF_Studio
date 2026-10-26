import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/tesseract.js')) {
            return 'tesseract'
          }
          if (id.includes('node_modules/pdfjs-dist')) {
            return 'pdfjs'
          }
          if (id.includes('node_modules/pdf-lib')) {
            return 'pdf-lib'
          }
        },
      },
    },
  },
})
