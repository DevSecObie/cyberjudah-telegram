import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The bot's source and its setup script, read as text: bot.ts imports its neighbours without
// file extensions (as Workers bundles them), so it is not loaded here.
const bot = readFileSync(new URL("../src/bot.ts", import.meta.url), "utf8");
const setup = readFileSync(new URL("../scripts/setup.mjs", import.meta.url), "utf8");
const menu = [...setup.matchAll(/\{ command: "([a-z]+)"/g)].map((m) => m[1]);
const handled = new Set([...bot.matchAll(/bot\.command\("([a-z]+)"/g)].map((m) => m[1]));
const help = /const HELP = \[([\s\S]*?)\]\.join/.exec(bot)[1];

test("every command in the bot's menu has a handler", () => {
  assert.ok(menu.length >= 10);
  for (const c of menu) assert.ok(handled.has(c), `/${c} is in setMyCommands but has no handler`);
});

test("the privacy policy, the terms and payment support are in the menu and in /help", () => {
  for (const c of ["privacy", "terms", "paysupport"]) {
    assert.ok(menu.includes(c), `/${c} in setMyCommands`);
    assert.ok(help.includes(`"/${c} — `), `/${c} in HELP`);
  }
});
