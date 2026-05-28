import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.min.mjs'],
  },
})
