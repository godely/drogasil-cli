---
name: nearby-stock
description: Locate participating Drogasil branches reporting stock for a specific product and location.
---

For “Qual loja perto do meu CEP tem duas caixas?”, obtain the product SKU and the user's shared CEP or coordinates. If given a product name, use search_products and select an exact presentation. Ask the user when strength, release type, or pack size leaves more than one plausible match.

Call find_nearby_stock with one SKU, origin, and minimumQuantity (two for the example). Present branch names, addresses, distances, and quantities. Distances are straight-line estimates from the supplied origin. An empty list describes the nearby participating branches queried. For errors, report that stock could not be verified. Stock can change.
