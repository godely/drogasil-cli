# drogasil-cli

Read-only command line client for drogasil.com.br's public APIs. No login, no
build step, no dependencies: plain ESM on Node 20+.

An independent project maintained by godely. Catalog prices are reference prices and branch availability can change.

## Install

```bash
npm install
npm link      # optional: puts `drogasil` on your PATH
```

Or run in place with `node ./bin/drogasil.js …`.

## Commands

| Command | Backend | What it does |
|---|---|---|
| `drogasil compare <name and strength or SKU>` | Algolia | Match catalog presentations and sort by reference price |
| `drogasil info "<medication or SKU>" [--brazil]` | Medication catalog, Brazilian sources on request | Ingredients, presentations and prescription requirements |
| `drogasil plan "<item A>" "<item B>" --cep CEP` | Catalog, stock and directory | Compare nearest stocked options, stops, round-trip distances and basket totals |
| `drogasil search <query>` | Algolia | Name to SKU, with brand and reference price. `--page` starts at 1 |
| `drogasil product <sku>…` | Algolia | Direct SKU lookup |
| `drogasil stock <sku> --lat --lon` | GraphQL `getNearbyStockByLatLong` | Nearby stores with stock, nearest first |
| `drogasil stock <sku> --cep <cep>` | GraphQL `getNearbyStockByZipCode` | Same, from a postal code |
| `drogasil stores` | GraphQL `stores` | Full store directory with coordinates |

Every command accepts `--json` for the raw API shape and `--help` for its own usage.

```bash
drogasil compare "Frontal 2mg"
drogasil compare "Frontal 2mg" --cep 01001-000
drogasil search dimorf
drogasil product 53472 59568
drogasil stock 110166 --lat -23.5500 --lon -46.630
drogasil stock 53472 --cep 01001-000 --min-qty 2
drogasil stock 110166 --lat -23.5500 --lon -46.630 --all --json
```

With a location, the human-readable comparison shows each option at its nearest stocked branch, cheapest first. Pass `--store nearest` to check the physically closest participating branch, including zeros. The existing `compare --json` output retains the full branch arrays.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage error: bad or conflicting flags, invalid CEP or coordinates |
| 2 | Network failure or timeout, HTTP error, or an API error other than "not found" |
| 3 | Valid request, nothing found (unknown SKU, no stock nearby) |

The codes are the same with `--json`. In that mode stdout still carries the raw
payload (`[]`, `null`, or an array with `null` slots) and the explanation goes
to stderr, so `--json` output stays machine-readable.

## Layout

```
bin/drogasil.js       entry point
src/cli.js            command dispatch and shared flags
src/api/http.js       fetch wrapper: User-Agent, timeout, rate limit
src/api/algolia.js    search and SKU lookup
src/api/graphql.js    stock, store directory, CEP
src/api/index.js      public API surface (importable as a library)
src/commands/*.js     one file per command: { usage, options, run }
src/format.js         table and field formatting
src/geo.js            haversine and coordinate parsing
test/                 node --test
```

