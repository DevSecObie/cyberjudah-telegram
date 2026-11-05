import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/account-deletion-readiness.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/account-deletion-readiness.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { assertNativeAccountDeletionReady, assertTelegramAccountDeletionReady } = await import(out);

for (const native of [undefined, 'false', 'TRUE', 'true']) {
  for (const telegram of [undefined, 'true']) {
    test(`independent gates: native=${native}, Telegram/browser=${telegram}`, () => {
      const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8089', ACCOUNT_DATA_DELETION_READY: 'true',
        NATIVE_ACCOUNT_DELETION_READY: native, TELEGRAM_ACCOUNT_DELETION_READY: telegram };
      for (const [check, ready] of [[assertNativeAccountDeletionReady, native], [assertTelegramAccountDeletionReady, telegram]]) {
        if (ready === 'true') assert.doesNotThrow(() => check(env));
        else assert.throws(() => check(env), /account_deletion_not_ready/);
      }
    });
  }
}
test('both channels still require Firestore even when their own flag is true', () => {
  for (const check of [assertNativeAccountDeletionReady, assertTelegramAccountDeletionReady]) {
    assert.throws(() => check({ NATIVE_ACCOUNT_DELETION_READY: 'true', TELEGRAM_ACCOUNT_DELETION_READY: 'true' }), /account_deletion_not_ready/);
  }
});
