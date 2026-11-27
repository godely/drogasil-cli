import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DROGASIL_MIN_INTERVAL_MS = '0';
const { main } = await import('../src/cli.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** Run the CLI with a scripted fetch; returns exit code, stdout, stderr and the request bodies sent. */
async function run(argv, responses = []) {
  const sent = [];
  const queue = [...responses];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next), { status: 200 });
  };

  const out = [];
  const err = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  // Node 20's test runner also sends binary protocol frames over stdout.
  process.stdout.write = function (chunk, ...args) {
    if (typeof chunk !== 'string') return stdoutWrite.call(this, chunk, ...args);
    out.push(chunk);
    return true;
  };
  process.stderr.write = (s) => (err.push(String(s)), true);
  try {
    const code = await main(argv);
    return { code, stdout: out.join(''), stderr: err.join(''), sent };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

const notFound = (message) => ({
  errors: [{ message, extensions: { exception: { status: 404, message }, code: 'INTERNAL_SERVER_ERROR' } }],
  data: null,
});

test('no arguments is a usage error on stderr', async () => {
  const r = await run([]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^drogasil - read-only CLI/);
  assert.equal(r.stdout, '');
});

test('unknown options are reported as usage errors, not crashes', async () => {
  const r = await run(['search', 'dimorf', '--bogus']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--bogus/);
  assert.equal(r.sent.length, 0);
});

test('search: --page is one-based for the user and zero-based for Algolia', async () => {
  const r = await run(
    ['search', 'dimorf', '--page', '2', '--limit', '1'],
    [{ results: [{ hits: [{ sku: 1, name: 'A', price: 1 }], nbHits: 5, page: 1, nbPages: 5 }] }],
  );
  assert.equal(r.code, 0);
  assert.equal(r.sent[0].requests[0].page, 1);
  assert.equal(r.sent[0].requests[0].hitsPerPage, '1');
  assert.match(r.stdout, /page 2 of 5 \(5 hits\)/);
});

test('search: non-numeric --limit and --page are rejected before any request', async () => {
  assert.equal((await run(['search', 'x', '--limit', 'abc'])).code, 1);
  assert.equal((await run(['search', 'x', '--page', '0'])).code, 1);
  assert.equal((await run(['search', 'x', '--limit', '5000'])).code, 1);
});

test('stock: conflicting flags are usage errors', async () => {
  const cases = [
    ['stock', '1', '--lat', '-8', '--lon', '-34', '--cep', '01001000'],
    ['stock', '1', '--cep', '01001000', '--all', '--min-qty', '2'],
    ['stock', '1', '--lat', '-8', '--lon', '-34', '--max-branches', '5'],
    ['stock', '1', '--lat', '-8'],
    ['stock', '1', '--cep', '01001000', '--min-qty', '0'],
    ['stock', '1', '--cep', '01001000', '--max-branches', '31'],
  ];
  for (const argv of cases) {
    const r = await run(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(r.sent.length, 0, argv.join(' '));
  }
});

test('stock: blank coordinates are rejected instead of becoming 0,0', async () => {
  const r = await run(['stock', '1', '--lat=', '--lon=']).catch((e) => ({ thrown: e }));
  assert.match(String(r.thrown?.message), /invalid latitude/);
});

test('stock: "sem estoque" for a known SKU is exit 3, and --json still prints the rows', async () => {
  const stockNone = notFound('Filial próxima sem estoque');
  const known = { results: [{ sku: 110166, objectID: '110166' }] };

  const plain = await run(['stock', '110166', '--lat', '-23.55', '--lon', '-46.63'], [stockNone, known]);
  assert.equal(plain.code, 3);
  assert.match(plain.stdout, /No nearby store has this product in stock/);
  assert.equal(plain.sent[0].variables.p[0].quantity, undefined);
  assert.equal(plain.sent[0].variables.logo, 'DROGASIL');

  const json = await run(['stock', '110166', '--lat', '-23.55', '--lon', '-46.63', '--json'], [stockNone, known]);
  assert.equal(json.code, 3);
  assert.equal(json.stdout, '[]\n');
  assert.match(json.stderr, /No nearby store/);
});

test('stock: an unknown SKU is told apart from no stock', async () => {
  const r = await run(
    ['stock', '999999999', '--cep', '01001-000'],
    [notFound('Filial próxima sem estoque'), { results: [null] }],
  );
  assert.equal(r.code, 3);
  assert.match(r.stdout, /Unknown SKU 999999999/);
  assert.equal(r.sent[0].variables.z, '01001000');
});

test('stock: --all omits the quantity filter and renders zero-stock rows', async () => {
  const r = await run(
    ['stock', '110166', '--lat', '-23.55', '--lon', '-46.63', '--all'],
    [
      {
        data: {
          getNearbyStockByLatLong: [
            {
              branch: {
                id: 1,
                businessName: 'X',
                distanceKMFromSearch: 0.105,
                address: { addressLocal: 'R A', addressNumber: '1', district: 'D', city: 'C', sgState: 'PE' },
                branchService: { hourOpenNormaly: '07:00:00', hourEndNormaly: '22:00:00', isOpen: true },
              },
              stocks: [{ sku: 110166, quantity: 0 }],
            },
          ],
        },
      },
      { results: [{ sku: 110166 }] },
    ],
  );
  assert.equal(r.code, 0);
  assert.match(r.stdout, /única filial/);
  assert.match(r.stderr, /--expand/);
  assert.equal('quantity' in r.sent[0].variables.p[0], false);
  assert.match(r.stdout, /0\.105 km\s+X\s+0\s+07:00-22:00\s+open\s+R A, 1 - D, C - PE/);
});

test('cep is not a public command', async () => {
  const result = await run(['cep', '01001000'], []);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown command "cep"/);
});

test('product: a missing SKU is exit 3 in both output modes', async () => {
  const plain = await run(['product', '1', '2'], [{ results: [{ sku: 1, name: 'A', price: 2.5 }, null] }]);
  assert.equal(plain.code, 3);
  assert.match(plain.stdout, /not found/);
  assert.match(plain.stdout, /R\$ 2,50/);

  const json = await run(['product', '1', '2', '--json'], [{ results: [{ sku: 1 }, null] }]);
  assert.equal(json.code, 3);
  assert.deepEqual(JSON.parse(json.stdout), [{ sku: 1 }, null]);
});

test('network failures exit 2, not 1', async () => {
  const r = await run(['stock', '1', '--cep', '01001000'], [new TypeError('fetch failed', { cause: new Error('ENOTFOUND') })]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /ENOTFOUND/);
});

test('GraphQL errors other than not-found exit 2', async () => {
  const r = await run(['stock', '1', '--cep', '01001000'], [{ errors: [{ message: 'Parâmetro inválido', extensions: {} }], data: null }]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Parâmetro inválido/);
});

test('compare resolves the plain brand, rejects presentation differences and sorts by price', async () => {
  const base = {
    sku: 1, brand: 'Frontal', name: 'Frontal Alprazolam 2mg', price: 100,
    filters: { 'Forma farmacêutica': 'Comprimidos' },
    details: { quantidade: '30 Comprimidos', dosageList: ['2MG'], activeIngredients: [
      { description: 'Alprazolam', dosageValue: 2, unitOfMeasurement: { name: 'MG' } },
    ] },
  };
  const xr = { ...base, sku: 2, brand: 'Frontal XR', name: 'Frontal XR Alprazolam 2mg' };
  const generic = { ...base, sku: 3, name: 'Alprazolam Genérico', price: 20 };
  const page = hits => ({ results: [{ hits, nbPages: 1 }] });
  const result = await run(['compare', 'Frontal', '2mg', '--json'], [
    page([xr, base]), page([base, xr, generic,
      { ...generic, sku: 4, details: { ...base.details, quantidade: '60 Comprimidos' } },
      { ...generic, sku: 5, filters: {} },
      { ...generic, sku: 6, details: { ...base.details, activeIngredients: [] } },
    ]),
  ]);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout).map(p => p.sku), [3, 1]);
});

