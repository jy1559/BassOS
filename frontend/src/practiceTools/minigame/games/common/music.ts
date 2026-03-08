export type Cell = { string: number; fret: number };

export const OPEN_MIDI = [28, 33, 38, 43]; // E1 A1 D2 G2

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToPc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function pcToName(pc: number): string {
  return NOTE_NAMES_SHARP[((pc % 12) + 12) % 12] ?? "C";
}

export function midiToName(midi: number): string {
  const pc = midiToPc(midi);
  const octave = Math.floor(midi / 12) - 1;
  return `${pcToName(pc)}${octave}`;
}

export function cellToMidi(cell: Cell): number {
  return OPEN_MIDI[cell.string] + cell.fret;
}

export function cellToPc(cell: Cell): number {
  return midiToPc(cellToMidi(cell));
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.string === b.string && a.fret === b.fret;
}
