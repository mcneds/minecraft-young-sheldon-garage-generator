import { describe, expect, it } from "vitest";
import { frameAt, frameStart, freeSlot, moveEntry } from "../src/state";
import { normalizePixels } from "../src/skins";
import type { Entry, Slot } from "../src/types";
const slots = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }) as Slot);
const entry = (id: string, slot: string): Entry => ({
  id,
  slot,
  name: "Duplicate",
  model: "auto",
});
describe("cast assignment", () => {
  it.each([1, 2, 3, 12])(
    "fills %i unique positions without merging duplicate names",
    (count) => {
      const entries: Entry[] = [];
      for (let i = 0; i < count; i++)
        entries.push(entry(String(i), freeSlot(entries, slots)!));
      expect(new Set(entries.map((e) => e.slot)).size).toBe(count);
      expect(freeSlot(entries, slots)).toBe(
        count === 12 ? undefined : String(count),
      );
    },
  );
  it("swaps occupied positions and moves into empty positions without repacking", () => {
    let entries = [entry("a", "0"), entry("b", "1"), entry("c", "2")];
    entries = moveEntry(entries, "a", "1");
    expect(entries.map((e) => e.slot)).toEqual(["1", "0", "2"]);
    entries = moveEntry(entries, "b", "8");
    expect(entries.map((e) => e.slot)).toEqual(["1", "8", "2"]);
    entries = entries.filter((e) => e.id !== "a");
    expect(freeSlot(entries, slots)).toBe("0");
  });
});
describe("source timing", () => {
  const durations = [30, 40, 30];
  it("uses GIF delays and wraps at the full duration", () => {
    expect(
      [0, 29, 30, 69, 70, 99, 100, 130].map((t) => frameAt(t, durations)),
    ).toEqual([0, 0, 1, 1, 2, 2, 0, 1]);
    expect(frameStart(2, durations)).toBe(70);
  });
});
describe("vanilla skin normalization", () => {
  it("forces base parts opaque but preserves transparent overlays", () => {
    const source = new Uint8ClampedArray(64 * 64 * 4);
    const result = normalizePixels(source, 64, 64);
    expect(result[(8 * 64 + 8) * 4 + 3]).toBe(255);
    expect(result[(8 * 64 + 40) * 4 + 3]).toBe(0);
    expect(result[(55 * 64 + 20) * 4 + 3]).toBe(255);
    expect(source.every((v) => v === 0)).toBe(true);
  });
  it("mirrors legacy arm and leg faces using original pixels", () => {
    const source = new Uint8ClampedArray(64 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        source[i] = x;
        source[i + 1] = y;
        source[i + 3] = 255;
      }
    const result = normalizePixels(source, 64, 32);
    expect([
      ...result.slice((52 * 64 + 20) * 4, (52 * 64 + 20) * 4 + 4),
    ]).toEqual([7, 20, 0, 255]);
    expect([
      ...result.slice((52 * 64 + 36) * 4, (52 * 64 + 36) * 4 + 4),
    ]).toEqual([47, 20, 0, 255]);
    expect(result[(8 * 64 + 40) * 4 + 3]).toBe(0);
  });
  it("rejects unsupported dimensions", () => {
    expect(() => normalizePixels(new Uint8ClampedArray(), 128, 128)).toThrow(
      /64/,
    );
  });
});

describe("automatic arm width with upload overrides", () => {
  it("uses profile metadata for custom PNGs, preserving classic legacy mapping and explicit overrides", async () => {
    const { activeModel, activeSkin } = await import("../src/types");
    const custom = {
      canvas: {} as HTMLCanvasElement,
      model: "classic" as const,
      label: "custom",
      legacy: false,
    };
    const profile = { ...custom, model: "slim" as const, label: "account" };
    const actor: Entry = {
      ...entry("a", "0"),
      uploaded: custom,
      fetched: profile,
    };
    expect(activeSkin(actor)).toBe(custom);
    expect(activeModel(actor)).toBe("slim");
    expect(
      activeModel({ ...actor, uploaded: { ...custom, legacy: true } }),
    ).toBe("classic");
    expect(activeModel({ ...actor, model: "classic" })).toBe("classic");
  });
});

it("rejects a truncated PNG before trying to decode an image", async () => {
  const { decodeSkin } = await import("../src/skins");
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]);
  await expect(decodeSkin(blob, "classic", "broken.png")).rejects.toThrow(
    "Choose a PNG skin file",
  );
});
