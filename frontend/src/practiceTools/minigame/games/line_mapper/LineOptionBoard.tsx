import type { Cell } from "../common/music";
import { FretboardCanvas, type FretboardMarker } from "../fretboard/FretboardCanvas";
import { MAX_FRET } from "../fretboard/fretboardMath";
import type { FretboardBoardPreset, FretboardInlayPreset } from "../../userSettings";

type Props = {
  line: Cell[];
  start: Cell;
  goal: Cell;
  invalidIndex?: number | null;
  showWrongHighlight?: boolean;
  showEndpoints?: boolean;
  maxVisibleFret?: number;
  height?: number;
  boardAspectRatio?: number;
  pocketRange?: {
    minFret: number;
    maxFret: number;
    label?: string;
  };
  showNoteLabels?: boolean;
  cellLabels?: Array<{ cell: Cell; text: string; color?: string }>;
  extraMarkers?: FretboardMarker[];
  fretLineWidth?: number;
  boardPreset?: FretboardBoardPreset;
  inlayPreset?: FretboardInlayPreset;
};

export function LineOptionBoard({
  line,
  start,
  goal,
  invalidIndex = null,
  showWrongHighlight = false,
  showEndpoints = true,
  maxVisibleFret = MAX_FRET,
  height = 128,
  boardAspectRatio = 3.2,
  pocketRange,
  showNoteLabels = false,
  cellLabels = [],
  extraMarkers = [],
  fretLineWidth = 1.9,
  boardPreset = "CLASSIC",
  inlayPreset = "DOT",
}: Props) {
  const markers: FretboardMarker[] = [
    ...extraMarkers,
    ...(showEndpoints ? [{ cell: start, kind: "start" as const }, { cell: goal, kind: "goal" as const }] : []),
    ...line
      .filter((cell) => !showEndpoints || (!(cell.string === start.string && cell.fret === start.fret) && !(cell.string === goal.string && cell.fret === goal.fret)))
      .map((cell) => ({ cell, kind: "selected" as const })),
  ];
  if (showWrongHighlight && invalidIndex !== null && line[invalidIndex]) {
    markers.push({ cell: line[invalidIndex], kind: "wrong" });
  }

  const board = (
    <FretboardCanvas
      maxFret={Math.max(4, maxVisibleFret)}
      height={height}
      boardAspectRatio={boardAspectRatio}
      markers={markers}
      disabled
      showNoteLabels={showNoteLabels}
      cellLabels={cellLabels}
      fretLineWidth={fretLineWidth}
      boardPreset={boardPreset}
      inlayPreset={inlayPreset}
      constraintRange={pocketRange}
    />
  );

  return (
    <div className="mg-line-option-board">{board}</div>
  );
}
