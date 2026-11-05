import type { Env } from "./env";
import { EMBED_MODEL } from "./ai.mjs";
import { viaGateway } from "./providers";

// Shared embedding helper kept independent of Ask/resource route initialization.
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 100) }, viaGateway(env)) as { data?: number[][] };
    out.push(...(res.data ?? []));
  }
  return out;
}
