// Run with a personal MCP URL and a test CEP supplied by the caller.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [endpoint, zipcode] = process.argv.slice(2);
if (!endpoint || !/^\d{5}-?\d{3}$/.test(zipcode ?? '')) {
  throw new Error('Usage: node mcp/scripts/verify-presentation.mjs <MCP URL> <test CEP>');
}
const client = new Client({ name: 'presentation-check', version: '1' });
const token = process.env.DROGASIL_TEST_TOKEN;
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: token ? { headers: { authorization: 'Bearer ' + token } } : undefined,
}));
try {
  for (const query of ['Patz GTS', 'Patz GTS em gotas, frasco de 20 mL']) {
    const response = await client.callTool({ name: 'plan_purchase', arguments: {
      origin: { zipcode }, items: [{ query, brand: 'Patz GTS', includeGenerics: false }],
    } });
    assert.ok(!response.isError);
    const { tables, coverage } = response.structuredContent;
    assert.deepEqual(tables[0].requestedBrandSkus, ['913628']);
    assert.ok(coverage.checkedStores > 0 && tables[0].failed.length === 0);
    console.log(query, 'SKU 913628;', coverage.checkedStores, 'branches checked');
  }
} finally {
  await client.close();
}
