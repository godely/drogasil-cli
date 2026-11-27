# Comparing prices across pharmacy chains

Run `npm ci --prefix mcp`, then `node mcp/scripts/compare-prices.mjs "<name, Drogasil SKU or GTIN>" "$CEP"`. The equivalent MCP tool is compare_pharmacy_prices. An ambiguous name returns product choices before any local price comparison. Set includeGenerics to list comparable generic presentations separately. A stable GTIN identifies a retail pack across different internal SKUs. Conflicting or incomplete product descriptions are excluded from the ranking.

The Pague Menos pilot compared 25 distinct presentations with validated shared barcodes. The audit considered 46 distinct Drogasil candidates; 21 had no Pague Menos result passing both identity and presentation checks. The 25 accepted packs each returned fulfillment methods at both test origins. Eleven had different offer or fulfillment summaries between the origins. The audit can be repeated with two caller-supplied CEPs using mcp/scripts/audit-retail-packs.mjs.

Drogasil's anonymous displayed price is listed separately from price offers verified by a retailer's fulfillment simulation for the supplied CEP. Prices are for one pack and exclude shipping. A store's location alone cannot verify its price. Conditions, retailer, seller, currency, checked time and source link accompany offers. A failed retailer check leaves other results usable.
