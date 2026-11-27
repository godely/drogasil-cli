import { collectSnapshot, readSnapshot } from '../src/snapshots/index.js';

// Invoke from cron or a systemd timer. The operator owns the destination.
const result = await collectSnapshot(process.argv.slice(2), { maxItems: Number(process.env.DROGASIL_MAX_ITEMS ?? 20) });
if (result.state !== 'succeeded') throw new Error('Incomplete snapshot ' + result.runId);
if (process.env.DROGASIL_WEBHOOK_URL) {
  const url = new URL(process.env.DROGASIL_WEBHOOK_URL);
  if (url.protocol !== 'https:') throw new Error('Use an HTTPS webhook URL');
  const dataset = await readSnapshot(result.runId, { limit: 1000 });
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
    'idempotency-key': result.runId }, body: JSON.stringify(dataset), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Webhook delivery failed for run ' + result.runId + ' (HTTP ' + response.status + ')');
}
console.log(result.runId);
