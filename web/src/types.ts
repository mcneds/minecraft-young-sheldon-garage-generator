export type Model = "classic" | "slim";
export interface Slot {
  id: string;
  label: string;
  role: string;
  position: number[];
  models: Record<Model, string>;
  appearance?: { start_frame: number; end_frame: number; duration_ms: number };
}
export interface Manifest {
  version: number;
  width: number;
  height: number;
  frames: number;
  durations: number[];
  animationFps: number;
  fov: number;
  validated: boolean;
  slots: Slot[];
  cameras: { position: number[]; quaternion: number[] }[];
  atlases: Record<
    "backdrop" | "foreground",
    { url: string; start: number; count: number }[]
  >;
  atlasColumns: number;
}
export interface Skin {
  canvas: HTMLCanvasElement;
  model: Model;
  label: string;
  legacy: boolean;
}
export interface Entry {
  id: string;
  name: string;
  slot: string;
  model: "auto" | Model;
  fetched?: Skin;
  uploaded?: Skin;
  loading?: boolean;
  error?: string;
}
export const activeSkin = (entry: Entry) => entry.uploaded || entry.fetched;
export function activeModel(entry: Entry): Model {
  if (entry.model !== "auto") return entry.model;
  if (activeSkin(entry)?.legacy) return "classic";
  return entry.fetched?.model || activeSkin(entry)?.model || "classic";
}
