# Mini App readers get their own search, reader and sign-in limits

- Behind the Mini App's Worker, semantic search, the public reader, app sign-in, reminders and Ask feedback now count each reader's own network, which that Worker signs, instead of one address shared by every Mini App reader.
- The public reader and reminder limits now key on a keyed hash of the address instead of a plain digest or the address.
- Semantic search and Ask feedback allow 600 requests a minute per network for a reader's own signed address; unsigned requests keep 6,000, sized for the shared Mini App address.
