import type { Env } from "./env";

/**
 * Sign-in for the private MCP server, so hosts that cannot send a fixed key (claude.ai, the
 * Claude phone and desktop apps) can still connect. It is the MCP authorization flow
 * (OAuth 2.1 with PKCE, dynamic client registration, RFC 8414 and RFC 9728 metadata), kept as
 * small as one owner needs:
 *
 * - The only person who can sign in is the owner: the sign-in page asks for MCP_KEY itself.
 * - Nothing is stored. Every client id, code and token is a payload signed with a key derived
 *   from MCP_KEY (HMAC-SHA256), so rotating MCP_KEY signs every assistant out at once.
 * - Codes live 2 minutes and need the PKCE verifier; access tokens live 1 hour and only work
 *   on this host's /mcp; refresh tokens live 30 days and only for the client they were given to.
 * - Only Claude's own callback addresses and loopback addresses (Claude Code, RFC 8252) can
 *   receive a code.
 */

const CODE_TTL = 120;
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;

/** Where a code may be sent: Claude's web callback, or a program on the owner's own computer. */
const CALLBACKS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
export function allowedRedirect(uri: string): boolean {
  if (CALLBACKS.has(uri)) return true;
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    && !url.username && !url.password && !url.hash;
}

type Payload = { typ: "client" | "code" | "access" | "refresh"; exp?: number; [field: string]: unknown };

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);

/** The signing key, derived from MCP_KEY so the two never have to be kept apart. */
async function signingKey(env: Env): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(`cyberjudah-mcp-oauth|${env.MCP_KEY}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function seal(env: Env, payload: Payload): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(`${payload.typ}.${body}`)));
  return `${body}.${b64url(mac)}`;
}

/** The payload of a token of this type, or null if it is forged, of another type or expired. */
export async function unseal(env: Env, token: string, typ: Payload["typ"]): Promise<Payload | null> {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined || token.length > 4096) return null;
  try {
    // crypto.subtle.verify compares in constant time.
    if (!(await crypto.subtle.verify("HMAC", await signingKey(env), unb64url(mac), encoder.encode(`${typ}.${body}`)))) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as Payload;
    if (payload.typ !== typ || (payload.exp !== undefined && payload.exp < now())) return null;
    return payload;
  } catch {
    return null;
  }
}

/** A short, fixed-length tag for a client id, so codes and refresh tokens can name it. */
async function clientTag(clientId: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(clientId))).slice(0, 16));
}

async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

const resourceOf = (origin: string) => `${origin}/mcp`;

/** An access token for /mcp on this host: true only for a live, untampered one. */
export async function accessTokenValid(env: Env, token: string, origin: string): Promise<boolean> {
  const payload = await unseal(env, token, "access");
  return !!payload && payload.aud === resourceOf(origin);
}

/** The header a 401 from /mcp carries, so a host can find the sign-in (RFC 9728). */
export const challenge = (origin: string) => `Bearer realm="cyberjudah-mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`;

const OPEN = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...OPEN } });
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

export function protectedResource(origin: string): Response {
  return json({ resource: resourceOf(origin), authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["read"], resource_name: "CyberJudah" });
}

export function authorizationServer(origin: string): Response {
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/oauth/authorize`,
    token_endpoint: `${origin}/mcp/oauth/token`,
    registration_endpoint: `${origin}/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read"],
    authorization_response_iss_parameter_supported: true,
  });
}

/** Dynamic client registration (RFC 7591): the client id carries its own callbacks, signed. */
async function register(request: Request, env: Env): Promise<Response> {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try { body = await request.json(); } catch { return oauthError("invalid_client_metadata", "The body must be JSON."); }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 5 || uris.length !== (body.redirect_uris as unknown[]).length) return oauthError("invalid_redirect_uri", "Give one to five redirect_uris.");
  const refused = uris.find((u) => !allowedRedirect(u));
  if (refused) return oauthError("invalid_redirect_uri", "Only Claude's callback or a loopback address can receive a code.");
  const name = typeof body.client_name === "string" ? body.client_name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
  // A random id makes every registration its own client, even with the same callbacks.
  const clientId = await seal(env, { typ: "client", r: uris, n: name, id: crypto.randomUUID() });
  return json({ client_id: clientId, client_id_issued_at: now(), redirect_uris: uris, client_name: name || undefined, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
}

type AuthorizeRequest = { clientId: string; clientName: string; redirectUri: string; challenge: string; state: string; resource: string };

/** The authorize parameters checked; a message instead when they cannot be trusted to redirect. */
async function readAuthorize(env: Env, params: URLSearchParams, origin: string): Promise<AuthorizeRequest | string> {
  const clientId = params.get("client_id") ?? "";
  const client = await unseal(env, clientId, "client");
  if (!client) return "This assistant is not registered here. Remove the connector and add it again.";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!(client.r as string[]).includes(redirectUri) || !allowedRedirect(redirectUri)) return "This sign-in link has an address that was not registered.";
  if (params.get("response_type") !== "code") return "Only the code flow is supported.";
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return "This sign-in needs PKCE (S256).";
  const resource = params.get("resource") || resourceOf(origin);
  if (resource !== resourceOf(origin)) return "This sign-in is for another server.";
  const state = params.get("state") ?? "";
  if (state.length > 512) return "The sign-in link is too long.";
  return { clientId, clientName: (client.n as string) || "An assistant", redirectUri, challenge: codeChallenge, state, resource };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(origin: string, req: AuthorizeRequest, problem = "", status = 200): Response {
  const target = new URL(req.redirectUri);
  const hidden = Object.entries({ client_id: req.clientId, redirect_uri: req.redirectUri, response_type: "code", code_challenge: req.challenge, code_challenge_method: "S256", state: req.state, resource: req.resource })
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to CyberJudah</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}input[type=password]{width:100%;font:inherit;padding:.6rem;box-sizing:border-box}button{font:inherit;padding:.6rem 1.2rem;margin-top:1rem}.problem{color:#c62828}</style></head>
<body><h1>Connect to CyberJudah</h1><p><strong>${escape(req.clientName)}</strong> wants to read CyberJudah for you. After you sign in, it is sent back to <strong>${escape(target.host)}</strong>.</p>
<p>It can only read what the app already shows every reader. Only the owner can connect.</p>
${problem ? `<p class="problem">${escape(problem)}</p>` : ""}
<form method="post" action="${escape(origin)}/mcp/oauth/authorize">${hidden}<label for="key">MCP key</label><input id="key" name="key" type="password" autocomplete="current-password" required autofocus><button type="submit">Connect</button></form></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      // same-origin keeps the Origin header on the post (no-referrer would send "null").
      "referrer-policy": "same-origin",
      // form-action also covers the redirect after the post, so the callback's origin is listed.
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${target.origin}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

const notice = (text: string, status = 400) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });

