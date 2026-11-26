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

With `--cep` or both `--lat` and `--lon`, `compare` shows only products in stock at nearby participating branches. Products are ordered by catalog reference price, with stores nearest first under each product. JSON adds a `stores` array to each available product.

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

## Not yet implemented

- The outward walk over the store directory for scarce products. `src/geo.js` has the
  haversine it needs and `listStores()` provides the map.
- Caching of the store directory and the non-participating branch set.

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
and `compare_products`. Location is either `{"zipcode":"01001-000"}` or a pair
of numeric `latitude` and `longitude` fields. Optional client skills are in `skills/`.
Run transport tests with `npm test --prefix mcp`.