test('location-aware comparison handles partial stock, empty stock and outages', async () => {
  const base = {
    sku: 1, name: 'Example', price: 20, filters: { 'Forma farmacêutica': 'Comprimidos' },
    details: { quantidade: '30 Comprimidos', activeIngredients: [
      { description: 'Example', dosageValue: 1, unitOfMeasurement: { name: 'mg' } },
    ] },
  };
  const catalog = [{ results: [base] }, { results: [{ hits: [{ ...base, sku: 2, price: 10 }] }] }];
  const args = ['compare', '1', '--cep', '01001-000', '--json'];
  const empty = notFound('Filial próxima sem estoque');
  const rows = { data: { getNearbyStockByZipCode: [
    { branch: { id: 101, distanceKMFromSearch: 0.2 }, stocks: [{ sku: 1, quantity: 2 }] },
  ] } };
  const partial = await run(args, [...catalog, empty, rows]);
  assert.equal(partial.code, 0);
  assert.deepEqual(JSON.parse(partial.stdout).map(p => [p.sku, p.stores[0].quantity]), [[1, 2]]);
  const absent = await run(args, [...catalog, empty, empty]);
  assert.equal(absent.code, 3);
  assert.deepEqual(JSON.parse(absent.stdout), []);
  const outage = await run(args, [...catalog, empty, new Error('offline')]);
  assert.equal(outage.code, 2);
  assert.equal(outage.stdout, '');
  const ambiguous = await run(['compare', 'Example', '--json'], [
    { results: [{ hits: [base, { ...base, sku: 3, details: { ...base.details, quantidade: '60 Comprimidos' } }] }] },
  ]);
  assert.equal(ambiguous.code, 3);
  assert.match(ambiguous.stderr, /Presentation unclear/);
});

