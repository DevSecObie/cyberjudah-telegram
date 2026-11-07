#!/usr/bin/env node
// Stored public fixtures only. This command has no network or inference dependency.
import { readFileSync } from 'node:fs';
import { evaluateRecordedSuite } from '../evals/grounding-eval.mjs';
const fixture = JSON.parse(readFileSync(new URL('../evals/grounding-recorded.json', import.meta.url), 'utf8'));
const report = evaluateRecordedSuite(fixture.cases);
console.log(JSON.stringify({ scope: 'fixture-evaluator-unit-check', modelCalls: 0, ...report, results: report.results.filter(result => !result.ok) }, null, 2));
if (report.passed !== report.cases) process.exitCode = 1;
