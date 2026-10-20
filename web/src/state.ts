import type { Entry, Slot } from "./types";
export function freeSlot(entries: Entry[], slots: Slot[]) {
  return slots.find((slot) => !entries.some((entry) => entry.slot === slot.id))
    ?.id;
}
export function moveEntry(
  entries: Entry[],
  id: string,
  destination: string,
): Entry[] {
  const selected = entries.find((entry) => entry.id === id);
  if (!selected) return entries;
  return entries.map((entry) =>
    entry.id === id
      ? { ...entry, slot: destination }
      : entry.slot === destination
        ? { ...entry, slot: selected.slot }
        : entry,
  );
}
export function frameAt(milliseconds: number, durations: number[]) {
  const total = durations.reduce((a, b) => a + b, 0);
  let remaining = ((milliseconds % total) + total) % total;
  for (let index = 0; index < durations.length; index++) {
    if (remaining < durations[index]) return index;
    remaining -= durations[index];
  }
  return durations.length - 1;
}
export function frameStart(frame: number, durations: number[]) {
  return durations.slice(0, frame).reduce((a, b) => a + b, 0);
}
