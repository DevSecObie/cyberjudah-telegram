/**
 * The five entities an HTML serializer writes into text (&amp; &lt; &gt; &quot; &#39;), turned
 * back into their characters in one pass. Decoding them one after another would decode twice:
 * "&amp;lt;" (the text "&lt;") would come out as "<".
 */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
}
