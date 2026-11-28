# Drogasil and the Apify Drogasil Product Prices Scraper

Assessment of the November 2026 snapshot. The Actor collects anonymous storefront offers. The Drogasil plugin resolves medication presentations and retrieves participating branches' reported stock. The two workflows answer different questions.

| Task | Apify Actor | Drogasil plugin at revision 76e373f |
|---|---|---|
| Identify a product | Keyword search, URL, categories, SKU and source query | Names, selected spelling corrections and exact SKU lookup |
| Inspect promotions | Selling price, list price, source discount, currency and timestamp | One BRL catalog reference price |
| Monitor a catalog | Up to ten queries, 1,000 unique products per run, scheduled datasets and spreadsheet exports | One search page per request |
| Compare generics | Returns candidate listings | Checks ingredient, strength, dosage form, release and pack |
| Find enough units nearby | Anonymous storefront stock signal | Branch quantities, fixed nearest branch, nearest stocked branch and optional wider search |
| Plan a basket | No branch assignment | Brand preferences, quantities, fewest stops and estimated lowest total |
| Ask about medication | Some facts appear in titles | Sourced presentations and prescription fields, with partial national coverage |

## Implemented coverage

| Capability | Implementation on main | Verification |
|---|---|---|
| Search and deduplication | Ordered queries, pagination, attribution to the first matching query, 1,000 unique SKUs per run | A synthetic 10-query run included overlapping pages and reached 1,000 unique rows. The authenticated MCP also collected and read a live two-product run. |
| Actor dataset fields | SKU, name, brand, categories and path, product URL, current and list prices, discount, currency, stock signal, in-stock flag, search query, source URL and observation time | Thirty storefront pages produced matching advertised selling prices. Source fields that were missing remained unknown. |
| Persistent results and exports | SQLite run IDs, bounded reads, terminal status and JSON, CSV and XLSX export | Partial-failure tests preserve earlier records. The export check read back a live dataset in each format. |
| Scheduling and integrations | A systemd timer or cron can launch the collector. The HTTPS webhook can deliver results to a workflow receiver. Sheets can import the spreadsheet exports. | A one-shot systemd timer ran on the deployment host. A local HTTPS receiver received the dataset and its idempotency header. Hosted Make, Zapier and Sheets account integrations were outside that test. |
| Additional pharmacy workflows | Compare equivalent presentations, check branch quantities, plan purchases and compare identical packs across chains at a supplied location | The shared-pack pilot confirmed 25 matching presentations at two locations. The earlier pilot checked one shared pack in every state capital and five interior cities. The current Farmácias BR plugin covers Drogasil, Pague Menos and Drogaria São Paulo. |

The original benchmark used the Actor's public schema. A paid run comparing row-by-row results and throughput against the Actor remains unmeasured. The hosted Apify platform also provides its own scheduler and dataset UI. Our deployment exposes the CLI, API and MCP for these workflows.

[Snapshot usage](catalog-snapshots.md) · [Storefront field audit](storefront-audit.md) · [Exact-pack pilot](local-price-pilot.md) · [Farmácias BR](https://github.com/godely/farmacias-br)

## Comparing the two collectors

On November 28, 2026 the public CLI collected eight products in 24.9 seconds on the test Mac. The input in `scripts/benchmark/actor-input.json` starts with two searches that both returned the same Pratium pack, then broadens to paracetamol. Across three search pages the collector scanned nine rows, saved eight distinct products, downloaded eight product pages (5,911,059 bytes of HTML) and attributed Pratium to its first search. Each product had a selling price, list price and online stock signal. Four had a source discount percentage. The Actor documents batched pricing. Its elapsed time and billed events for this input still require an observed run. [Actor collection and metrics](https://apify.com/automation-lab/drogasil-pharmacy-products-prices)

The publisher's example from October 27 and the new snapshot shared one pack. Its identifier, name, brand, categories, category path, product URL, currency and two online availability fields agreed. The published selling/list prices were R$39.98/R$39.98 with a 0% discount. On November 28 the selling/list prices were R$40.00/R$41.24 and the percentage was absent. The source queries, search links and timestamps also differed. A retailer's price can change between observations. This historical check supplies one row of evidence and leaves comparative speed, billing and same-time offer agreement open. [Published row](https://apify.com/automation-lab/drogasil-pharmacy-products-prices#example-output) · [Drogasil product](https://www.drogasil.com.br/pratium-140mg-gotas-frasco-15ml.html)

For a paired run, use the same input on both sides and start the CLI while the Actor is collecting. Write reports to a private working directory. Once the Actor finishes, its run ID lets the reader fetch the recorded input, dataset pages, work counters and available billing fields. An owner token in `APIFY_TOKEN` can make the actual charge visible. Reading an existing run does not launch a new one. [Apify run metadata and billing fields](https://docs.apify.com/api/v2/actor-run-get)

```sh
node scripts/benchmark/actor.mjs collect scripts/benchmark/actor-input.json > "$BENCH_DIR/local.json"
node scripts/benchmark/actor.mjs read-actor "$APIFY_RUN_ID" > "$BENCH_DIR/actor.json"
node scripts/benchmark/actor.mjs compare "$BENCH_DIR/local.json" "$BENCH_DIR/actor.json" > "$BENCH_DIR/report.json"
```

The same `compare` command accepts a full CLI JSON export and the Actor's downloaded JSON dataset directly, in that order. Each product's `observations` entry includes both timestamps, their signed difference in milliseconds and the values of each changed field. Files without run metadata can establish product overlap and field agreement. They leave billing, run timing and input equivalence unknown. Use a complete Drogasil dataset on each side. Partial pages and records from other retailers are rejected.

For completed Actor runs, `actor.queryInput` distinguishes omitted search terms, an empty array and a list containing blank terms. `actor.locallySupported` reports whether our collector accepts that input. A run with unsupported input retains its outcome, dataset and reported charges for inspection. Its input equivalence stays unknown.

`paired` requires two successful runs from the expected sources, matching normalized inputs and overlapping collection windows. The timestamp gap for the closest and farthest paired observations shows how closely the shared products were checked. Read the row counts and per-field differences independently. The report lists products unique to each source, duplicates, first-query disagreements and changed fields for each shared product. Duplicate or invalid identifiers are excluded from field comparisons. Field coverage is also counted across each full dataset. An explicit zero is a value, an explicit null is counted separately, and an omitted field is counted as missing. Reported work counters, elapsed time and actual billed events stay separate. An inaccessible charge remains unknown.

## Reproduction

Use the same SKU to compare product identity. Observe online offers in the same session and record seller, collection time and offer conditions. Exercise brand-only and brand-plus-generic queries, a mixed basket, an ambiguous name, a presentation conflict, a no-stock response, and a fixed-branch lookup. Supply test origins at runtime. Compare counts, product IDs and stock status independently of fluctuating quantities. Record tool calls separately from upstream requests. Report missing data and unauthenticated runs explicitly.

Fourteen calls to the project's remote MCP and 54 automated tests informed the original assessment. The published Actor sample and source schema established its documented capabilities. There was no authenticated Actor benchmark or comparative latency measurement. The personal test transcripts and client configuration are outside the repository.

[Actor and example](https://apify.com/automation-lab/drogasil-pharmacy-products-prices) · [Input schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/input-schema) · [Output schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/output-schema)
