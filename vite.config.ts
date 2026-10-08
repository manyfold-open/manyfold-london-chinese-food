import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  experimental: {
    // The site is served under app.manyfold.ai/london-chinese-food as well as at the root of
    // its workers.dev host. URLs inside scripts and stylesheets (lazy chunks such as the map
    // and the console, preload lists, the font) are written relative to the file that holds
    // them, so they resolve under either. The HTML keeps root paths: the Worker prefixes those
    // when the page is served under the mount (src/worker/mount.ts). tests/dist-urls.test.ts
    // fails on a root path left inside a built script.
    renderBuiltUrl: (_filename, { hostType }) => (hostType === 'js' || hostType === 'css' ? { relative: true } : undefined),
  },
});
