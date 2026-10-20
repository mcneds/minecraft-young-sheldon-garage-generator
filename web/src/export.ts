import type { CastRenderer } from "./renderer";
export async function exportGif(
  renderer: CastRenderer,
  size: number,
  signal: AbortSignal,
  progress: (value: number, label: string) => void,
): Promise<Blob> {
  const worker = new Worker(new URL("./encode.worker.ts", import.meta.url), {
    type: "module",
  });
  let id = 0;
  const pending = new Map<
    number,
    { resolve: (data: ArrayBuffer) => void; reject: (error: Error) => void }
  >();
  const fail = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.onmessage = (event) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.data);
  };
  worker.onerror = (event) =>
    fail(new Error(event.message || "GIF encoding failed."));
  const abort = () => {
    worker.terminate();
    fail(new DOMException("Export cancelled", "AbortError"));
  };
  signal.addEventListener("abort", abort, { once: true });
  const request = (
    type: string,
    values: Record<string, unknown> = {},
    data?: ArrayBuffer,
  ) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      signal.throwIfAborted();
      const key = ++id;
      pending.set(key, { resolve, reject });
      worker.postMessage(
        { id: key, type, ...values, data },
        data ? [data] : [],
      );
    });
  try {
    signal.throwIfAborted();
    const count = 8,
      sampleSize = 128,
      samples = new Uint8Array(count * sampleSize * sampleSize * 4);
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      progress((i / count) * 0.1, "Choosing a shared color palette…");
      const frame = Math.round(
        (i * (renderer.manifest.frames - 1)) / (count - 1),
      );
      const canvas = await renderer.render(frame, sampleSize);
      samples.set(
        canvas.getContext("2d")!.getImageData(0, 0, sampleSize, sampleSize)
          .data,
        i * sampleSize * sampleSize * 4,
      );
    }
    await request("init", {}, samples.buffer);
    for (let frame = 0; frame < renderer.manifest.frames; frame++) {
      signal.throwIfAborted();
      const canvas = await renderer.render(frame, size);
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, size, size);
      await request(
        "frame",
        {
          width: size,
          height: size,
          delay: renderer.manifest.durations[frame],
        },
        pixels.data.buffer as ArrayBuffer,
      );
      progress(
        0.1 + (0.9 * (frame + 1)) / renderer.manifest.frames,
        `Rendering frame ${frame + 1} of ${renderer.manifest.frames}`,
      );
    }
    const bytes = await request("finish");
    return new Blob([bytes], { type: "image/gif" });
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
    pending.clear();
  }
}
