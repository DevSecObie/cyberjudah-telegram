# CyberJudah MCP server

An MCP server lets an AI assistant (Claude, and later others) read CyberJudah directly. It
lives at `/mcp` on the bot Worker (`bot/src/mcp.ts`), laid out after Bible Strong's own MCP
server (`packages/mcp-service` in smontlouis/bible-strong, ADR-0085) and Cloudflare's
[stateless remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/):
`createMcpHandler` from `@modelcontextprotocol/server`, one server per request, JSON
answers over Streamable HTTP, nothing kept between requests.

## What it answers

Everything a reader can open in the app, read only. A host starts with `find_teaching`, then
reads the best results in full:

| Tool | Reads |
| --- | --- |
| `find_teaching` | **Start here.** A question in plain words, searched by meaning (the Vectorize index) and by keyword together, reranked by whether a passage answers it: every class transcript (notes or none), the class and study notes, the law, cases and verses. Each result says where to read on |
| `read_passage` | The KJV text (with the Apocrypha) of a chapter, verse or range |
| `verse_study` | The classes and notes on a verse, its precepts and cross-references, 25 classes a page (`page`) |
| `commentary` | The class breakdowns on one verse: a short list first (`format: "concise"`), in full with `"detailed"` |
| `search_classes` | Where the classes said a word or phrase (keyword), with the video at that moment |
| `read_transcript` | A class's captions around a moment (`at`, `span`), over a stretch (`from`, `to`) or from the start, read on by time. `format: "clean"` (default): a paragraph per turn of speaker, known mishearings corrected and listed, cue tags, fillers and stutters removed. `"verbatim"`: every caption as YouTube gave it |
| `lint_transcript` | How far a recording's captions can be trusted: coverage and gaps, punctuation, turns of speaker, noise, known corrections, and words before "chapter N" that are no book of the 1611 Bible (likely mishearings). Graded A to D |
| `read_note` | A whole class, study or episode note as Markdown, in parts |
| `search_library` | Any one public resource: transcripts, teachings, people, encyclopedia, Jewish Encyclopedia, study notes, topics, law, precepts, cases, glossary, doctrines, Timeline, Strong's, dictionary, Nave, scripture, verse study |
| `read_data` | Any file of the public data site (`data.cyberjudah.io`), from `api/index.json` and `api/notes/index.json` down to each case, doctrine, place, episode, topic and library book |
| `read_resource` | The public study resource feed (`/bs/v1`): commentary, Strong's lexicon, dictionaries, Nave, Timeline, cross-references (the `language=en` query is added when missing) |
| `person`, `timeline`, `look_up_word`, `law`, `precepts` | Ask's own lookups (`precepts` prefers a topic that holds every word asked, and says when it is only the closest) |

Prompts for a host's menu: `study_verse`, `research_question`, `check_transcript`.

Answers are short by default: a part holds 12,000 characters (about 3,000 tokens), set with
`max_chars` (2,000 to 40,000), and the tool says how to read on (`offset`, or `from` for a
transcript). This follows the published guidance on tools for agents: a search that points to
what to read, short answers by default, and errors that say what to try instead.
Paths are checked against strict patterns (no `..`, no other host), so only the public data
site, the public feed and the transcript files are ever read.

### The transcript linter

`bot/src/transcript-lint.ts` needs no model and no outside service: it is free, fast and the
same every time. It never changes a caption file. The clean view applies only the corrections
in `data/transcripts/corrections.json` (the cyberjudah repository's `corrections.py`) whose
caption still matches, and lists each one beside the text. Doubled words the King James
means ("verily, verily", "holy, holy") are kept. A word `lint_transcript` flags again and
again ("Baroo chapter", "Mcabes chapter") is a candidate rule for `corrections.py`.

Never exposed: accounts, studies, chats, credits, purchases, admin, studies other readers
published, or outside web pages (Ask's `outside_source` is left out).

## Who may call it

Phase A (now): **private**. The route answers `404` until the owner sets the Worker secret
`MCP_KEY`, then only a request with `Authorization: Bearer <MCP_KEY>`. The key is compared in
constant time. Calls are limited to 60 a minute per caller (`MCP_LIMIT`).

The owner sets the key himself, never in chat or code. Make it long and random
(`openssl rand -hex 32`, or a password manager's generator) and keep it in a password manager:

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
- Nothing is stored: every code and token is signed with a key derived from `MCP_KEY`, and
  only handed out after the key is typed, so nobody can test guesses offline. A client id is
  the client's own registration, unsigned; its callbacks are checked again at every use. **Changing `MCP_KEY` signs every assistant out at once.** Codes and refresh tokens
  are not single-use (there is no store to remember them); the PKCE verifier, the short code
  life and the key rotation are what protect them.

To connect in claude.ai: Settings, Connectors, Add custom connector, address
`https://<worker>/mcp`, no client id. Claude opens the sign-in page; paste the key there. The
connector then also works in the Claude phone and desktop apps.

Phase B (owner's call): a public read-only doorway for anyone's assistant, like Bible
Strong's. Setting the Worker variable `MCP_PUBLIC=1` lets a request with no key through; a
wrong key is still turned away. Every caller (the owner, each signed-in token, each address,
hashed) has its own `MCP_LIMIT` budget. Before turning it on, decide on the privacy and
support pages, and whether `find_teaching` (one Workers AI embedding and one rerank a call)
needs a tighter limit for callers without a key.

## Check it

```bash
cd bot
node --test tests/mcp-worker.test.mjs tests/mcp-oauth.test.mjs
npx @modelcontextprotocol/inspector@latest   # Streamable HTTP, http://localhost:8787/mcp, with the header
```
