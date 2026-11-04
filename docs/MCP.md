# CyberJudah MCP server

An MCP server lets an AI assistant (Claude, and later others) read CyberJudah directly. It
lives at `/mcp` on the bot Worker (`bot/src/mcp.ts`), laid out after Bible Strong's own MCP
server (`packages/mcp-service` in smontlouis/bible-strong, ADR-0085) and Cloudflare's
[stateless remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/):
`createMcpHandler` from `@modelcontextprotocol/server`, one server per request, JSON
answers over Streamable HTTP, nothing kept between requests.

## What it answers

Everything a reader can open in the app, read only:

| Tool | Reads |
| --- | --- |
| `read_passage` | The KJV text (with the Apocrypha) of a chapter, verse or range |
| `verse_study` | The classes and notes on a verse, its precepts and cross-references |
| `commentary` | CyberJudah's commentary on one verse: the class breakdowns, teacher and moment |
| `search_classes` | Where the classes said something, with the video at that moment |
| `read_transcript` | The verbatim transcript around a moment of a class or episode |
| `read_note` | A whole class, study or episode note, word for word, in parts |
| `search_library` | Any one public resource: transcripts, teachings, people, encyclopedia, Jewish Encyclopedia, study notes, topics, law, precepts, cases, glossary, doctrines, Timeline, Strong's, dictionary, Nave, scripture, verse study |
| `read_data` | Any file of the public data site (`data.cyberjudah.io`), from `api/index.json` and `api/notes/index.json` down to each case, doctrine, place, episode, topic and library book |
| `read_resource` | The public study resource feed (`/bs/v1`): commentary, Strong's lexicon, dictionaries, Nave, Timeline, cross-references |
| `person`, `timeline`, `look_up_word`, `law`, `precepts` | Ask's own lookups |

Long answers come in parts of 40,000 characters; the tool says which offset reads on.
Paths are checked against strict patterns (no `..`, no other host), so only the public data
site and the public feed are ever read.

Never exposed: accounts, studies, chats, credits, purchases, admin, studies other readers
published, or outside web pages (Ask's `outside_source` is left out).

## Who may call it

Phase A (now): **private**. The route answers `404` until the owner sets the Worker secret
`MCP_KEY`, then only a request with `Authorization: Bearer <MCP_KEY>`. The key is compared in
constant time. Calls are limited to 60 a minute (`MCP_LIMIT`).

The owner sets the key himself, never in chat or code:

```bash
cd bot
npx wrangler secret put MCP_KEY --env staging   # staging first
```

Connect Claude Code to it (the key comes from an environment variable, not typed into a file):

```bash
claude mcp add --transport http cyberjudah https://<worker>.workers.dev/mcp \
  --header "Authorization: Bearer $CYBERJUDAH_MCP_KEY"
```

### Sign-in for claude.ai and the Claude apps

Claude.ai, the Claude phone app and Claude Desktop cannot send a fixed header, so `/mcp` also
takes a token from the owner's sign-in (`bot/src/mcp-oauth.ts`). It is the MCP authorization
flow, kept to what one owner needs:

- `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`
  describe it, and a `401` from `/mcp` points to them (`WWW-Authenticate: ... resource_metadata=`).
- `/mcp/oauth/register` (dynamic client registration) only accepts Claude's callback
  (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) or a
  loopback address on the owner's own computer.
- `/mcp/oauth/authorize` shows a page that asks for **MCP_KEY**. Only the owner can sign in.
  Tries share the `MCP_LIMIT` budget; the page cannot be framed, and a post from another site
  is refused.
- `/mcp/oauth/token` trades the code (2 minutes, PKCE S256 required) for an access token
  (1 hour, only for this host's `/mcp`) and a refresh token (30 days, only for that client).
- Nothing is stored: every client id, code and token is signed with a key derived from
  `MCP_KEY`. **Changing `MCP_KEY` signs every assistant out at once.** Codes and refresh tokens
  are not single-use (there is no store to remember them); the PKCE verifier, the short code
  life and the key rotation are what protect them.

To connect in claude.ai: Settings, Connectors, Add custom connector, address
`https://<worker>/mcp`, no client id. Claude opens the sign-in page; paste the key there. The
connector then also works in the Claude phone and desktop apps.

Phase B (later, owner's call): a public read-only doorway for anyone's assistant, like Bible
Strong's, with tighter limits and its own privacy and support pages.

## Check it

```bash
cd bot
node --test tests/mcp-worker.test.mjs tests/mcp-oauth.test.mjs
npx @modelcontextprotocol/inspector@latest   # Streamable HTTP, http://localhost:8787/mcp, with the header
```
