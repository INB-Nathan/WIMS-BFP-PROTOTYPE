import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15000,
    alias: {
      '@': path.resolve(__dirname, './src'),
      'firebase/app': path.resolve(__dirname, './src/test/__mocks__/firebase-app.ts'),
      'firebase/messaging': path.resolve(__dirname, './src/test/__mocks__/firebase-app.ts'),
    }
  }
})
