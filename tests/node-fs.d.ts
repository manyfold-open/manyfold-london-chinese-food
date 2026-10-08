// The slice of node:fs the tests use (see node-sqlite.d.ts for why).
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function existsSync(path: URL): boolean;
  export function readdirSync(path: URL): string[];
}
