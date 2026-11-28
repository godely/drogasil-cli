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
| Additional pharmacy workflows | Compare equivalent presentations, check branch quantities, plan purchases and compare identical packs across chains at a supplied location | The shared-pack pilot confirmed 25 matching presentations at two locations. The four-chain client also checked a single shared pack in all state capitals and five interior cities. |

The hosted Apify platform provides its own scheduler and dataset UI. Our deployment exposes the CLI, API and MCP for these workflows.

[Snapshot usage](catalog-snapshots.md) · [Storefront field audit](storefront-audit.md) · [Exact-pack pilot](local-price-pilot.md) · [Farmácias BR](https://github.com/godely/farmacias-br)

## Comparison with the published Actor record

Both sources found the same 15 mL bottle of Pratium paracetamol drops under the query `paracetamol`. The Actor published one example observed on October 27, 2026. On November 28 the CLI collected 60 distinct products and exported the complete run. Joining by the product identifier matched that example. The sources were 32 days and 11 hours apart. [Actor example and field definitions](https://apify.com/automation-lab/drogasil-pharmacy-products-prices#example-output) · [Drogasil product page](https://www.drogasil.com.br/pratium-140mg-gotas-frasco-15ml.html)

| Observation | Actor, October 27 | Drogasil CLI, November 28 |
|---|---:|---:|
| Advertised selling price | R$ 39.98 | R$ 40.00 |
| Advertised list price | R$ 39.98 | R$ 41.24 |
| Retailer-reported discount | 0% | Unknown |
| Online stock signal | 1 | 1 |

Ten of the thirteen comparable fields had identical values, including the product name, brand, category path and product URL. The table shows the three differing fields. The November product page displayed R$ 40,00 and omitted a percentage for this offer. The 59 other CLI rows have no published Actor observations to compare. Catalog coverage, simultaneous price agreement and relative speed still need two full runs collected at the same time.

For a side-by-side benchmark, launch both collectors with the same search terms, order and product limit. Verify that both completed, download the Actor dataset as JSON and export the entire CLI run. A single page from `snapshot read` can omit records. Compare the two files locally:

```sh
drogasil snapshot export "$RUN_ID" --format json > drogasil.json
node scripts/compare-apify-export.mjs actor.json drogasil.json > comparison.json
```

The report counts unique matches and lists products present on only one side. It identifies duplicate or missing identifiers, records both observation times and distinguishes reported zero, missing fields and explicit nulls. A duplicated identifier is excluded from value comparisons. To measure speed, record each run's start and completion times separately.

## Reproduction

Use the same SKU to compare product identity. Observe online offers in the same session and record seller, collection time and offer conditions. Exercise brand-only and brand-plus-generic queries, a mixed basket, an ambiguous name, a presentation conflict, a no-stock response, and a fixed-branch lookup. Supply test origins at runtime. Compare counts, product IDs and stock status independently of fluctuating quantities. Record tool calls separately from upstream requests. Report missing data and unauthenticated runs explicitly.

Fourteen calls to the project's remote MCP and 54 automated tests informed the original assessment. The published Actor sample and source schema established its documented capabilities. There was no authenticated Actor benchmark or comparative latency measurement. The personal test transcripts and client configuration are outside the repository.

[Actor and example](https://apify.com/automation-lab/drogasil-pharmacy-products-prices) · [Input schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/input-schema) · [Output schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/output-schema)
