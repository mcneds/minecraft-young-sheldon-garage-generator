declare module "gifenc" {
  export type Palette = number[][];
  export function quantize(data: Uint8Array, count: number): Palette;
  export function applyPalette(data: Uint8Array, palette: Palette): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      data: Uint8Array,
      width: number,
      height: number,
      options: {
        palette?: Palette;
        delay: number;
        repeat?: number;
        dispose?: number;
      },
    ): void;
    finish(): void;
    bytesView(): Uint8Array;
  };
}
