export function tokens(s: string): string[];
export function quote(s: string): string;
export function alternatives(term: string): string[];
export function parseQuery(q: string): { phrases: string[]; terms: string[] };
