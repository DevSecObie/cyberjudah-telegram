export function readAIStream(stream: ReadableStream<Uint8Array>, delta: (text: string) => void): Promise<Record<string, unknown>>;
