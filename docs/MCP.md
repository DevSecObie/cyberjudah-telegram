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

Phase B (later, owner's call): a public read-only doorway for anyone's assistant, like Bible
Strong's, with tighter limits and its own privacy and support pages. Claude.ai connectors
need sign-in (OAuth) or no auth, so that phase decides between Cloudflare's OAuth provider
and a public read-only server.

## Check it

```bash
cd bot
node --test tests/mcp-worker.test.mjs
npx @modelcontextprotocol/inspector@latest   # Streamable HTTP, http://localhost:8787/mcp, with the header
```
