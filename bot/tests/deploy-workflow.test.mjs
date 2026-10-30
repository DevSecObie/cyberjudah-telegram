import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const step = name => workflow.split(`      - name: ${name}\n`)[1]?.split("\n      - ")[0];
const script = name => {
  const run = step(name)?.split("        run: |\n")[1];
  assert.ok(run, `missing shell step: ${name}`);
  const lines = run.split("\n");
  const end = lines.findIndex(line => line.trim() && !line.startsWith("          "));
  return lines.slice(0, end < 0 ? undefined : end).map(line => line.replace(/^          /, "")).join("\n").replace(/\$\{\{[^}]+\}\}/g, "");
};
const run = (name, cwd, env) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", script(name)], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
const preflightEnv = { CLOUDFLARE_API_TOKEN: "fixture", CLOUDFLARE_ACCOUNT_ID: "fixture", BOT_TOKEN: "fixture", WEBHOOK_SECRET: "fixture", PRIVACY_KEY: "fixture", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "", TELEGRAM_LOGIN_CLIENT_ID: "", TELEGRAM_LOGIN_CLIENT_SECRET: "" };

test("production secret preflight rejects missing privacy key and partial optional groups", () => {
  assert.equal(run("Check the repository secrets", undefined, preflightEnv).status, 0);
  for (const env of [{ PRIVACY_KEY: "" }, { VAPID_PUBLIC_KEY: "fixture" }, { TELEGRAM_LOGIN_CLIENT_ID: "fixture" }, { TELEGRAM_LOGIN_CLIENT_SECRET: "fixture" }]) {
    const result = run("Check the repository secrets", undefined, { ...preflightEnv, ...env });
    assert.notEqual(result.status, 0, JSON.stringify(Object.keys(env)));
    assert.match(result.stdout, /::error::/);
  }
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberjudah-deploy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "scripts")); fs.mkdirSync(path.join(dir, "bin"));
  for (const file of ["d1-id.sh", "kv-id.sh"]) fs.writeFileSync(path.join(dir, "scripts", file), "echo fixture-id\n");
  fs.writeFileSync(path.join(dir, "scripts/prepare-assets.sh"), "exit 0\n");
  fs.writeFileSync(path.join(dir, "scripts/load-search.mjs"), "throw new Error('simulated index import failure');\n");
  fs.writeFileSync(path.join(dir, "bin/sed"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "bin/npx"), `#!/bin/sh
case "$*" in
  "wrangler vectorize list") echo cyberjudah-teachings ;;
  "wrangler r2 bucket list") echo cyberjudah-audio ;;
  "wrangler deployments status --json") echo '{"versions":[{"version_id":"previous-version"}]}' ;;
  "wrangler deploy") [ "$FAIL_DEPLOY" = 1 ] && exit 1; echo https://fixture.workers.dev ;;
  "wrangler rollback "*) echo "$*" >> "$ROLLBACK_LOG" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  return { dir, env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: path.join(dir, "outputs"), ROLLBACK_LOG: path.join(dir, "rollback"), PREVIOUS: "previous-version", FAIL_DEPLOY: "" } };
}

test("a search import failure after replacement retains the marker needed to roll back", t => {
  const { dir, env } = fixture(t);
  assert.equal(run("Deploy the worker", dir, env).status, 0);
  assert.notEqual(run("Load the search index", dir, env).status, 0);
  const output = fs.readFileSync(env.GITHUB_OUTPUT, "utf8");
  assert.match(output, /^previous=previous-version$/m);
  assert.match(output, /^live=true$/m);
  assert.match(step("Roll back a release that failed after going live"), /if: failure\(\) && steps\.deploy\.outputs\.live == 'true'/);
  assert.equal(run("Roll back a release that failed after going live", dir, env).status, 0);
  assert.match(fs.readFileSync(env.ROLLBACK_LOG, "utf8"), /wrangler rollback previous-version/);
});

test("a failed Worker replacement never marks a release as live", t => {
  const { dir, env } = fixture(t);
  assert.notEqual(run("Deploy the worker", dir, { ...env, FAIL_DEPLOY: "1" }).status, 0);
  assert.doesNotMatch(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), /^live=true$/m);
});
