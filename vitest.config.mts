import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // Node by default. Renderer tests opt into jsdom per file with
    // a `// @vitest-environment jsdom` comment at the top.
    environment: 'node'
  }
})
