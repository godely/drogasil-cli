import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const name = process.argv[2], cli = process.argv[3];
if (!name || !cli) throw Error('Usage: node cli.mjs NAME EXECUTABLE [--strict | --print]');
const contract = JSON.parse(await readFile(new URL('./drogasil.json', import.meta.url)));
function run(args, fixture = 'missing') {
  const res = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('./no-network.mjs', import.meta.url)), cli, ...args], {
    env: { ...process.env, PARITY_FIXTURE: fixture }, encoding: 'utf8', timeout: 10000,
  });
  if (res.error || res.signal) throw res.error ?? Error('Interrupted by ' + res.signal);
  return res;
}
const gaps = [];
for (const [cmd, spec] of Object.entries(contract.commands)) {
  const help = run([cmd, '--help']);
  assert.equal(help.status, 0, cmd + ' help');
  // Older partner CLIs put every command on one line separated by pipes.
  const commandNames = [...Object.keys(contract.commands), 'suggest', 'gtin'].join('|');
  const sections = help.stdout.split(new RegExp('\\s+\\|\\s+(?=(?:' + commandNames + ')\\s)'));
  const section = sections.find(s => new RegExp('^(?:Usage: )?(?:' + name + ' )?' + cmd + '(?:\\s|$)', 'm').test(s));
  if (!section) { gaps.push(cmd); continue; }
  for (const flag of Object.keys(spec.flags)) {
    if (flag === 'help') continue;
    if (!new RegExp('--' + flag + '(?![\\w-])').test(section)) gaps.push(cmd + ' --' + flag);
  }
  for (const action of spec.actions ?? []) {
    if (!new RegExp('\\b' + action + '\\b').test(section)) gaps.push(cmd + ' ' + action);
  }
}
for (const [label, args, expected, fixture] of [
  ['empty invocation', [], 1], ['unknown command', ['not-a-command'], 1],
  ['invalid option', ['search', 'example', '--not-an-option'], 1],
  ['invalid page', ['search', 'example', '--page', '0'], 1],
  ['missing location', ['stock', '1'], 1], ['missing SKU', ['product', '999999999', '--json'], 3],
  ['upstream failure', ['product', '1', '--json'], 2, 'failure'],
]) {
  if (run(args, fixture).status !== expected) gaps.push('exit: ' + label);
}
if (process.argv.includes('--candidate') || process.argv.includes('--strict')) {
  for (const limit of ['1','51','100','1000']) {
    // The second page avoids first-page spelling suggestions. The source is empty.
    const args=['search','1234567','--page','2','--limit',limit];
    for(const suffix of [[],['--json']]) {
      const page=run([...args,...suffix]);
      if(page.status!==0) gaps.push('search: completed empty page, limit '+limit+(suffix.length?' JSON':' terminal'));
      else if(suffix.length) {
        const value=JSON.parse(page.stdout);
        assert.deepEqual(Array.isArray(value)?value:value.hits,[]);
      }
    }
  }
}
const batch = run(['product', '101', '999999999', '202', '101', '--json']);
const slots = JSON.parse(batch.stdout || 'null');
// Partner slots contain offers, while Drogasil returns a single catalog record.
const identities = Array.isArray(slots) && slots.map(slot => {
  if (slot === null) return null;
  const records = Array.isArray(slot) ? slot : [slot];
  return records.map(record => String(record?.sku));
});
if (batch.status !== 3 || JSON.stringify(identities) !== JSON.stringify([['101'], null, ['202'], ['101']])) {
  gaps.push('product: ordered batch slots');
}
gaps.sort();
if (process.argv.includes('--print')) console.log(JSON.stringify(gaps, null, 2));
else {
  const released = process.argv.includes('--candidate');
  const known = JSON.parse(await readFile(new URL(released ? './candidate-gaps.json' : './gaps.json', import.meta.url)));
  console.log(name + ': ' + gaps.length + ' open checks\n' + gaps.join('\n'));
  const allowed=process.argv.includes('--strict') ? [] : known[name];
  const regressions=gaps.filter(gap=>!allowed.includes(gap) && !allowed.includes(gap.split(' --')[0]));
  assert.deepEqual(regressions, [], 'Untracked CLI parity regression');
}
