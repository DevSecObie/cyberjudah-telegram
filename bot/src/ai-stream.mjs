async function readAIStream(stream, delta) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let pending = "", text = "", finished = false, usage, finishReason = "", bytes = 0;
  const line = (raw) => {
    if (!raw.startsWith("data:")) return;
    const data = raw.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    const value = JSON.parse(data);
    if (value.error) throw new Error("AI_STREAM_FAILED");
    if (value.usage) usage = value.usage;
    const piece = value.response ?? value.choices?.[0]?.delta?.content;
    if (typeof piece === "string") {
      text += piece;
      delta(piece);
    }
    if (value.choices?.[0]?.finish_reason) {
      finishReason = value.choices[0].finish_reason;
      finished = true;
    }
  };
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 2e6) throw new Error("AI_STREAM_TOO_LARGE");
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const item of lines) line(item.replace(/\r$/, ""));
      if (done) {
        line(pending);
        break;
      }
    }
    if (!finished) throw new Error("AI_STREAM_INCOMPLETE");
    return { response: text, usage, ...finishReason ? { choices: [{ message: { content: text }, finish_reason: finishReason }] } : {} };
  } finally {
    await reader.cancel().catch(() => void 0);
    reader.releaseLock();
  }
}
export {
  readAIStream
};
