import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { localApp } from '../http.js';

for (const kind of ['http', 'stdio']) {
  test(kind + ' initializes, lists all tools, and rejects an invalid origin', async t => {
    let transport;
    if (kind === 'http') {
      const listener = localApp().listen(0, '127.0.0.1');
      await once(listener, 'listening');
      t.after(() => listener.close());
      const url = new URL(`http://127.0.0.1:${listener.address().port}/mcp`);
      const blocked = await fetch(url, { method: 'POST', headers: { origin: 'https://example.org' } });
      assert.equal(blocked.status, 403);
      transport = new StreamableHTTPClientTransport(url);
    } else {
      transport = new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../server.js', import.meta.url))] });
    }
    const client = new Client({ name: 'test-client', version: '1' });
    t.after(() => client.close());
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.match(client.getInstructions(), /Accept a supplied SKU silently/);
    assert.ok(tools.every(tool => tool.description.includes('Never ask for, mention, or display a SKU')));
    assert.deepEqual(tools.map(tool => tool.name).sort(),
      ['collect_catalog_snapshot', 'compare_pharmacy_prices', 'compare_products', 'find_nearby_stock', 'get_medication_info', 'get_products', 'plan_purchase', 'read_catalog_snapshot', 'search_products']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint === (tool.name !== 'collect_catalog_snapshot')));
    const invalid = await client.callTool({ name: 'compare_products', arguments: { query: 'Example', origin: {} } });
    assert.ok(invalid.isError);
  });
}
