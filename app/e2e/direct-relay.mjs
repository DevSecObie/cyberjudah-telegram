/** The browser can supply a path and query, never the relay's destination or Host header. */
export function loopbackRequestOptions(target, req) {
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port) throw new Error("Direct Ask relay requires a loopback Worker URL");
  const path = req.url?.startsWith("/") && !req.url.startsWith("//") ? req.url : "/";
  return { hostname: "127.0.0.1", port: target.port, path, method: req.method,
    headers: { ...req.headers, host: target.host }, agent: false };
}
