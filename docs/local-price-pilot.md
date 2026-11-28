# Comparing prices across pharmacy chains

Run `npm ci --prefix mcp`, then `node mcp/scripts/compare-prices.mjs "<name, Drogasil SKU or GTIN>" "$CEP"`. If the shopper shared coordinates, pass "$LAT" "$LON" in place of "$CEP". The equivalent MCP tool `compare_pharmacy_prices` accepts either `zipcode` or `coordinates` with latitude and longitude. An ambiguous name returns product choices before any local price comparison. Set includeGenerics to list comparable generic presentations separately. A stable GTIN identifies a retail pack across different internal SKUs. Conflicting or incomplete product descriptions are excluded from the ranking.

The Pague Menos pilot compared 25 distinct presentations with validated shared barcodes. The audit considered 46 distinct Drogasil candidates; 21 had no Pague Menos result passing both identity and presentation checks. The 25 accepted packs each returned fulfillment methods at both test origins. Eleven had different offer or fulfillment summaries between the origins. The audit can be repeated with two caller-supplied CEPs using mcp/scripts/audit-retail-packs.mjs.

Drogasil's anonymous displayed price is listed separately from price offers verified by a retailer's fulfillment simulation for the supplied CEP or coordinates. Prices are for one pack and exclude shipping. A store's location alone cannot verify its price. Conditions, retailer, seller, currency, checked time and source link accompany offers. A failed retailer check leaves other results usable.

## Coverage across cities

The integrated MCP uses [Pague Menos](https://github.com/godely/paguemenos-cli) and [Drogaria São Paulo](https://github.com/godely/drogariasaopaulo-cli) as partner catalogs. Each adapter checks its retailer’s fulfillment service for the supplied CEP.

In the two-city acceptance check, Drogasil SKU 81128 returned verified offers from Pague Menos and Drogaria São Paulo in both Recife and São Paulo. Repeat these comparisons with a CEP supplied for each city. The tools have no default city. Exact GTIN lookups can also use the first retailer with corroborating presentation details when the Drogasil catalog is missing or unavailable. Numeric internal SKUs refer to Drogasil unless using a sibling's own CLI.
