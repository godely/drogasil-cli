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
    if (flag === 'help' || flag === 'json') continue;
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
const batch = run(['product', '999999999','999999998','999999999','--json']);
if (batch.status !== 3 || JSON.stringify(JSON.parse(batch.stdout || 'null')) !== '[null,null,null]') gaps.push('product: ordered missing slots');
gaps.sort();
if (process.argv.includes('--print')) console.log(JSON.stringify(gaps, null, 2));
else {
  const known = JSON.parse(await readFile(new URL('./gaps.json', import.meta.url)));
  console.log(name + ': ' + gaps.length + ' open checks\n' + gaps.join('\n'));
  assert.deepEqual(gaps, process.argv.includes('--strict') ? [] : known[name], 'Declared and observed parity gaps differ.');
}
