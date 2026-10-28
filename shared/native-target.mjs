/** Native targets are build-time choices, never an arbitrary URL supplied by a deep link. */
const targets = Object.freeze({
  production: Object.freeze({ environment: "production", appId: "io.cyberjudah.app", appName: "CyberJudah", origin: "https://cyberjudah.io", syncScope: "production", profile: "free-study", paidAsk: false }),
  staging: Object.freeze({ environment: "staging", appId: "io.cyberjudah.app.staging", appName: "CyberJudah Staging", origin: "https://cyberjudah-telegram-staging.oisrae1.workers.dev", syncScope: "staging", profile: "linked-ask-test", paidAsk: true }),
});
export function nativeTarget(environment = "production") {
  if (!Object.hasOwn(targets, environment)) throw new Error(`Unknown native environment: ${environment}`);
  return targets[environment];
}
export function nativeAccountURL(environment, code) {
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error("Invalid device sign-in code");
  return `${nativeTarget(environment).origin}/app/settings/account?device=${code}`;
}
/** Route local API calls only. Packaged assets, external URLs and their credentials stay put. */
export function nativeRequestURL(source, localHref, environment) {
  const local = new URL(localHref), url = new URL(source, local);
  const workerPath = url.pathname.startsWith("/api/") || url.pathname === "/bs/v1/bibles/KJV/search";
  if (url.protocol !== local.protocol || url.host !== local.host || !workerPath) return null;
  return `${nativeTarget(environment).origin}${url.pathname}${url.search}`;
}
