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
  process.stdout.write = (s) => (out.push(String(s)), true);
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
  assert.equal(plain.sent[0].variables.p[0].quantity, 1);
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
    ],
  );
  assert.equal(r.code, 0);
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
