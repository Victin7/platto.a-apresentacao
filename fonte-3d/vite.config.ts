import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
})
