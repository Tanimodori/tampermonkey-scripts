/// <reference types="node" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every tag the suite uses has to be declared here: an undeclared one is an error rather than a
    // silently ignored typo.
    tags: [
      {
        name: 'api',
        description: 'Talks to the real Tencent Docs document; runs under test:api.',
        // A real round trip is about a second, and a case makes a handful of calls, so the 5 s
        // default is too tight.
        timeout: 60_000,
      },
    ],
  },
});
