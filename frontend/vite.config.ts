/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tailwind v4 is a Vite plugin: there is no tailwind.config.js and no content
// globs. Configuration that used to live in that file now lives in CSS.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The suite covers the pure layers -- game rules, graph questions, request
    // building, formatting -- none of which touch the DOM. Leaving the
    // environment as node keeps the tests fast and keeps a jsdom dependency out
    // of the project until something actually renders in one.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
