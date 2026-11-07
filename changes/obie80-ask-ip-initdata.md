# Mini App readers no longer share one daily Ask limit

- The Mini App's Worker can now sign each reader's own network address, so the per-address Ask limit counts each Mini App reader's network instead of one address shared by every Mini App reader. Unsigned requests are counted as before.
- The per-address Ask counter now keeps a keyed hash of the address instead of the address.
