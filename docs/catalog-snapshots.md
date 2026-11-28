# Catalog snapshots

Node 20+, Python 3 and curl are required. The library exports collectSnapshot and readSnapshot. The MCP tools collect_catalog_snapshot and read_catalog_snapshot start a run and read a bounded page. Retain its runId. A run can contain rows even if a later upstream request failed.

```sh
drogasil snapshot collect paracetamol shampoo --limit 100
drogasil snapshot read "$RUN_ID" --offset 20 --limit 20
drogasil snapshot export "$RUN_ID" --format csv > catalog.csv
drogasil snapshot export "$RUN_ID" --format xlsx > catalog.xlsx
drogasil snapshot export "$RUN_ID" --format json > catalog.json
```

The default SQLite database is under the server user's local data directory. Override with DROGASIL_SNAPSHOT_DB. Use the same database for collection, polling and export. Snapshot tools are intended for a personal authenticated connection. Access to a run ID permits reading that run.

For a narrow result, pass `fields: ["name", "currentPrice"]` to `read_catalog_snapshot`, or use `readSnapshot(runId, { fields: ["name", "currentPrice"] })` in JavaScript. Only the product records are projected. The count, state and continuation offset describe the same saved run. Each record retains the requested field order, explicit nulls and zeros. Fields absent from the source record remain absent. Omitting `fields` returns the full records.

| Actor capability | Implementation and limits |
|---|---|
| Ordered search and attribution | Omit the queries to collect up to 20 products for `paracetamol`. An explicit list must contain 1–10 nonblank queries of up to 150 characters each. First query wins on duplicate SKUs. Maximum 1,000 items and at most 30 pages per query. |
| Product and price fields | SKU, name, brand, categories and path, canonical URL, BRL selling/list prices, reported discount, stock signal and availability, source query and URL, UTC time. Missing source values remain null. |
| Storage and bounded reads | Durable SQLite rows per run, offsets, partial failure status and separate full-file export. |
| Spreadsheet or warehouse | JSON preserves types. CSV and XLSX retain SKU as text. Import either spreadsheet format into Google Sheets. |
| Scheduled delivery | Run scripts/scheduled-snapshot.mjs from cron or a systemd timer. Configure DROGASIL_WEBHOOK_URL with a private HTTPS endpoint for Make, Zapier, or an operator-owned receiver. It receives the saved run and its records. Configure a Google Sheets action in the receiver if needed. |
| Limitations | Public product-page collection uses one request per SKU with pacing. Feed ranking and upstream changes can alter results. Independently configured third-party destinations require testing with the destination owner's account. |

An hourly cron entry can use `0 * * * * cd /absolute/path/to/checkout && /absolute/path/to/node scripts/scheduled-snapshot.mjs paracetamol`. Set an appropriate volume and schedule in the operator environment. Run IDs separate repeated observations for historical comparison. Export failed or pending rows only through explicit paged reads.

If webhook delivery fails or times out, retry the saved run with the same database and HTTPS destination:

```sh
node scripts/scheduled-snapshot.mjs --run-id "$RUN_ID"
```

The receiver gets the original observations and the same `Idempotency-Key`. Configure it to deduplicate that key if repeated delivery would create duplicate rows. CSV and XLSX include optional columns even when their first value appears later in the run.

Pague Menos and Drogaria São Paulo use the same columns for catalog snapshots. When a product has a single seller, the flat columns describe that offer. With several sellers, the flat columns use the retailer's explicitly designated default seller. If the catalog does not identify a unique default, the individual offers remain in `offers` and the flat seller and price cells stay empty. The numeric stock signal comes from the online catalog. Physical branch stock requires a separate branch observation. The discount column contains a retailer-reported percentage when available. Earlier runs are readable even when the original observation omitted a category, URL or online stock signal.

A Drogasil snapshot retries a failed source request up to twice for a network interruption, HTTP 429 or HTTP 5xx. Requests are paced at least 750 ms apart. A retry waits at least 750 ms, then at least 1.5 seconds. A longer Retry-After up to 30 seconds takes precedence. If the source requests a longer pause the run stops and retains the earlier rows. An access refusal, redirect, malformed page or missing offer ends the run with its partial data.

In a completed or failed run, `stats.searchPages` counts logical search pages and `searchRequests` counts attempts. `productRequests` includes retried product reads. `retries`, `skippedServices`, `skippedDuplicates` and `invalidSkus` describe work that produced no new row. `observedResponses` and `responseBodyBytes` cover complete bodies measured by the Drogasil transport, including HTTP error responses. Partial transfers, headers and transport framing are outside this measurement. `productPageBytes` retains its original meaning of HTML bytes for successful product reads. Old run records retain their original counters.

The collector requests HTTP compression for product pages. Where measured, `productTransferBytes` counts the downloaded product response bodies before decompression, including completed HTTP error bodies. Search traffic is excluded. `responseBodyBytes` still counts the decoded content presented to the collector. Historical runs may omit the transfer measurement.

In a November 28 check, two consecutive searches shared two of their first three products. To measure transfer costs on a fixed assortment, both readers then fetched the same three product URLs. Their offer fields agreed apart from observation time. The earlier reader downloaded 2,122,943 bytes of HTML. The new reader downloaded 268,946 bytes, an 87.3% reduction for those product pages. The paid Actor was outside this measurement.

The [capacity check](../mcp/checks/snapshot-capacity.mjs) runs with the MCP test suite. Ten overlapping fixture searches fill a single 1,000-product collection. It reads the saved rows through the stdio MCP, exports them with the CLI and verifies all rows and fields in JSON, CSV and XLSX. This covers the collection limit independently of live storefront ranking.

In a separate November 28 test, the CLI exported three live hygiene products to XLSX. Importing that file as a native Google Sheet preserved all 16 headers and all 48 data cells against the CLI JSON, including numeric prices, text identifiers, booleans, category lists encoded as text, and two blank discounts. This verifies file import. Scheduled delivery into a particular Google account through Make or Zapier requires a configured workflow.
