---
name: compare-presentations
description: Find branded and generic Drogasil medication options, compare prices, and check which options are in stock nearby.
---

Treat “Frontal 2mg options in my area” and “opções de Frontal 2 mg perto de mim” as requests for the named product plus matching generics and other brands. Call compare_products first with the original medication name, strength, and any stated release type. Reuse a location the user already shared for this request. “Stock” adds the location filter. “Options” refers to products unless the user explicitly asks for store options, brand only, or different formulations. Keep XR separate from plain Frontal unless the user requests both.

For “Compare os preços de Frontal 2 mg”, call compare_products with the full name and strength. Use a SKU if supplied. Include an origin only if the user supplied or explicitly shared one. A price-only comparison needs no location.

If the result is ambiguous, show the candidate names, pack sizes, and SKUs and ask which one the user means. Retry with the selected SKU. Present the returned order, preserving pack size and release type. Describe the values as catalog reference prices in reais. Matching catalog attributes does not establish clinical interchangeability.

For a location-aware result, show the nearest stocked branch and quantity for each option. Distinguish no matching presentation, unavailable reference prices, no stock within the search window, and a failed lookup.
