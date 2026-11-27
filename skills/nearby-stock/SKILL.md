---
name: nearby-stock
description: Locate participating Drogasil branches reporting stock for a specific product and location.
---

For “which Frontal 2 mg options does my closest store have?” or “quais opções de Frontal 2 mg tem na loja mais próxima?”, make one compare_products call with query “Frontal 2mg”, the shared origin, and store set to the literal string "nearest". Apply this pattern to other named medications too. Skip preliminary catalog searches, store discovery, and per-SKU stock calls. The server selects one nearest participating branch and checks every matching option there. Report the branch, the positive quantities and reference prices, and distinguish zero stock from unknown. If all quantities are zero, say so for that branch. If location is missing, ask for it first. A request for options across nearby stores uses compare_products with origin and omits store.

When the user asks which medication options, alternatives, or generics are in stock, call compare_products with the original product query and shared origin. Use a single-SKU stock check for requests about a specific item, such as “Which pharmacies have brand-name Frontal?” or “Onde tem esse SKU?”.

For “Qual loja perto do meu CEP tem duas caixas?”, obtain the product SKU and the user's shared CEP or coordinates. If given a product name, use search_products and select an exact presentation. Ask the user when strength, release type, or pack size leaves more than one plausible match.

Call find_nearby_stock with one SKU, origin, and minimumQuantity (two for the example). Present branch names, addresses, distances, and quantities. Distances are straight-line estimates from the supplied origin. An empty list describes the nearby participating branches queried. For errors, report that stock could not be verified. Stock can change.

Use the original spelling for the first catalog call. For a closest-store question, keep the same branch even if every quantity is zero. When using find_nearby_stock for a specific SKU, read nearestStore and its quantity, including zero or unknown. The first branch meeting a stock threshold can be farther away.

An incomplete_presentation result is final for those SKUs. Report the direct catalog hits, their prices and branch quantities, and which catalog fields are missing. The user cannot supply the missing catalog metadata by confirming the SKU. If the stated strength has no match or the requested release types conflict (for example, “Glifage XR de liberação imediata”), clarify the presentation before looking up stock for alternatives.