async function keyMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(a, b);
}

async function authorize(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method === "GET") {
    const req = await readAuthorize(env, new URL(request.url).searchParams, origin);
    return typeof req === "string" ? notice(req) : page(origin, req);
  }
  if (request.method !== "POST") return notice("Method not allowed", 405);
  // A sign-in from another site's page is refused; the browser always sends Origin on a post.
  if (request.headers.get("origin") !== origin) return notice("Sign in from the CyberJudah page.", 403);
  const form = new URLSearchParams(await request.text());
  const req = await readAuthorize(env, form, origin);
  if (typeof req === "string") return notice(req);
  if (env.MCP_LIMIT) {
    const { success } = await env.MCP_LIMIT.limit({ key: "oauth-sign-in" });
    if (!success) return page(origin, req, "Too many tries. Wait a minute and try again.", 429);
  }
  if (!(await keyMatches(form.get("key") ?? "", env.MCP_KEY ?? ""))) {
    console.warn(JSON.stringify({ message: "mcp oauth sign-in refused" }));
    return page(origin, req, "That key is not right.", 401);
  }
  const code = await seal(env, { typ: "code", c: await clientTag(req.clientId), r: req.redirectUri, ch: req.challenge, aud: req.resource, exp: now() + CODE_TTL });
  const back = new URL(req.redirectUri);
  back.searchParams.set("code", code);
  if (req.state) back.searchParams.set("state", req.state);
  back.searchParams.set("iss", origin);
  return new Response(null, { status: 302, headers: { location: back.toString(), "cache-control": "no-store" } });
}

async function tokens(env: Env, tag: string, aud: string): Promise<Response> {
  const access = await seal(env, { typ: "access", aud, exp: now() + ACCESS_TTL });
  const refresh = await seal(env, { typ: "refresh", c: tag, aud, exp: now() + REFRESH_TTL });
  return json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: "read" });
}

async function token(request: Request, env: Env, origin: string): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const clientId = form.get("client_id") ?? "";
  if (!(await unseal(env, clientId, "client"))) return oauthError("invalid_client", "Unknown client.", 401);
  const tag = await clientTag(clientId);
  const resource = form.get("resource");
  if (resource && resource !== resourceOf(origin)) return oauthError("invalid_target", "This token endpoint only issues tokens for this server.");
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = await unseal(env, form.get("code") ?? "", "code");
    const verifier = form.get("code_verifier") ?? "";
    if (!code || code.c !== tag || code.r !== form.get("redirect_uri") || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || (await s256(verifier)) !== code.ch) {
      return oauthError("invalid_grant", "The code is wrong, used by another client, or expired.");
    }
    return tokens(env, tag, code.aud as string);
  }
  if (grant === "refresh_token") {
    const refresh = await unseal(env, form.get("refresh_token") ?? "", "refresh");
    if (!refresh || refresh.c !== tag) return oauthError("invalid_grant", "The refresh token is wrong or expired.");
    return tokens(env, tag, refresh.aud as string);
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** /mcp/oauth/*: register, authorize and token. Off, like /mcp, until MCP_KEY is set. */
export async function mcpOAuth(request: Request, env: Env): Promise<Response> {
  if (!env.MCP_KEY) return notice("Not found", 404);
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OPEN });
  switch (url.pathname) {
    case "/mcp/oauth/register": return request.method === "POST" ? register(request, env) : notice("Method not allowed", 405);
    case "/mcp/oauth/authorize": return authorize(request, env, url.origin);
    case "/mcp/oauth/token": return request.method === "POST" ? token(request, env, url.origin) : notice("Method not allowed", 405);
    default: return notice("Not found", 404);
  }
}

/** The two metadata documents under /.well-known, also off until MCP_KEY is set. */
export function mcpOAuthMetadata(request: Request, env: Env): Response {
  if (!env.MCP_KEY) return notice("Not found", 404);
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OPEN });
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return protectedResource(url.origin);
  return authorizationServer(url.origin);
}
