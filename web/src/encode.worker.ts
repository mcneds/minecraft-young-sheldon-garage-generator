import { GIFEncoder, quantize, applyPalette, type Palette } from "gifenc";
let encoder = GIFEncoder();
let palette: Palette;
let first = true;
self.onmessage = (event: MessageEvent) => {
  const { id, type, data, width, height, delay } = event.data;
  try {
    if (type === "init") {
      encoder = GIFEncoder();
      palette = quantize(new Uint8Array(data), 256);
      first = true;
    } else if (type === "frame") {
      const indexed = applyPalette(new Uint8Array(data), palette);
      encoder.writeFrame(indexed, width, height, {
        palette: first ? palette : undefined,
        delay,
        repeat: 0,
        dispose: 2,
      });
      first = false;
    } else if (type === "finish") {
      encoder.finish();
      const bytes = encoder.bytesView().slice();
      self.postMessage(
        { id, data: bytes.buffer },
        { transfer: [bytes.buffer] },
      );
      return;
    }
    self.postMessage({ id });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
