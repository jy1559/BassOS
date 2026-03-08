import type { Cell } from "../common/music";
import { cellToPc, sameCell } from "../common/music";
import type { HitDetectMode } from "../../userSettings";

export type FretboardGeometry = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stringYs: number[];
  fretXs: number[];
};

export type FretHitZone = {
  fret: number;
  xStart: number;
  xEnd: number;
  anchorX: number;
};

export type FretHitProfile = "DEFAULT" | "FRET_CENTERED";

export const MAX_FRET = 21;

export function fretPositionsReal(maxFret: number, widthPx: number): number[] {
  const raw = Array.from({ length: maxFret + 1 }, (_, n) => 1 - Math.pow(2, -n / 12));
  const max = raw[maxFret] || 1;
  return raw.map((v) => (v / max) * widthPx);
}

export function fretPositionsBlend(maxFret: number, widthPx: number, alpha = 0.82): number[] {
  const real = fretPositionsReal(maxFret, widthPx);
  const linear = Array.from({ length: maxFret + 1 }, (_, n) => (n / maxFret) * widthPx);
  return real.map((x, i) => alpha * x + (1 - alpha) * linear[i]);
}

export function stringYs(y0: number, y1: number): number[] {
  const h = y1 - y0;
  // string index 0 = E, and should be displayed at bottom.
  return [0, 1, 2, 3].map((i) => y1 - (h * (i + 1)) / 5);
}

export function buildGeometry(width: number, height: number, maxFret: number): FretboardGeometry {
  const safeMax = Math.max(1, Math.min(MAX_FRET, Math.floor(maxFret)));
  const padX = 20;
  const padY = 20;
  const x0 = padX;
  const y0 = padY;
  const x1 = width - padX;
  const y1 = height - padY;
  const fretXsRaw = fretPositionsBlend(safeMax, x1 - x0);
  const fretXs = fretXsRaw.map((x) => x0 + x);
  return {
    x0,
    y0,
    x1,
    y1,
    stringYs: stringYs(y0, y1),
    fretXs,
  };
}

function buildAnchors(geom: FretboardGeometry, mode: HitDetectMode): number[] {
  const { x0, fretXs } = geom;
  const anchors: number[] = [];
  const firstWidth = (fretXs[1] ?? x0 + 24) - fretXs[0];
  const nutAnchor =
    mode === "ZONE" ? fretXs[0] + firstWidth * 0.28 : mode === "HYBRID" ? fretXs[0] + firstWidth * 0.14 : fretXs[0] + firstWidth * 0.08;
  anchors.push(nutAnchor);

  // Fretted notes are anchored on fret-wire intersections.
  for (let fret = 1; fret < fretXs.length; fret += 1) {
    anchors.push(fretXs[fret]);
  }
  return anchors;
}

function captureRatioFromPrev(fret: number): number {
  if (fret <= 0) return 0;
  return 0.1;
}

function buildHitZonesWithProfile(geom: FretboardGeometry, mode: HitDetectMode = "WIRE", hitProfile: FretHitProfile = "DEFAULT"): FretHitZone[] {
  if (hitProfile === "FRET_CENTERED") {
    const anchors = buildAnchors(geom, mode);
    return anchors.map((anchorX, fret) => {
      const prevWire = geom.fretXs[Math.max(0, fret - 1)] ?? geom.x0;
      const curWire = geom.fretXs[fret] ?? prevWire;
      const nextWire = geom.fretXs[Math.min(geom.fretXs.length - 1, fret + 1)] ?? geom.x1;
      const start = fret <= 0 ? geom.x0 : (prevWire + curWire) / 2;
      const end = fret + 1 >= anchors.length ? geom.x1 : (curWire + nextWire) / 2;
      return {
        fret,
        xStart: Math.max(geom.x0, Math.min(start, end)),
        xEnd: Math.min(geom.x1, Math.max(start, end)),
        anchorX,
      };
    });
  }

  const anchors = buildAnchors(geom, mode);
  const zones: FretHitZone[] = [];
  const leftBoundaries: number[] = [];
  leftBoundaries[0] = geom.x0;

  for (let fret = 1; fret < anchors.length; fret += 1) {
    const prevWire = geom.fretXs[fret - 1] ?? geom.x0;
    const curWire = geom.fretXs[fret] ?? prevWire;
    const gap = Math.max(1, curWire - prevWire);
    const ratio = captureRatioFromPrev(fret);
    leftBoundaries[fret] = prevWire + gap * ratio;
  }

  for (let fret = 0; fret < anchors.length; fret += 1) {
    const start = Math.max(geom.x0, leftBoundaries[fret]);
    const end = Math.min(geom.x1, fret + 1 < anchors.length ? leftBoundaries[fret + 1] : geom.x1);
    zones.push({
      fret,
      xStart: Math.min(start, end),
      xEnd: Math.max(start, end),
      anchorX: anchors[fret],
    });
  }
  return zones;
}

