import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tailwind v4 is a Vite plugin: there is no tailwind.config.js and no content
// globs. Configuration that used to live in that file now lives in CSS.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
