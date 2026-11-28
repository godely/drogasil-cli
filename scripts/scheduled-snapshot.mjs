import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {collectSnapshot, readSnapshot} from '../src/snapshots/index.js';

// A delivery retry reads the original successful run and reuses its idempotency key.
export async function scheduledSnapshot(args, env = process.env,
  {collect = collectSnapshot, read = readSnapshot, deliver = fetch} = {}) {
  const {values, positionals} = parseArgs({args, options:{'run-id':{type:'string'}}, allowPositionals:true});
  const savedId = values['run-id'];
  const url = env.DROGASIL_WEBHOOK_URL ? new URL(env.DROGASIL_WEBHOOK_URL) : null;
  if (url && url.protocol !== 'https:') throw new Error('Use an HTTPS webhook URL');
  if (savedId !== undefined && (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(savedId) || positionals.length || !url))
    throw new Error('Use --run-id with a saved run ID, a configured webhook and no search terms');

  let id = savedId;
  if (!id) {
    const result = await collect(positionals.length ? positionals : undefined, {maxItems:Number(env.DROGASIL_MAX_ITEMS ?? 20)});
    if (result.state !== 'succeeded') throw new Error('Incomplete snapshot ' + result.runId);
    id = result.runId;
  }
  if (url) {
    const dataset = await read(id, {limit:1000});
    if (dataset.state !== 'succeeded' || dataset.nextOffset != null || dataset.records.length !== dataset.count)
      throw new Error('Incomplete snapshot ' + id);
    let response;
    try {
      response = await deliver(url, {method:'POST', headers:{'content-type':'application/json','idempotency-key':id},
        body:JSON.stringify(dataset), redirect:'error', signal:AbortSignal.timeout(30000)});
    } catch {
      throw new Error('Webhook delivery unconfirmed for run ' + id + '. Retry with --run-id ' + id);
    }
    if (!response.ok) throw new Error('Webhook delivery failed (HTTP ' + response.status + '). Retry with --run-id ' + id);
  }
  return id;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { console.log(await scheduledSnapshot(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
