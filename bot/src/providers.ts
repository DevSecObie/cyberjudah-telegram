import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";

/**
 * How the Worker reaches its models. Claude is the main model for Ask; Workers AI (Llama) is the
 * backup, used when there is no Claude key or when Claude fails.
 *
 * Cloudflare AI Gateway (AI_GATEWAY, the gateway's name; "default" is created by Cloudflare on its
 * first request) logs, counts and can rate-limit every call in one place on Cloudflare's dashboard:
 * - Workers AI calls pass { gateway: { id } } to env.AI.run; the binding's own account identity
 *   authenticates them, so nothing more is needed (Cloudflare docs: AI Gateway, Workers Bindings).
 * - Claude calls go to the gateway's Anthropic endpoint, env.AI.gateway(id).getUrl("anthropic").
 *   An authenticated gateway (the default one is) needs a token in the cf-aig-authorization
 *   header (docs: Authenticated Gateway), so Claude goes through it only when CF_AIG_TOKEN is set,
 *   and directly otherwise.
 * ANTHROPIC_BASE_URL, for the end-to-end tests' stand-in, takes precedence over both.
 */
export async function claude(env: Env): Promise<Anthropic> {
  let baseURL = env.ANTHROPIC_BASE_URL || undefined;
  let viaAig = false;
  if (!baseURL && env.AI_GATEWAY && env.CF_AIG_TOKEN) {
    try { baseURL = await env.AI.gateway(env.AI_GATEWAY).getUrl("anthropic"); viaAig = true; }
    catch (e) { console.error(JSON.stringify({ event: "ai_gateway_url_failed", message: (e as Error).message?.slice(0, 120) })); }
  }
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(baseURL ? { baseURL } : {}),
    ...(viaAig ? { defaultHeaders: { "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}` } } : {}),
  });
}

/** Options for env.AI.run: through the AI Gateway when one is named. */
export const viaGateway = (env: Env) => (env.AI_GATEWAY ? { gateway: { id: env.AI_GATEWAY } } : undefined);

/**
 * Whether a failure from Claude means Claude cannot answer right now (overloaded, rate limited,
 * a server error, the connection lost, or a key that no longer works), so the backup should.
 * A request Claude rejected as malformed (400) is a bug, not an outage: it is not hidden.
 */
export function claudeUnavailable(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  const s = e.status;
  return s === undefined || s === 401 || s === 403 || s === 408 || s === 409 || s === 429 || s >= 500;
}
