import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { COMMANDS, commonOptions } from '../../src/cli.js';
import { registerDrogasilTools } from '../../src/api/mcp-tools.js';

const requireMcp = createRequire(new URL('../../mcp/package.json', import.meta.url));
const { z } = requireMcp('zod');
const contract = { commands: {}, tools: {} };
for (const name of Object.keys(COMMANDS).sort()) {
  const command = await COMMANDS[name]();
  const flags = Object.entries({ ...commonOptions, ...command.options }).sort(([a], [b]) => a.localeCompare(b));
  contract.commands[name] = { flags: Object.fromEntries(flags), ...(command.actions && { actions: command.actions }) };
}
registerDrogasilTools({ registerTool(name, { inputSchema }) {
  contract.tools[name] = z.toJSONSchema(z.object(inputSchema), { io: 'input', target: 'draft-7' });
} }, z, []);
if (process.argv.includes('--print')) {
  console.log(JSON.stringify(contract, null, 2));
} else {
  const expected = JSON.parse(await readFile(new URL('./drogasil.json', import.meta.url), 'utf8'));
  assert.deepEqual(contract, expected, 'Public CLI or MCP contract changed. Update the sibling parity checks and record remaining gaps.');
}