test('drops, concentration, pack volume and bottle counts constrain long brand queries', async () => {
  const base = { sku: 913628, brand: 'Patz', name: 'PATZ GTS Zolpidem 10mg/ml Solução Gotas 20ml',
    price: 80, filters: { 'Forma farmacêutica': 'Solução' }, details: { quantidade: '20ml',
      activeIngredients: [{ description: 'Zolpidem', dosageValue: 10, unitOfMeasurement: { name: 'MG' } }] } };
  const page = { results: [{ hits: [base], nbPages: 1 }] };
  for (const query of ['Patz GTS', 'Patz GTS em gotas, frasco de 20 mL', 'Patz GTS 10 mg/mL 20 mL']) {
    const r = await run(['compare', query, '--json'], [page, page]);
    assert.equal(r.code, 0, query);
    assert.deepEqual(JSON.parse(r.stdout).map(p => p.sku), [913628]);
  }
  for (const query of ['Patz GTS em gotas, frasco de 30 mL', 'Patz GTS comprimidos',
    'Patz GTS 20 mg/mL', 'Patz GTS 2 frascos de 20 ml', 'Patz GTS XR']) {
    const r = await run(['compare', query, '--json'], [page]);
    assert.equal(r.code, 3, query);
  }
});

test('explicit release selects the documented presentation and preserves dose and count', async () => {
  const base = { sku: 88262, name: 'Frontal Alprazolam 2mg 30 comprimidos', brand: 'Frontal', price: 154,
    filters: { 'Forma farmacêutica': 'Comprimidos' }, details: { quantidade: '30 Comprimidos',
      activeIngredients: [{ description: 'Alprazolam', dosageValue: 2, unitOfMeasurement: { name: 'MG' } }] } };
  const extended = { ...base, sku: 28619, name: 'Frontal XR Alprazolam 2mg 30 comprimidos', brand: 'Frontal XR',
    filters: { 'Forma farmacêutica': 'Comprimido de liberação prolongada' } };
  const unknown = { ...base, sku: 9, name: 'Exemplo 2mg 30 comprimidos', brand: 'Exemplo' };
  const page = { results: [{ hits: [extended, base, unknown], nbPages: 1 }] };
  for (const [query, expected] of [
    ['Frontal 2 mg 30 comprimidos de liberação imediata', 88262],
    ['Frontal 2 mg de liberação prolongada, com 30 comprimidos', 28619],
    ['Frontal 2 mg 60 comprimidos de liberação imediata', null],
    ['Frontal 3 mg de liberação imediata', null],
    ['Exemplo 2 mg de liberação imediata', null],
    ['Frontal XR 2 mg de liberação imediata', null],
  ]) {
    const r = await run(['compare', query, '--json'], [page, page]);
    assert.equal(r.code, expected ? 0 : 3, query);
    const skus = JSON.parse(r.stdout || '[]').map(p => p.sku);
    if (expected) {
      assert.ok(skus.includes(expected), query);
      assert.ok(!skus.includes(expected === 88262 ? 28619 : 88262), query);
    } else assert.deepEqual(skus, [], query);
  }
});
