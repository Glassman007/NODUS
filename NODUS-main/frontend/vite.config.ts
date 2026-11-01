import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Override for machines where FastAPI runs on 8001 or another local port.
const backendTarget = process.env.NODUS_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': backendTarget } },
})
