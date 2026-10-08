type Source = { title: string; author?: string; publisher?: string; year?: string; url: string; via?: string; accessed?: string; supports?: string };
type Teaching = { points?: string[]; quote?: string; teacher?: string; source: { kind: "class" | "history" | "site" | "note"; id?: string; title: string; date?: string; ts?: string; url: string } };
export type FcDetail = {
  title: string; start: number; end: number; period: string;
  date: { text: string; precision: string; calendar?: string; sourceRef?: string }; group: string; place?: string; region?: string; peoples?: string[]; tribes?: string[]; people?: string[];
  summary: string; account?: string[]; teaching?: Teaching[]; scriptures?: { ref: string; why?: string }[]; answer?: { ref: string; why?: string }[]; sources?: Source[];
  uncertainty?: string; disagreements?: { point: string; views: string[] }[];
  image?: { src: string; kind: "archival" | "generated"; caption: string; credit?: string; license?: string; sourceUrl?: string };
};
