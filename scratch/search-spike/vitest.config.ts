import { defineConfig } from 'vitest/config';

// Spike-local config: root vitest.config.ts restricts `include` to src/**, so the
// harness under scratch/ needs its own include glob. Node env, no react plugin needed.
export default defineConfig({
  test: {
    include: ['scratch/search-spike/**/*.test.ts'],
    environment: 'node',
  },
});
