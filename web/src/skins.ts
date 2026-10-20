import type { Skin, Model } from "./types";

// Pixel-only normalization is also used by the tests; no browser canvas needed.
export function normalizePixels(
  input: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (width !== 64 || ![32, 64].includes(height))
    throw new Error("Use a 64 × 64 or legacy 64 × 32 PNG skin.");
  const output = new Uint8ClampedArray(64 * 64 * 4);
  output.set(input);
  if (height === 32) {
    const faces = [
      [4, 0, 4, 0, 4, 4],
      [8, 0, 8, 0, 4, 4],
      [0, 4, 8, 4, 4, 12],
      [4, 4, 4, 4, 4, 12],
      [8, 4, 0, 4, 4, 12],
      [12, 4, 12, 4, 4, 12],
    ];
    for (const [sx, sy, dx, dy] of [
      [0, 16, 16, 48],
      [40, 16, 32, 48],
    ]) {
      for (const [a, b, c, d, w, h] of faces) {
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const from = ((sy + b + y) * 64 + sx + a + w - 1 - x) * 4;
            output.set(
              input.subarray(from, from + 4),
              ((dy + d + y) * 64 + dx + c + x) * 4,
            );
          }
      }
    }
    let opaque = true;
    for (let y = 0; y < 32; y++)
      for (let x = 32; x < 64; x++)
        if (input[(y * 64 + x) * 4 + 3] < 128) opaque = false;
    if (opaque)
      for (let y = 0; y < 32; y++)
        for (let x = 32; x < 64; x++) output[(y * 64 + x) * 4 + 3] = 0;
  }
  for (const [x0, y0, x1, y1] of [
    [0, 0, 32, 16],
    [0, 16, 64, 32],
    [16, 48, 48, 64],
  ])
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) output[(y * 64 + x) * 4 + 3] = 255;
  return output;
}

export async function decodeSkin(
  blob: Blob,
  model: Model,
  label: string,
): Promise<Skin> {
  if (blob.size > 2 * 1024 * 1024)
    throw new Error("Skin files must be smaller than 2 MB.");
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  if (
    header.length !== 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((byte, i) => header[i] !== byte)
  )
    throw new Error("Choose a PNG skin file.");
  const view = new DataView(header.buffer);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (width !== 64 || ![32, 64].includes(height))
    throw new Error("Use a 64 × 64 or legacy 64 × 32 PNG skin.");
  const image = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  image.close();
  const pixels = normalizePixels(
    ctx.getImageData(0, 0, 64, height).data,
    64,
    height,
  );
  ctx.putImageData(new ImageData(pixels, 64, 64), 0, 0);
  return {
    canvas,
    model: height === 32 ? "classic" : model,
    label,
    legacy: height === 32,
  };
}

const cache = new Map<string, Skin>();
export async function lookupSkin(
  name: string,
  signal: AbortSignal,
): Promise<Skin> {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name))
    throw new Error(
      "Enter a Java username (1–16 letters, numbers or underscores).",
    );
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  try {
    const response = await fetch(
      `https://playerdb.co/api/player/minecraft/${encodeURIComponent(name)}`,
      { signal: requestSignal },
    );
    if (response.status === 429)
      throw new Error(
        "Skin lookup is busy. Try again shortly, or upload a PNG.",
      );
    if (!response.ok)
      throw new Error(
        "Player not found or lookup unavailable. Check the name, or upload a PNG.",
      );
    const result = await response.json();
    const player = result.data?.player;
    if (!player?.id)
      throw new Error("Player not found. Check the name, or upload a PNG.");
    let model: Model = "classic";
    let url = player.skin_texture;
    const property = player.properties?.find(
      (p: { name: string }) => p.name === "textures",
    );
    if (property?.value) {
      const skin = JSON.parse(atob(property.value)).textures?.SKIN;
      if (skin?.metadata?.model === "slim") model = "slim";
      url = skin?.url || url;
    }
    const address = url
      ? new URL(url)
      : new URL(`https://crafthead.net/skin/${encodeURIComponent(player.id)}`);
    if (!["textures.minecraft.net", "crafthead.net"].includes(address.hostname))
      throw new Error("Unexpected skin host. Upload a PNG instead.");
    address.protocol = "https:";
    const texture = await fetch(address, { signal: requestSignal });
    if (!texture.ok)
      throw new Error(
        "Could not download this skin. Try a PNG upload instead.",
      );
    const skin = await decodeSkin(
      await texture.blob(),
      model,
      player.username || name,
    );
    signal.throwIfAborted();
    cache.set(key, skin);
    return skin;
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "TimeoutError")
    )
      throw new Error(
        "Skin service could not be reached. Try again or upload a PNG.",
      );
    throw error;
  }
}

export function faceUrl(skin: Skin) {
  const face = document.createElement("canvas");
  face.width = face.height = 32;
  const ctx = face.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(skin.canvas, 8, 8, 8, 8, 0, 0, 32, 32);
  ctx.drawImage(skin.canvas, 40, 8, 8, 8, 0, 0, 32, 32);
  return face.toDataURL();
}
