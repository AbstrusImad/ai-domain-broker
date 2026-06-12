import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: works on Vercel AND under a GitHub Pages subpath.
  base: './',
})
