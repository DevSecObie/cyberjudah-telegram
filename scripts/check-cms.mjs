#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkAll, checkEvent, loadCorpus } from '../app/scripts/final-captivity/check.mjs';
import { SourceList } from '../shared/cms.ts';
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const root = 'app/scripts/final-captivity/';
const { problems } = checkAll();
const sources = read('bot/data/ask-sources.json');
if (!Number.isInteger(sources.revision) || sources.revision < 0 || !SourceList.safeParse(sources.hosts).success) problems.push('Outside-source configuration is invalid.');
// Corpus checks are deliberately performed on changed published records. Historical
// untouched records keep their existing review status; edits do not bypass quote checks.
const base = process.env.CMS_BASE;
if (base) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('CMS_BASE must be a commit SHA');
  const before = JSON.parse(execFileSync('git', ['show', `${base}:${root}events.json`], { encoding: 'utf8', maxBuffer: 4_000_000 }));
  const changed = read(root + 'events.json').filter(event => JSON.stringify(event) !== JSON.stringify(before.find(old => old.slug === event.slug)));
  if (changed.length) {
    const corpus = loadCorpus(process.env.CJ_ROOT);
    if (!corpus) throw new Error('Changed Timeline events require the transcript corpus (CJ_ROOT).');
    const periods = read(root + 'periods.json').periods, leaders = read(root + 'leaders.json').leaders;
    for (const event of changed) problems.push(...checkEvent(event, periods, { corpus, leaders }));
    console.log(`Checked ${changed.length} changed published events against the corpus.`);
  }
}
for (const problem of problems) console.error(problem);
if (problems.length) process.exit(1);
console.log('CMS source validation passed.');
