import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { fetchStorefrontPage, productUrl, parseStorefront } from '../src/api/storefront.js';

test('source discount belongs to the same SKU and selling price; missing stock remains unknown', () => {
  const hit = { sku: 42, url: '/product.html', categories: [] };
  const productData = { sku: '42', name: 'Item', liveComposition: { livePrice: { valueTo: 8 } },
    price_aux: { value_from: 10 }, variant: { products: [{ sku: '10', liveComposition: { livePrice: { valueTo: 8, discountPercentage: 20 } } }] } };
  const render = () => '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { productData } } }) + '</script>';
  const snap = parseStorefront(render(), hit, 'item');
  assert.deepEqual([snap.currentPrice, snap.listPrice, snap.discountPercentage, snap.inStock], [8, 10, null, null]);
  productData.sku = '10';
  assert.throws(() => parseStorefront(render(), hit, 'item'), /SKU/);
  assert.throws(() => productUrl('https://example.org/untrusted.html'));
});

test('curl reads actual HTTP bodies and retry headers from a Node child process', async t => {
  const body = Buffer.from([65, 0xff, 10]);
  const text = 'Oferta válida por unidade.\n'.repeat(100);
  const compressed = gzipSync(text);
  const server = createServer((req, res) => {
    if (req.url === '/compressed' && req.headers['accept-encoding']?.includes('gzip')) {
      res.writeHead(200, {'Content-Encoding':'gzip'});
      res.end(compressed);
    } else if (req.url === '/wait') {
      res.writeHead(429, {'Retry-After':'5', 'Set-Cookie':'fixture=private'});
      res.end('busy');
    } else {
      res.end(body);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const sizes = [];
  const observe = (decoded, transferred) => sizes.push([decoded, transferred]);
  assert.equal(await fetchStorefrontPage(origin, observe), body.toString('utf8'));
  assert.equal(await fetchStorefrontPage(origin + '/compressed', observe), text);
  await assert.rejects(fetchStorefrontPage(origin + '/wait', observe), error => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, '5');
    assert.doesNotMatch(error.message, /fixture|private|busy/);
    return true;
  });
  assert.deepEqual(sizes, [[3,3], [Buffer.byteLength(text),compressed.length], [4,4]]);
});
