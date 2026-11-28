import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectSnapshot, readSnapshot } from '../snapshots/index.js';
export const actions = ['collect', 'read', 'export'];
export const usage = 'Usage: drogasil snapshot collect [query...] [--limit 20] | read <run-id> [--offset 0 --limit 20] | export <run-id> --format json|csv|xlsx';
export const options = { limit: { type: 'string' }, offset: { type: 'string' }, format: { type: 'string' } };
export async function run([action, ...args], opts, collect = collectSnapshot) {
  if (!actions.includes(action)) { console.error(usage); return 1; }
  const limit = Number(opts.limit ?? 20), offset = Number(opts.offset ?? 0);
  if (action === 'collect') {
    const result = await collect(args.length ? args : undefined, { maxItems: limit });
    console.log(JSON.stringify(result)); return result.state === 'failed' ? 2 : 0;
  }
  if (args.length !== 1 || !['read','export'].includes(action)) { console.error(usage); return 1; }
  const data = await readSnapshot(args[0], { limit: action === 'export' ? 1000 : limit, offset: action === 'export' ? 0 : offset });
  if (action === 'read') { console.log(JSON.stringify(data)); return 0; }
  if (data.state !== 'succeeded') { console.error('Cannot export an incomplete run. Use read to inspect partial rows.'); return 2; }
  if (!opts.format || opts.format === 'json') { console.log(JSON.stringify(data.records)); return 0; }
  if (!['csv','xlsx'].includes(opts.format)) { console.error(usage); return 1; }
  const result = spawnSync('python3', [fileURLToPath(new URL('../snapshots/export.py', import.meta.url)), opts.format],
    { input: JSON.stringify(data.records), stdio: ['pipe','inherit','inherit'] });
  if (result.error) throw result.error;
  return result.status ?? 2;
}
