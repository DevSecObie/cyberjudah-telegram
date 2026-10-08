import { native } from "./platform";

/** The bundled webview has a local origin. Only CyberJudah API requests leave that origin;
 * packaged assets and third-party URLs keep their existing behavior. Cookie credentials
 * from the local webview are never forwarded to the server. */
if (native) {
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const source = input instanceof Request ? input.url : String(input);
    const url = new URL(source, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return fetchOriginal(input, init);
    const target = `https://cyberjudah.io${url.pathname}${url.search}`;
    return input instanceof Request
      ? fetchOriginal(new Request(target, input), { ...init, credentials: "omit" })
      : fetchOriginal(target, { ...init, credentials: "omit" });
  };
}
