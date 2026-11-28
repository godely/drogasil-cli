import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const name = process.argv[2], cli = process.argv[3];
if (!name || !cli) throw Error('Usage: node cli.mjs NAME EXECUTABLE [--strict | --candidate] [--print]');
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
const strict = process.argv.slice(4).some(flag => flag === '--strict' || flag === '--candidate');
if (strict) {
  const optionCases = [
    [['compare', '1', '--store', 'nearest'], /--store.*nearest.*(?:location|origin)/i],
    [['compare', '1', '--expand'], /--expand.*(?:location|origin)/i],
    [['plan', '1', '--lat', '1', '--lon', '1', '--store', 'nearest', '--expand'], /--expand.*(?:across stores|--store)/i],
    [['compare', '1', '--lat', '1', '--lon', '1', '--store', 'arbitrary'], /--store.*nearest/i],
    [['stock', '1', '--lat', '1', '--lon', '1', '--max-branches', '3'], /--max-branches.*cep/i],
    [['stock', '1', '--cep', '01001000', '--all', '--min-qty', '1'], /--all.*(?:--min-qty|minimum quantity)/i],
    [['stock', '1', '--cep', '01001000', '--max-branches', '31'], /--max-branches.*\b3\b.*\b30\b/i],
  ];
  for (const [args, expectedError] of optionCases) {
    if (run(args).status !== 1) gaps.push('expected usage exit: ' + args.join(' '));
    const result = run([...args, '--json']);
    let message;
    try {
      message = JSON.parse(result.stdout)?.error;
    } catch {
      // Empty stdout and terminal text are both invalid JSON responses.
    }
    if (result.status !== 1 || typeof message !== 'string' || !expectedError.test(message)) {
      gaps.push('expected JSON option error: ' + args.join(' '));
    }
  }
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
const batch = run(['product', '999999999','999999998','999999999','--json']);
if (batch.status !== 3 || JSON.stringify(JSON.parse(batch.stdout || 'null')) !== '[null,null,null]') gaps.push('product: ordered missing slots');
gaps.sort();
if (process.argv.includes('--print')) console.log(JSON.stringify(gaps, null, 2));
else {
  console.log(name + ': ' + gaps.length + ' open checks\n' + gaps.join('\n'));
  assert.deepEqual(gaps, [], 'CLI parity regression');
}
