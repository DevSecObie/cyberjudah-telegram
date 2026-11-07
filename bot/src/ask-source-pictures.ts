import type { Passage } from './ai.mjs';
import type { Env } from './env';
import { imageKey } from './images.mjs';
import portraits from '../../app/scripts/timeline-portraits.json';
import timeline from '../../app/src/data/timeline.json';
import leaders from '../../app/scripts/final-captivity/leaders.json';

const SITE = 'https://cyberjudah.io';
// These older library imports are outside the owner's Telegram picture brief.
const importedPortraits = new Set([...Object.keys(portraits.sources), 'herod-mat-14-1', 'herod-mat-2-1', 'augustus-luk-2-1']);
const approvedPortraits = new Set(portraits.ids.filter(id => !importedPortraits.has(id) && !Object.hasOwn(portraits.heldBack, id)));
const events = new Map(timeline.sections.flatMap(section => section.events.map(event => [event.slug, event] as const)));
const approvedLeaders = new Map(leaders.leaders.map(leader => [leader.id, leader]));
type Picture = { image: string; image_alt: string; credit?: string };

/** Only the exact library-approved portrait for an existing source identity; never a guessed image. */
function pictureFor(source: Passage): { path: string; credit?: string } | undefined {
  let url: URL;
  try { url = new URL(source.url, SITE); } catch { return; }
  if (url.origin !== SITE || url.username || url.password) return;
  const person = /^\/person\/([a-z0-9-]+)\/?$/.exec(url.pathname)?.[1];
  const eventId = /^\/timeline\/event\/([a-z0-9-]+)\/?$/.exec(url.pathname)?.[1];
  if (eventId && Object.hasOwn(portraits.notOn, eventId)) return;
  const event = eventId ? events.get(eventId) : undefined;
  const portrait = person ?? (event && 'portrait' in event ? event.portrait : undefined);
  if (typeof portrait === 'string' && approvedPortraits.has(portrait)) return { path: `people/${portrait}-256.webp` };
  const leader = event && 'leader' in event && typeof event.leader === 'string' ? approvedLeaders.get(event.leader) : undefined;
  if (leader) return { path: `${leader.photo}-256.webp`, credit: leader.credit.split(/[;,]/, 1)[0] };
}

/** Optional metadata only: source words, kinds, numbering and order are preserved. */
export async function withAskSourcePictures<T extends Passage>(env: Env, sources: T[]): Promise<(T & Partial<Picture>)[]> {
  const available = new Map<string, Promise<string | undefined>>();
  const image = (path: string) => {
    let work = available.get(path);
    if (!work) {
      work = (async () => {
        const key = imageKey(path);
        if (!key) return;
        try { if (await env.AUDIO?.head(key)) return `${SITE}/api/img/${path}`; } catch { /* Try the existing bundled copy. */ }
        try {
          const response = await env.ASSETS?.fetch(new Request(`https://assets.local/app/${path}`, { method: 'HEAD' }));
          // A missing asset may return the SPA shell with HTTP 200: that is not a picture.
          if (response?.ok && response.headers.get('content-type')?.split(';')[0].trim() === 'image/webp') return `${SITE}/app/${path}`;
        } catch { /* A missing picture never prevents an answer. */ }
      })();
      available.set(path, work);
    }
    return work;
  };
  return Promise.all(sources.map(async source => {
    // Upstream or generated image fields do not establish library approval.
    const clean = { ...source } as T & Partial<Picture>;
    delete clean.image; delete clean.image_alt; delete clean.credit;
    const approved = pictureFor(clean);
    if (!approved) return clean;
    const src = await image(approved.path);
    // The existing library uses decorative empty alt for these portraits. Do not invent a caption.
    return src ? { ...clean, image: src, image_alt: '', ...(approved.credit ? { credit: approved.credit } : {}) } : clean;
  }));
}
