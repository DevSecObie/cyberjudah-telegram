# CyberJudah MCP server

An MCP server lets an AI assistant (Claude, and later others) read CyberJudah directly. It
lives at `/mcp` on the bot Worker (`bot/src/mcp.ts`), laid out after Bible Strong's own MCP
server (`packages/mcp-service` in smontlouis/bible-strong, ADR-0085) and Cloudflare's
[stateless remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/):
`createMcpHandler` from `@modelcontextprotocol/server`, one server per request, JSON
answers over Streamable HTTP, nothing kept between requests.

## What it answers

| Tool | Reads |
| --- | --- |
| `read_passage` | The KJV text (with the Apocrypha) of a chapter, verse or range |
| `verse_study` | The classes and notes on a verse, its precepts and cross-references |
| `search_classes` | Where the classes said something, with the video at that moment |
| `person` | A person's entry in People |
| `timeline` | Timeline events, classes first |
| `look_up_word` | Easton's and Strong's |
| `law` | The Law handbook |
| `precepts` | Precept topics |

Each tool reuses Ask's own lookup (`ask-tools.ts`, `teachings.ts`, `data.ts`), so the
assistant reads exactly what a reader sees in the app. Every tool is marked read-only.

Never exposed: accounts, unpublished studies, chats, credits, purchases, admin, or outside
web pages (Ask's `outside_source` is left out).

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
