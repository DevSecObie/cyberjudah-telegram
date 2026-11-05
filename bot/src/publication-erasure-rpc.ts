import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";
import { blockLocalPublications, eraseLocalPublications, publicationStore, unlinkLocalNativeAccount } from "./publication-erasure";

/** Named service-binding entrypoint only. No HTTP route exposes these administrative methods.
 * Bind only the reviewed counterpart Worker during an explicitly approved rollout. */
export class PublicationErasure extends WorkerEntrypoint<Env> {
  async describe() { return { version: 1 as const, store: publicationStore(this.env), nativeUnlink: 1 as const }; }
  block(identities: string[]) { return blockLocalPublications(this.env, identities); }
  erase(identities: string[]) { return eraseLocalPublications(this.env, identities); }
  unlinkNative(uid: string) { return unlinkLocalNativeAccount(this.env, uid); }
}
