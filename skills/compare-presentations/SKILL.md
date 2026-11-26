---
name: compare-presentations
description: Compare Drogasil catalog presentations and reference prices, optionally with nearby stock.
---

For “Compare os preços de Frontal 2 mg”, call compare_products with the full name and strength. Use a SKU if supplied. Include an origin only if the user supplied or explicitly shared one. A price-only comparison needs no location.

If the result is ambiguous, show the candidate names, pack sizes, and SKUs and ask which one the user means. Retry with the selected SKU. Present the returned order, preserving pack size and release type. Describe the values as catalog reference prices in reais. Matching catalog attributes does not establish clinical interchangeability.

For a location-aware result, show the nearest stocked branch and quantity for each option. Distinguish no matching presentation, unavailable reference prices, no stock within the search window, and a failed lookup.
