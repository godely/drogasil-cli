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
| Additional pharmacy workflows | Compare equivalent presentations, check reported Drogasil branch quantities, plan purchases and compare identical packs across chains at a supplied location | The shared-pack pilot confirmed 25 matching presentations at two locations. A separate geographic check covered one shared pack in all state capitals and five interior cities. |

The original benchmark used the Actor's public schema. A paid run comparing row-by-row results and throughput against the Actor remains unmeasured. The hosted Apify platform also provides its own scheduler and dataset UI. Our deployment exposes the CLI, API and MCP for these workflows.

[Snapshot usage](catalog-snapshots.md) · [Storefront field audit](storefront-audit.md) · [Exact-pack pilot](local-price-pilot.md) · [Farmácias BR](https://github.com/godely/farmacias-br)

## Catalog check on November 28, 2026

Running `drogasil snapshot collect paracetamol --limit 1` returned one Tylenol Bebê 15 mL record with all 15 documented Actor fields and a seller field. Fourteen of the 15 fields had values. The selling price was R$42.89 and the list price was R$65.34. The source supplied no discount percentage, so the snapshot kept it null. The storefront stock signal was `1`, which yielded `inStock: true`. Physical branch inventory requires a separate lookup. [Actor output fields](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/output-schema)

The Actor documents `paracetamol` as the default search. Running `drogasil snapshot collect --limit 1` without a search term exited with status 1. A paired run against the Actor is still needed to measure product overlap, field values, throughput and billed events under the same conditions. [Actor parameters](https://apify.com/automation-lab/drogasil-pharmacy-products-prices#input-parameters) · [Open compatibility checks](https://github.com/godely/drogasil-cli/issues/58)

## Reproduction

Use the same SKU to compare product identity. Observe online offers in the same session and record seller, collection time and offer conditions. Exercise brand-only and brand-plus-generic queries, a mixed basket, an ambiguous name, a presentation conflict, a no-stock response, and a fixed-branch lookup. Supply test origins at runtime. Compare counts, product IDs and stock status independently of fluctuating quantities. Record tool calls separately from upstream requests. Report missing data and unauthenticated runs explicitly.

Fourteen calls to the project's remote MCP and 54 automated tests informed the original assessment. The published Actor sample and source schema established its documented capabilities. There was no authenticated Actor benchmark or comparative latency measurement. The personal test transcripts and client configuration are outside the repository.

[Actor and example](https://apify.com/automation-lab/drogasil-pharmacy-products-prices) · [Input schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/input-schema) · [Output schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/output-schema)
