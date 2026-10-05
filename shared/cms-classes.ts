import { z } from 'zod';
import { CalendarDate, FileSha, Reason } from './cms';
export const VideoId = z.string().regex(/^[\w-]{11}$/);
const cell = (max: number) => z.string().max(max).refine(s => !/[\r\n\t]/.test(s), 'Use a single line without tabs');
export const ClassMetadata = z.strictObject({ video: VideoId, title: cell(500).trim().min(1), teacher: cell(200), date: z.union([CalendarDate,z.literal('')]) });
export const ClassSave = z.strictObject({ value: ClassMetadata, tableSha: FileSha, note: z.strictObject({file:z.string(),sha:FileSha}).nullable(), reason:Reason });
export const CLASS_HEADER = 'video\tteacher\tdate\ttitle';
export function parseClassTable(text: string) {
  const lines = text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  if (lines.shift() !== CLASS_HEADER) throw new Error('The class metadata table has an unsupported header.');
  const rows = new Map<string,z.infer<typeof ClassMetadata>>();
  for (const line of lines.filter(Boolean)) {
    const cells = line.split('\t'); if (cells.length !== 4) throw new Error('A class metadata row has the wrong number of columns.');
    const [video,teacher,date,title] = cells, value = ClassMetadata.parse({video,teacher,date,title});
    if (rows.has(video)) throw new Error('The class metadata table has a duplicate recording.');
    rows.set(video,value);
  }
  return rows;
}
export function writeClassTable(rows: ReturnType<typeof parseClassTable>, source = CLASS_HEADER+'\n') {
  const original = parseClassTable(source), seen = new Set<string>();
  const row = (r: z.infer<typeof ClassMetadata>) => [r.video,r.teacher,r.date,r.title].join('\t');
  let result = source.replace(/[^\r\n]+/g, (line, offset) => {
    if (offset === 0) return line; // Preserve the header, including a source BOM.
    const id = line.split('\t')[0], value = rows.get(id);
    seen.add(id);
    return !value ? '' : JSON.stringify(value) === JSON.stringify(original.get(id)) ? line : row(value);
  });
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  for (const [id, value] of rows) if (!seen.has(id)) result += (result.endsWith('\n') ? '' : newline) + row(value) + newline;
  return result;
}
/** Front matter changes leave the note body and stable source path untouched. */
export function updateClassNote(text: string, value: z.infer<typeof ClassMetadata>) {
  if (!text.startsWith('---\n')) throw new Error('The class note must keep its front matter.');
  const end = text.indexOf('\n---\n',4); if (end < 0) throw new Error('The class note must keep its front matter.');
  let front = text.slice(4,end);
  for (const field of ['title','teacher','date'] as const) {
    if (noteField(text, field) === value[field]) continue;
    const expression = new RegExp(`^${field}:.*$`,'m'), line = `${field}: ${JSON.stringify(value[field])}`;
    front = expression.test(front) ? front.replace(expression,()=>line) : front+'\n'+line;
  }
  return '---\n'+front+text.slice(end);
}
export function noteField(text: string, field: 'title'|'teacher'|'date') {
  const end = text.indexOf('\n---\n',4), front = text.startsWith('---\n') && end >= 0 ? text.slice(4,end) : '';
  const v = new RegExp(`^${field}:[ \t]*(.*)$`,'m').exec(front)?.[1]?.trim() ?? '';
  if (v.startsWith('"')) { try { return String(JSON.parse(v)); } catch { throw new Error(`Unsupported ${field} in the note's front matter.`); } }
  return v.startsWith("'") && v.endsWith("'") ? v.slice(1,-1).replaceAll("''", "'") : v;
}