export function buildHitZones(geom: FretboardGeometry, mode: HitDetectMode = "WIRE", hitProfile: FretHitProfile = "DEFAULT"): FretHitZone[] {
  return buildHitZonesWithProfile(geom, mode, hitProfile);
}

export function hitTestFretboard(
  px: number,
  py: number,
  geom: FretboardGeometry,
  mode: HitDetectMode = "WIRE",
  hitProfile: FretHitProfile = "DEFAULT"
): Cell | null {
  const { x0, y0, x1, y1, stringYs: ys } = geom;
  if (px < x0 || px > x1 || py < y0 || py > y1) return null;

  const avgStringGap = ys.length > 1 ? Math.abs(ys[0] - ys[1]) : Math.max(12, (y1 - y0) / 5);
  const upTol = Math.max(6, avgStringGap * 0.36);
  const downTol = Math.max(12, avgStringGap * 0.74);

  let nearestString = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ys.length; i += 1) {
    if (py < ys[i] - upTol || py > ys[i] + downTol) continue;
    const d = Math.abs(py - ys[i]);
    if (d < best) {
      best = d;
      nearestString = i;
    }
  }
  if (nearestString < 0) return null;

  const zones = buildHitZonesWithProfile(geom, mode, hitProfile);
  let fret = -1;
  for (const zone of zones) {
    if (px >= zone.xStart && px <= zone.xEnd) {
      fret = zone.fret;
      break;
    }
  }
  if (fret < 0) {
    let bestZoneDist = Number.POSITIVE_INFINITY;
    let bestZone = -1;
    for (const zone of zones) {
      const dx = Math.abs(px - zone.anchorX);
      if (dx < bestZoneDist) {
        bestZoneDist = dx;
        bestZone = zone.fret;
      }
    }
    if (bestZone >= 0 && bestZoneDist <= Math.max(10, firstHitWindow(geom))) {
      fret = bestZone;
    }
  }
  if (fret < 0) return null;
  fret = Math.max(0, Math.min(MAX_FRET, fret));
  return { string: nearestString, fret };
}

function firstHitWindow(geom: FretboardGeometry): number {
  const firstWidth = (geom.fretXs[1] ?? geom.x0 + 20) - geom.fretXs[0];
  return firstWidth * 0.35;
}

export function cellsInRange(minFret: number, maxFret: number): Cell[] {
  const out: Cell[] = [];
  const safeMin = Math.max(0, Math.min(MAX_FRET, Math.floor(minFret)));
  const safeMax = Math.max(safeMin, Math.min(MAX_FRET, Math.floor(maxFret)));
  for (let s = 0; s < 4; s += 1) {
    for (let f = safeMin; f <= safeMax; f += 1) {
      out.push({ string: s, fret: f });
    }
  }
  return out;
}

export function distanceKey(cell: Cell, anchor: Cell): [number, number] {
  return [Math.abs(cell.fret - anchor.fret), Math.abs(cell.string - anchor.string)];
}

export function manhattanL1(cell: Cell, anchor: Cell): number {
  return Math.abs(cell.fret - anchor.fret) + Math.abs(cell.string - anchor.string);
}

export function nearestByManhattan(cells: Cell[], anchor: Cell): Cell[] {
  if (!cells.length) return [];
  let best = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    best = Math.min(best, manhattanL1(cell, anchor));
  }
  return cells.filter((cell) => manhattanL1(cell, anchor) === best);
}

export function nearestSamePcCells(targetPc: number, anchor: Cell, pool: Cell[]): Cell[] {
  const samePc = pool.filter((cell) => cellToPc(cell) === targetPc);
  return nearestByManhattan(samePc, anchor);
}

export function containsCell(list: Cell[], cell: Cell): boolean {
  return list.some((item) => sameCell(item, cell));
}
