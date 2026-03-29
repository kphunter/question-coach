import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // VITE_BASE_PATH is set in CI for GitHub project pages (e.g. /question-coach/).
  // Leave unset for user/org pages (served at /) or local dev.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000
  }
})
