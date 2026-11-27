---
name: compare-presentations
description: Find branded and generic Drogasil medication options, compare prices, and check which options are in stock nearby.
---

For “which Frontal 2 mg options does my closest store have?” or “quais opções de Frontal 2 mg tem na loja mais próxima?”, make one compare_products call with query “Frontal 2mg”, the shared origin, and store set to the literal string "nearest". Apply this pattern to other named medications too. Skip preliminary catalog searches, store discovery, and per-SKU stock calls. The server selects one nearest participating branch and checks every matching option there. Report the branch, the positive quantities and reference prices, and distinguish zero stock from unknown. If all quantities are zero, say so for that branch. If location is missing, ask for it first. A request for options across nearby stores uses compare_products with origin and omits store.

Treat “Frontal 2mg options in my area” and “opções de Frontal 2 mg perto de mim” as requests for the named product plus matching generics and other brands. Call compare_products first with the original medication name, strength, and any stated release type. Reuse a location the user already shared for this request. “Stock” adds the location filter. “Options” refers to products unless the user explicitly asks for store options, brand only, or different formulations. Keep XR separate from plain Frontal unless the user requests both.

For “Compare os preços de Frontal 2 mg”, call compare_products with the full name and strength. Use a SKU if supplied. Include an origin only if the user supplied or explicitly shared one. A price-only comparison needs no location.

If the result is ambiguous, show the candidate names, pack sizes, and SKUs and ask which one the user means. Retry with the selected SKU. Present the returned order, preserving pack size and release type. Describe the values as catalog reference prices in reais. Matching catalog attributes does not establish clinical interchangeability.

For a location-aware result, show the nearest stocked branch and quantity for each option. Distinguish no matching presentation, unavailable reference prices, no stock within the search window, and a failed lookup.

Use the original spelling for the first catalog call. For a closest-store question, keep the same branch even if every quantity is zero. When using find_nearby_stock for a specific SKU, read nearestStore and its quantity, including zero or unknown. The first branch meeting a stock threshold can be farther away.

An incomplete_presentation result is final for those SKUs. Report the direct catalog hits, their prices and branch quantities, and which catalog fields are missing. The user cannot supply the missing catalog metadata by confirming the SKU. If the stated strength has no match or the requested release types conflict (for example, “Glifage XR de liberação imediata”), clarify the presentation before looking up stock for alternatives.
