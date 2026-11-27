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

## Reproduction

Use the same SKU to compare product identity. Observe online offers in the same session and record seller, collection time and offer conditions. Exercise brand-only and brand-plus-generic queries, a mixed basket, an ambiguous name, a presentation conflict, a no-stock response, and a fixed-branch lookup. Supply test origins at runtime. Compare counts, product IDs and stock status independently of fluctuating quantities. Record tool calls separately from upstream requests. Report missing data and unauthenticated runs explicitly.

Fourteen calls to the project's remote MCP and 54 automated tests informed the original assessment. The published Actor sample and source schema established its documented capabilities. There was no authenticated Actor benchmark or comparative latency measurement. The personal test transcripts and client configuration are outside the repository.

[Actor and example](https://apify.com/automation-lab/drogasil-pharmacy-products-prices) · [Input schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/input-schema) · [Output schema](https://apify.com/automation-lab/drogasil-pharmacy-products-prices/output-schema)
