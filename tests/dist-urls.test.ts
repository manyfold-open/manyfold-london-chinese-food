/**
 * Built scripts and stylesheets must not hold root paths. Under app.manyfold.ai/london-chinese-food
 * a script that asks for "/assets/chunk.js" reaches another site's root, so a lazy page (the
 * map, the console) would fail to load there while working at the root. vite.config.ts writes
 * those URLs relative; this test reads the build `npm run check` made and fails on any left.
 * Without a build (a bare `npm test`) it has nothing to read and is skipped.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ASSETS = new URL('../dist/client/assets/', import.meta.url);
const built = existsSync(ASSETS);

describe('built URLs', () => {
  it.skipIf(!built)('are relative inside every script and stylesheet', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(ASSETS)) {
      if (!/\.(js|css)$/.test(name)) continue;
      const text = readFileSync(new URL(name, ASSETS), 'utf8');
      if (/["'(]\/assets\//.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
