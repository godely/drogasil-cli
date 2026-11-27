---
name: compare-presentations
description: Find branded and generic Drogasil medication options, compare prices, and check which options are in stock nearby.
---

For a request about options at the closest Drogasil, call `compare_products` once with the user's original medication spelling, strength, release, pack, shared origin, and `store: "nearest"`. For “Quais opções de Frontal 2 mg tem na loja mais próxima?”, send “Frontal 2 mg”. For “Tilenol 750 mg, caixa de 20 comprimidos”, preserve “Tilenol”. The server resolves spelling, selects the closest participating branch, and checks stock. Ask for a CEP or coordinates if the user has not shared a location.

If the request itself specifies conflicting release types, ask which one the user means before any catalog or stock call. For “Glifage XR de liberação imediata”, ask “Você quis dizer Glifage XR ou Glifage de liberação imediata?” Preserve the stated dose even if it looks unusual.

Answer according to the first comparison result.

- `matches` gives verified catalog matches in ascending reference-price order. For a closest-store lookup, report this branch and its quantities, including zero. A missing quantity means unknown.
- `incomplete_presentation` ends the lookup for this request. Report the direct hits, their reference prices, quantities, and the missing catalog fields. Explain that other equivalents could not be verified. Wait for an explicit request before widening the search to the ingredient or another branch.
- `no_reference` means the requested presentation has no match. Clarify the name, strength, or pack with the user before looking up a different one. For “Novalgina 507 mg”, keep 507 mg throughout the lookup and ask before searching for 500 mg.
- `conflicting_release` requires clarification. `ambiguous` requires a choice among distinct candidates. Use a selected SKU only after the user chooses one. Repeating an exact SKU cannot fill missing catalog fields.
- Report an upstream failure as an unverified lookup. Distinguish a reported zero quantity from a branch outside the search window or stock that could not be verified.

“Opções de Frontal 2 mg” includes the brand, generics and other brands matching the same presentation. Preserve the requested release type. Matching catalog fields alone cannot establish clinical interchangeability.

For “Compare os preços de Frontal 2 mg”, call `compare_products` without an origin. For “Quais opções de Frontal 2 mg estão em estoque perto de mim?”, include the shared origin and omit `store` to search nearby branches. Report prices as catalog reference prices in reais. Distinguish the catalog price from each branch's reported stock.
