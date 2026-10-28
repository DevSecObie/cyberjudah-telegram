import { native, nativeBuild } from "./platform";
import { nativeRequestURL } from "@shared/native-target.mjs";

/** The bundled webview has a local origin. Only CyberJudah API requests leave that origin;
 * packaged assets and third-party URLs keep their existing behavior. Cookie credentials
 * from the local webview are never forwarded to the server. */
if (native) {
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const source = input instanceof Request ? input.url : String(input);
    const target = nativeRequestURL(source, location.href, nativeBuild.environment);
    if (!target) return fetchOriginal(input, init);
    return input instanceof Request
      ? fetchOriginal(new Request(target, input), { ...init, credentials: "omit" })
      : fetchOriginal(target, { ...init, credentials: "omit" });
  };
}
