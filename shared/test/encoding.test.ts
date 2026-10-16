import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

// The production build (vite) refuses a source file that isn't UTF-8, though the typecheck and
// the tests run it fine: a Windows-encoded dash broke two deploys. Every source file must decode.
it('every source file is valid UTF-8', () => {
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|mts|css|html|json)$/.test(name)) {
        try {
          decoder.decode(readFileSync(path));
        } catch {
          bad.push(path);
        }
      }
    }
  };
  for (const part of ['shared', 'server', 'client', 'tools']) walk(join(root, part));
  assert.deepEqual(bad, []);
});