Adding a command: create `src/commands/<name>.js` exporting `usage`, `options`
(a `parseArgs` options object) and `run(positionals, values)`, then register it
in the `COMMANDS` map in `src/cli.js`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DROGASIL_MIN_INTERVAL_MS` | `250` | Minimum gap between requests, also enforced across concurrent library calls |
| `DROGASIL_TIMEOUT_MS` | `15000` | Per-request timeout |
| `DROGASIL_USER_AGENT` | `curl/8.7.1 drogasil-cli/<version>` | Must start with a client token Akamai recognises. The version comes from `package.json` |
| `DROGASIL_ALGOLIA_KEY` | public key | Override if the site rotates it |
| `DROGASIL_ALGOLIA_APP` | `A7RGTHYMDQ` | Algolia application id |

## Nearby search and the 25 km option

With a CEP, `stock --max-branches N` sets the initial number of participating branches to check (3–30, default 30). The coordinate endpoint chooses its own window. Its reach in kilometres depends on local store density. Drogasil also accepts `products: [{ sku, quantity: 1 }]` for a stock-only lookup. A filtered lookup can return a stocked branch farther away than the last branch in an unfiltered lookup with the same cap. To report an actual count and reach, the CLI reads the unfiltered branches and checks their quantities locally.

If every requested SKU has an explicit zero at every checked branch, the CLI reports the branch count and distance to the farthest branch and offers to search up to **25 km**. Answer **sim** at the terminal prompt, or repeat the same `stock`, `compare` or `plan` command with `--expand`. A fixed-branch lookup, an unknown quantity or a positive quantity below a requested minimum does not trigger the offer.

The library and MCP return `coverage.checkedStores`, `coverage.radiusKm` and `coverage.canExpand`. After consent, send the same origin, SKUs and preferences with `expandSearch: true`. The wider lookup uses directory coordinates and additional stock windows. It lists up to ten participating branches with enough stock, nearest first. Distances are straight-line estimates from the original location. For a CEP, the search uses the retailer’s distances to nearby branches to bound the distance to each new one. If it cannot verify coverage at the boundary or a stock lookup fails, it reports partial coverage. Branch phone numbers appear when the directory supplies them. Call to confirm availability before travelling.

## Library

Install from GitHub with `npm install github:godely/drogasil-cli`. The equivalent of
`drogasil compare "Frontal 2mg" --cep 01001-000` is:

```js
import { compareProducts } from 'drogasil-cli';

const result = await compareProducts('Frontal 2mg', { origin: { zipcode: '01001-000' } });
if (result.status === 'matches') {
  for (const product of result.products) console.log(product.name, product.price, product.stores);
}
```

Omit the origin for a catalog-only comparison, or pass numeric latitude and longitude.
An ambiguous reference returns candidate products for selection by SKU. Other outcomes
are `no_reference`, `no_prices`, and `no_stock`. Upstream failures reject the promise.

## Personal MCP server

Run `npm ci --prefix mcp` in the checkout. For a stdio client, set the command to
your Node executable and pass the absolute path of `mcp/server.js` as its only argument.
For local Streamable HTTP, run:

```bash
npm run http --prefix mcp
# Optional alternate port
npm run http --prefix mcp -- --port 8788
```

Set a local client's Streamable HTTP URL to `http://127.0.0.1:8787/mcp`.
The listener binds to IPv4 loopback and serves stateless MCP POST requests.
It has no user authentication and is intended for same-machine access.
Cloud clients require a supported private tunnel or an authenticated deployment.

Both transports expose `search_products`, `get_products`, `find_nearby_stock`,
`compare_products`, `get_medication_info`, and `plan_purchase`. Location is either `{"zipcode":"01001-000"}` or a pair
of numeric `latitude` and `longitude` fields. Optional client skills are in `skills/`.
Run transport tests with `npm test --prefix mcp`.

### Medication queries and single-store availability

The MCP search and comparison tools resolve names using the catalog's indexed medication
ingredient and brand facets. The server caches the vocabulary for 24 hours. A curated set
of international names and common misspellings supplements accent-insensitive matching
and conservative phonetic/edit-distance suggestions. Responses expose corrections and
ask for clarification when names are ambiguous. Unrecognized names fall back to catalog
text search. Coverage depends on the retailer's ingredient metadata.

For a broad ingredient comparison without an origin, `presentation_options` separates
different packs, strengths, release types and forms. Select a reference SKU to narrow
the comparison. A conflicting pack can appear under `excluded` with its reason.

Pass `store: "nearest"` or a numeric branch ID as a string together with `origin` to
`compare_products` to report every priced equivalent at one nearby participating
branch. This includes zero quantities. A branch outside the upstream search window
has status `outside_search_window`. One MCP call performs one upstream stock lookup
per equivalent.

When a catalog record lacks a required comparison field, `incomplete_presentation`
returns the direct catalog hits and identifies the missing fields. A location-aware
lookup still checks stock for those SKUs. The result makes no claim about other
equivalents. Retrying the same SKU yields the same catalog limitation.

`find_nearby_stock` reports the closest participating branch in `nearestStore`,
including its zero or unknown quantity. Its default `stores` list contains branches
meeting `minimumQuantity`. Pass `store: "nearest"` to limit the result to one branch.

