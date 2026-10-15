import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// `npm run dev:live` (Vite's mode "live"): the local app shows the live site's public data. Only
// the public reads go there, GET /api/* routes and photos; anything sent (a photo, a report, a
// lead), the admin's and agents' routes, and the upload form's Turnstile key stay with the local
// Worker and its local D1.
const LIVE_SITE = 'https://app.manyfold.ai/london-chinese-food';
const LIVE_READS = /^\/(?:api\/(?:index|places\/[^/]+|dishes(?:\/[^/]+)?|illustrations|sources\/[^/]+|critics\/[^/]+|search)|media\/[pi]\/[^/]+\/[^/]+)$/;

function liveReads(): Plugin {
  return {
    name: 'live-reads',
    apply: 'serve',
    // Added here rather than through server.proxy: the Cloudflare plugin's middleware answers every
    // request it routes to the Worker before Vite's proxy is reached, so this one has to come first.
    configureServer(server) {
      server.config.logger.info(`  Public reads come from ${LIVE_SITE}`);
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !LIVE_READS.test(url.pathname)) return next();
        try {
          const live = await fetch(LIVE_SITE + url.pathname + url.search, {
            method: req.method,
            headers: { accept: req.headers.accept ?? '*/*' },
          });
          // fetch has already decoded the body, so its encoding and length do not go along.
          res.statusCode = live.status;
          for (const name of ['content-type', 'cache-control']) {
            const value = live.headers.get(name);
            if (value) res.setHeader(name, value);
          }
          res.end(Buffer.from(await live.arrayBuffer()));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `could not reach ${LIVE_SITE}: ${(error as Error).message}` }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [...(mode === 'live' ? [liveReads()] : []), react(), cloudflare()],
  experimental: {
    // The site is served under app.manyfold.ai/london-chinese-food as well as at the root of
    // its workers.dev host. URLs inside scripts and stylesheets (lazy chunks such as the map
    // and the console, preload lists, the font) are written relative to the file that holds
    // them, so they resolve under either. The HTML keeps root paths: the Worker prefixes those
    // when the page is served under the mount (src/worker/mount.ts). tests/dist-urls.test.ts
    // fails on a root path left inside a built script.
    renderBuiltUrl: (_filename, { hostType }) => (hostType === 'js' || hostType === 'css' ? { relative: true } : undefined),
  },
}));
