import test from "node:test";
import assert from "node:assert/strict";
import { publicationLaunch } from "./publish-ci.mjs";
import { validateInitData } from "../bot/src/initdata.mjs";
test("approved CI publication requires a configured admin and signs a fresh server-side request", async () => {
  for (const env of [{}, { BOT_TOKEN: "test", ADMIN_IDS: "none" }, { ADMIN_IDS: "42" }, { BOT_TOKEN: "test", ADMIN_IDS: "9007199254740992" }]) await assert.rejects(publicationLaunch(env), /required/);
  const launch = await publicationLaunch({ BOT_TOKEN: "test", ADMIN_IDS: "42,73" });
  assert.equal((await validateInitData(launch, "test", 60)).user.id, 42);
  assert.equal(await validateInitData(launch, "another-token"), null);
});
