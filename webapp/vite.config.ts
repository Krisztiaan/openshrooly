import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { mockApiPlugin } from './mock/mock-server'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const enableMockApi = command === 'serve'

  return {
    base: '/app/',
    plugins: [svelte(), tailwindcss(), ...(enableMockApi ? [mockApiPlugin()] : [])],
    build: {
      manifest: true,
    },
  }
})
