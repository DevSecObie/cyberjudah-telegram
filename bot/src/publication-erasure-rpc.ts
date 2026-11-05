import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";
import { blockLocalPublications, eraseLocalPublications, publicationStore } from "./publication-erasure";

/** Named service-binding entrypoint only. No HTTP route exposes these administrative methods.
 * Bind only the reviewed counterpart Worker during an explicitly approved rollout. */
export class PublicationErasure extends WorkerEntrypoint<Env> {
  async describe() { return { version: 1 as const, store: publicationStore(this.env) }; }
  block(identities: string[]) { return blockLocalPublications(this.env, identities); }
  erase(identities: string[]) { return eraseLocalPublications(this.env, identities); }
}
