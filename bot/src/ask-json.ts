/** Model-aware JSON requests use the same admission and answer path as streaming requests. */
export async function askJson(response: Response, q: string, start: number): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  if (!response.ok) return json({ ok: false, ...await response.json() as object }, response.status);
  let done: Record<string, unknown> | undefined, usage: unknown, error: unknown;
  // Consume incrementally: do not retain every delta, tool status or source packet in memory.
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const accept = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.done) done = event;
    if (event.usage) usage = event.usage;
    if (event.error) error = event.error;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += chunk.value;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) { accept(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    }
    accept(buffer);
  } finally { reader.releaseLock(); }
  if (error || !done) return json({ ok: false, reason: error ?? "unavailable" }, 503);
  const { done: _, ...answer } = done;
  return json({ ok: true, q: q.trim(), ...answer, ...(usage ? { usage } : {}), ms: Date.now() - start });
}