## Medication information

```sh
drogasil info Rivotril 66758
drogasil info "Frontal XR" --brazil --json
```

```js
import { getMedicationInfo } from 'drogasil-cli';

const { results } = await getMedicationInfo(['Rivotril', '66758']);
```

`get_medication_info` accepts `queries` and an optional `scope` of `catalog` or `brazil`. It needs no location. Catalog rows include source links, strength per ingredient, form, route, release and pack. For prescription questions, `required`, `retained` and `form` are independent. A null field means *não confirmado*. Exact controlled forms carry the reviewed Brazilian rule and verification date. Coverage is partial.

Brazilian results cite patient leaflets when available. For other names, the tool can verify forms in ANVISA's public registration restrictions file on demand. That file omits concentration units and pack identifiers. Its records establish documented forms only. Retailer listings are returned separately.

## Multi-medication shopping

```sh
drogasil plan "Frontal 2 mg" "Tylenol 750 mg 20 comprimidos" --cep "$CEP"
drogasil plan "Frontal 2 mg" "Tylenol 750 mg 20 comprimidos" --cep "$CEP" --include-generics A --brand-only B --quantity B=2
```

```js
import { planPurchase } from 'drogasil-cli';

const items = [{ query: 'Frontal 2 mg', includeGenerics: true }, { query: 'Tylenol 750 mg 20 comprimidos', includeGenerics: false, quantity: 2 }];
const result = await planPurchase(items, { origin: { zipcode: process.env.CEP } });
```

After updating an existing Claude connector, use **Refresh tools list** in its plugin menu and verify that `get_medication_info` and `plan_purchase` appear.

The MCP tool `plan_purchase` takes the same `items`, `origin`, and optional `store: "nearest"` in one call. Each numbered row shows the closest branch reporting enough packs for that line. The planner uses all checked branches for its trips and accounts for stock shared by multiple lines. Each pickup fills one line at one branch. When the whole basket cannot be filled, the planner maximizes the number of complete lines and identifies the remainder.

The fewest-stores plan breaks ties by straight-line round-trip distance and then reference price. The cheapest plan breaks ties by number of stores and then distance. Missing prices yield unknown totals. Store-to-store distances use the directory coordinates. The stock service supplies distances from the origin. Large searches have a bounded computation budget. Check `searchComplete`, `priceIncomplete` and `stockIncomplete` before describing a plan as optimal.

The CLI and MCP ask once about unresolved commercial brands before checking stock. Active ingredients need no generic preference. Pass `includeGenerics: true` for the named brand followed by equivalent generics, or `false` for the named brand alone. A scripted CLI call without a decision returns `needs_generic_preference` and exit code 3. Library callers can enable the same check with `confirmBrands: true`.

In an interactive terminal, choose from the displayed rows with a reply such as `A2, B1`. Press Enter to keep the initial plans. Programmatic clients resolve those IDs against the original response and resend the corresponding `selectedSku` for each chosen item on refresh. Terminal flags also support `--sku A=123`, `--brand A=Frontal`, and `--generic B`.

### Package the personal ChatGPT plugin

Use Python 3.9 or later and the app ID of your own registered connector. The archive references that connector and includes the two skills from this checkout. Choose a new output filename on each build.

```sh
python3 scripts/package-plugin.py --app-id "$DROGASIL_APP_ID" --output /tmp/drogasil-plugin.zip
```

[Comparison with the Apify Drogasil Actor and benchmark method](docs/catalog-comparison.md)

[Bulk catalog snapshots, scheduled delivery and spreadsheet exports](docs/catalog-snapshots.md)

The medication-catalog library entry point shares medication name resolution and evidence checks with sibling retailer adapters. It uses the ingredient and brand index plus normalized denominations from the [July 2026 ANVISA DCB workbook](https://bibliotecadigital.anvisa.gov.br/jspui/bitstream/anvisa/21318/1/2-Lista%20DCB%20consolidada%20jul%202026.xlsx). Regenerate the vocabulary with `python3 scripts/build-dcb-names.py workbook.xlsx src/data/dcb-names.txt`.
