#!/usr/bin/env node
// Stored public fixtures only. This command has no network or inference dependency.
import { readFileSync } from 'node:fs';
import { evaluateRecordedSuite, evaluateRecordedCompleteness, multipartRecords } from '../evals/grounding-eval.mjs';
const fixture = JSON.parse(readFileSync(new URL('../evals/grounding-recorded.json', import.meta.url), 'utf8'));
const report = evaluateRecordedSuite(fixture.cases);
console.log(JSON.stringify({ scope: 'fixture-evaluator-unit-check', modelCalls: 0, ...report, results: report.results.filter(result => !result.ok) }, null, 2));
if (report.passed !== report.cases) process.exitCode = 1;
const completeness = multipartRecords(fixture.cases).map(record => evaluateRecordedCompleteness(record));
console.log(JSON.stringify({ scope: 'extractive-multipart-fixture-check-not-live-quality', modelCalls: 0, cases: completeness.length, passed: completeness.filter(result => result.complete).length, failures: completeness.filter(result => !result.complete) }, null, 2));
if (completeness.some(result => !result.complete)) process.exitCode = 1;
