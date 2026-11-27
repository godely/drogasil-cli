# Public storefront field audit

On 27 November 2026, the audit sampled five distinct listings from each of six keyword searches covering medication, specialty products, sunscreen, shampoo, diapers and fragrance. It read the anonymous product page for each SKU and compared its structured offer with the selling price rendered in the same HTML response.

| Field or check | Observed across 30 listings |
|---|---:|
| Selling price agrees with rendered BRL amount | 30 |
| Structured list price | 30 |
| Source discount percentage | 10 |
| Seller name | 29 |
| Numeric storefront stock signal | 30 |
| Listings with zero stock signal | 3 |

Nine records had a positive source percentage. A difference between the two prices can exist even when the store omits the percentage. Consumers receive null for that field. Storefront availability is distinct from branch stock.

Run `node scripts/audit-offers.mjs` with Node and curl. The JSON output includes SKU, source URLs, observation time, reference price and rendered price. Catalog and storefront prices are separate observations. Public product-page data can change, including the subset of fields rendered.
