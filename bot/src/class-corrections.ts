import { z } from 'zod';
import type { Env } from './env';
import { dataJson } from './data';
import { ClassMetadata, VideoId } from '../../shared/cms-classes';
const Corrections = z.record(VideoId,ClassMetadata.omit({video:true}));
export async function classCorrections(env:Env) {
  try { return Corrections.parse(await dataJson<unknown>(env,'/api/classes/corrections.json')); }
  catch { return {}; }
}
export function applyClassCorrection<T extends {video:string;title:string;date:string;matchedTitle?:string}>(row:T, corrections:Awaited<ReturnType<typeof classCorrections>>):T {
  const correction=corrections[row.video];
  return correction?{...row,...correction,...(row.matchedTitle!==undefined?{matchedTitle:correction.title}:{})}:row;
}
