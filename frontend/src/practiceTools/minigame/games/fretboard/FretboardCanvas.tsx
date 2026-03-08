import { useEffect, useMemo, useRef, useState } from "react";
import type { FretboardBoardPreset, FretboardInlayPreset, HitDetectMode } from "../../userSettings";
import type { Cell } from "../common/music";
import { cellToPc, pcToName } from "../common/music";
import { buildGeometry, buildHitZones, hitTestFretboard, type FretHitProfile } from "./fretboardMath";

export type MarkerKind =
  | "target"
  | "correct"
  | "wrong"
  | "start"
  | "goal"
  | "selected"
  | "anchor"
  | "root_anchor"
  | "lm_shown_tone"
  | "solution"
  | "lm_start_primary"
  | "lm_goal_secondary";

export type FretboardMarker = {
  cell: Cell;
  kind: MarkerKind;
};

type Props = {
  maxFret: number;
  height?: number;
  boardAspectRatio?: number;
  markers?: FretboardMarker[];
  onCellClick?: (cell: Cell) => void;
  disabled?: boolean;
  detectMode?: HitDetectMode;
  hitProfile?: FretHitProfile;
  showHitZones?: boolean;
  showNoteLabels?: boolean;
  cellLabels?: Array<{ cell: Cell; text: string; color?: string }>;
  fretLineWidth?: number;
  boardPreset?: FretboardBoardPreset;
  inlayPreset?: FretboardInlayPreset;
  constraintRange?: {
    minFret: number;
    maxFret: number;
    label?: string;
  };
};

const inlayFrets = [3, 5, 7, 9, 12, 15, 17, 19, 21];
const stringNames = ["E", "A", "D", "G"];
const stringThickness = [4.4, 3.2, 2.3, 1.5];
const BOARD_ASPECT_RATIO = 5.6; // width / height
const BOARD_MAX_WIDTH = 3200;

const boardPalette: Record<FretboardBoardPreset, { start: string; mid: string; end: string; grainAlpha: number; overlay: string }> = {
  CLASSIC: { start: "#5a3a24", mid: "#68442d", end: "#563824", grainAlpha: 1, overlay: "rgba(18, 12, 8, 0.14)" },
  MAPLE: { start: "#8c6a47", mid: "#a37e55", end: "#7f5f40", grainAlpha: 0.72, overlay: "rgba(30, 20, 12, 0.09)" },
  DARK: { start: "#36251b", mid: "#2d1f18", end: "#241912", grainAlpha: 0.62, overlay: "rgba(10, 8, 7, 0.18)" },
};

function sideGutterByWidth(width: number): number {
  if (width >= 1400) return 14;
  if (width >= 1100) return 12;
  if (width >= 800) return 10;
  if (width >= 620) return 8;
  return 0;
}

function markerColor(kind: MarkerKind): string {
  if (kind === "correct") return "#18a56f";
  if (kind === "wrong") return "#c84747";
  if (kind === "start") return "#ffd166";
  if (kind === "goal") return "#56b3ff";
  if (kind === "lm_start_primary") return "#2fbe6f";
  if (kind === "lm_goal_secondary") return "#56b3ff";
  if (kind === "anchor") return "#f5b041";
  if (kind === "root_anchor") return "#e67e22";
  if (kind === "lm_shown_tone") return "#d98a2b";
  if (kind === "solution") return "#47b7c8";
  if (kind === "selected") return "#7c86f8";
  return "#2dcad0";
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawInlay(ctx: CanvasRenderingContext2D, preset: FretboardInlayPreset, x: number, y: number, isDouble: boolean) {
  const drawOne = (cy: number) => {
    if (preset === "BLOCK") {
      ctx.beginPath();
      ctx.roundRect(x - 7, cy - 4, 14, 8, 2.5);
      ctx.fill();
      return;
    }
    if (preset === "TRIANGLE") {
      ctx.beginPath();
      ctx.moveTo(x, cy - 6);
      ctx.lineTo(x - 6, cy + 5);
      ctx.lineTo(x + 6, cy + 5);
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.arc(x, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  };

  if (isDouble) {
    drawOne(y - 24);
    drawOne(y + 24);
    return;
  }
  drawOne(y);
}

function drawWoodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alphaScale = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // subtle horizontal grain lines
  for (let i = 0; i < 44; i += 1) {
    const yPos = y + (h / 44) * i + Math.sin(i * 0.9) * 0.9;
    const alpha = (0.05 + (i % 3) * 0.015) * alphaScale;
    ctx.strokeStyle = `rgba(25, 12, 6, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yPos);
    ctx.bezierCurveTo(
      x + w * 0.22,
      yPos + Math.sin(i * 0.7) * 2.2,
      x + w * 0.66,
      yPos - Math.sin(i * 0.4) * 1.6,
      x + w,
      yPos + Math.sin(i * 0.3) * 1.1
    );
    ctx.stroke();
  }

  // low-contrast knots
  for (let i = 0; i < 3; i += 1) {
    const cx = x + w * (0.2 + i * 0.28);
    const cy = y + h * (0.25 + (i % 2) * 0.37);
    const r = 14 + i * 4;
    const knot = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    knot.addColorStop(0, `rgba(35, 16, 8, ${(0.11 * alphaScale).toFixed(3)})`);
    knot.addColorStop(1, "rgba(35, 16, 8, 0)");
    ctx.fillStyle = knot;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function FretboardCanvas({
  maxFret,
  markers = [],
  onCellClick,
  disabled = false,
  height = 260,
  boardAspectRatio = BOARD_ASPECT_RATIO,
  detectMode = "WIRE",
  hitProfile = "DEFAULT",
  showHitZones = false,
  showNoteLabels = false,
  cellLabels = [],
  fretLineWidth = 1.9,
  boardPreset = "CLASSIC",
  inlayPreset = "DOT",
  constraintRange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(820);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setAvailableWidth(Math.max(180, Math.floor(node.clientWidth)));
    });
    observer.observe(node);
    setAvailableWidth(Math.max(180, Math.floor(node.clientWidth)));
    return () => observer.disconnect();
  }, []);

  const boardSize = useMemo(() => {
    const safeAvailable = Math.max(180, Math.floor(availableWidth));
    const gutter = sideGutterByWidth(safeAvailable);
    const usableWidth = Math.max(180, safeAvailable - gutter * 2);
    let drawWidth = Math.min(usableWidth, BOARD_MAX_WIDTH);
    const maxHeight = Math.max(90, Math.floor(height));
    const safeAspectRatio = Math.max(1.8, boardAspectRatio);
    const widthByHeight = Math.max(180, Math.floor(maxHeight * safeAspectRatio));
    drawWidth = Math.min(drawWidth, widthByHeight);
    const drawHeight = Math.max(90, Math.floor(drawWidth / safeAspectRatio));
    return { width: drawWidth, height: drawHeight };
  }, [availableWidth, boardAspectRatio, height]);

  const geom = useMemo(() => buildGeometry(boardSize.width, boardSize.height, maxFret), [boardSize.height, boardSize.width, maxFret]);
  const hitZones = useMemo(() => buildHitZones(geom, detectMode, hitProfile), [detectMode, geom, hitProfile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(boardSize.width * dpr);
    canvas.height = Math.floor(boardSize.height * dpr);
    canvas.style.width = `${boardSize.width}px`;
    canvas.style.height = `${boardSize.height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, boardSize.width, boardSize.height);
    const g = geom;

    const palette = boardPalette[boardPreset] ?? boardPalette.CLASSIC;
    const bg = ctx.createLinearGradient(0, 0, boardSize.width, boardSize.height);
    bg.addColorStop(0, palette.start);
    bg.addColorStop(0.5, palette.mid);
    bg.addColorStop(1, palette.end);
    ctx.fillStyle = bg;
    ctx.fillRect(g.x0 - 8, g.y0 - 8, g.x1 - g.x0 + 16, g.y1 - g.y0 + 16);
    drawWoodGrain(ctx, g.x0 - 8, g.y0 - 8, g.x1 - g.x0 + 16, g.y1 - g.y0 + 16, palette.grainAlpha);
    ctx.fillStyle = palette.overlay;
    ctx.fillRect(g.x0 - 8, g.y0 - 8, g.x1 - g.x0 + 16, g.y1 - g.y0 + 16);

    if (showHitZones) {
      for (let i = 0; i < hitZones.length; i += 1) {
        const zone = hitZones[i];
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
        ctx.fillRect(zone.xStart, g.y0, zone.xEnd - zone.xStart, g.y1 - g.y0);
      }
    }

    if (constraintRange) {
      const safeMin = Math.max(0, Math.min(maxFret, Math.floor(constraintRange.minFret)));
      const safeMax = Math.max(safeMin, Math.min(maxFret, Math.floor(constraintRange.maxFret)));
      const startZone = hitZones[safeMin];
      const endZone = hitZones[safeMax];
      if (startZone && endZone) {
        const xStart = Math.max(g.x0, Math.min(startZone.xStart, endZone.xEnd));
        const xEnd = Math.min(g.x1, Math.max(startZone.xStart, endZone.xEnd));

        ctx.fillStyle = "rgba(5, 10, 14, 0.14)";
        if (xStart > g.x0) {
          ctx.fillRect(g.x0, g.y0, xStart - g.x0, g.y1 - g.y0);
        }
        if (xEnd < g.x1) {
          ctx.fillRect(xEnd, g.y0, g.x1 - xEnd, g.y1 - g.y0);
        }

        const active = ctx.createLinearGradient(0, g.y0, 0, g.y1);
        active.addColorStop(0, "rgba(124, 198, 216, 0.09)");
        active.addColorStop(0.5, "rgba(124, 198, 216, 0.04)");
        active.addColorStop(1, "rgba(124, 198, 216, 0.09)");
        ctx.fillStyle = active;
        ctx.fillRect(xStart, g.y0, Math.max(1, xEnd - xStart), g.y1 - g.y0);

        ctx.strokeStyle = "rgba(179, 232, 246, 0.62)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xStart, g.y0);
        ctx.lineTo(xStart, g.y1);
        ctx.moveTo(xEnd, g.y0);
        ctx.lineTo(xEnd, g.y1);
        ctx.stroke();

        const label = constraintRange.label || `${safeMin}~${safeMax}프렛`;
        ctx.font = "11px Bahnschrift, Malgun Gothic, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelW = Math.max(56, Math.min(180, ctx.measureText(label).width + 14));
        const labelH = 18;
        const cx = (xStart + xEnd) / 2;
        const lx = Math.max(g.x0 + labelW / 2, Math.min(g.x1 - labelW / 2, cx));
        const ly = g.y0 + 10;
        ctx.fillStyle = "rgba(12, 20, 28, 0.56)";
        ctx.beginPath();
        ctx.roundRect(lx - labelW / 2, ly - labelH / 2, labelW, labelH, 7);
        ctx.fill();
        ctx.fillStyle = "rgba(236, 252, 255, 0.96)";
        ctx.fillText(label, lx, ly);
      }
    }

    // frets
    ctx.strokeStyle = "rgba(240, 240, 240, 0.9)";
    for (let i = 0; i < g.fretXs.length; i += 1) {
      const x = g.fretXs[i];
      ctx.lineWidth = i === 0 ? Math.max(2.6, fretLineWidth + 1.1) : fretLineWidth;
      ctx.beginPath();
      ctx.moveTo(x, g.y0);
      ctx.lineTo(x, g.y1);
      ctx.stroke();
    }

    // strings
    for (let i = 0; i < g.stringYs.length; i += 1) {
      const y = g.stringYs[i];
      ctx.strokeStyle = "rgba(247, 247, 247, 0.95)";
      ctx.lineWidth = stringThickness[i] ?? 2.1;
      ctx.beginPath();
      ctx.moveTo(g.x0, y);
      ctx.lineTo(g.x1, y);
      ctx.stroke();

      // left-side string labels. string index 0 is low E at the bottom.
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = "12px Bahnschrift, Malgun Gothic, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(stringNames[i] ?? "", g.x0 - 8, y);
    }

    // inlays
    ctx.fillStyle =
      inlayPreset === "BLOCK"
        ? "rgba(226, 221, 198, 0.72)"
        : inlayPreset === "TRIANGLE"
        ? "rgba(228, 220, 184, 0.78)"
        : "rgba(236, 230, 206, 0.75)";
    for (const fret of inlayFrets) {
      if (fret <= 0 || fret > maxFret) continue;
      const idx = Math.min(fret, g.fretXs.length - 1);
      const left = idx - 1 >= 0 ? g.fretXs[idx - 1] : g.x0;
      const right = g.fretXs[idx];
      const x = (left + right) / 2;
      const yMid = (g.y0 + g.y1) / 2;
      drawInlay(ctx, inlayPreset, x, yMid, fret % 12 === 0);
    }

    const cellIntersection = (cell: Cell) => {
      const fret = Math.max(0, Math.min(maxFret, cell.fret));
      const x = fret === 0 ? g.x0 : g.fretXs[fret] ?? g.x0;
      const y = g.stringYs[Math.max(0, Math.min(3, cell.string))] ?? g.stringYs[0];
      return { x, y };
    };

    const markerCenter = (cell: Cell) => {
      const { x, y } = cellIntersection(cell);
      return { x, y };
    };

    const fretLabelCenter = (cell: Cell) => {
      const fret = Math.max(0, Math.min(maxFret, cell.fret));
      if (fret <= 0) return null;
      const left = g.fretXs[fret - 1] ?? g.x0;
      const right = g.fretXs[fret] ?? g.x0;
      const x = (left + right) / 2;
      const y = g.stringYs[Math.max(0, Math.min(3, cell.string))] ?? g.stringYs[0];
      return { x, y };
    };

    if (showNoteLabels) {
      ctx.font = "11px Bahnschrift, Malgun Gothic, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let s = 0; s < 4; s += 1) {
        for (let f = 1; f <= maxFret; f += 1) {
          const center = fretLabelCenter({ string: s, fret: f });
          if (!center) continue;
          const note = pcToName(cellToPc({ string: s, fret: f }));
          ctx.fillStyle = "rgba(255,255,255,0.72)";
          ctx.fillText(note, center.x, center.y - 11);
        }
      }
    }

    for (const marker of markers) {
      if (marker.cell.fret < 0 || marker.cell.fret > maxFret) continue;
      const { x, y } = markerCenter(marker.cell);
      const color = markerColor(marker.kind);
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.8;

      if (marker.kind === "lm_start_primary") {
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(47, 190, 111, 0.2)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 5.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else if (marker.kind === "lm_goal_secondary") {
        ctx.beginPath();
        ctx.arc(x, y, 6.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(86, 179, 255, 0.22)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 6.2, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      } else if (marker.kind === "start") {
        drawStar(ctx, x, y, 10);
        ctx.fill();
        ctx.stroke();
      } else if (marker.kind === "goal") {
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (cellLabels.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "10px Bahnschrift, Malgun Gothic, sans-serif";
      for (const label of cellLabels) {
        if (label.cell.fret < 0 || label.cell.fret > maxFret) continue;
        const { x, y } = markerCenter(label.cell);
        ctx.fillStyle = "rgba(15, 22, 28, 0.7)";
        ctx.beginPath();
        ctx.roundRect(x - 12, y - 6, 24, 12, 4);
        ctx.fill();
        ctx.fillStyle = label.color || "rgba(247, 254, 255, 0.95)";
        ctx.fillText(label.text, x, y);
      }
    }
  }, [boardPreset, boardSize.height, boardSize.width, cellLabels, constraintRange, detectMode, fretLineWidth, geom, hitZones, inlayPreset, markers, maxFret, showHitZones, showNoteLabels]);

  return (
    <div ref={wrapRef} className="mg-fretboard-wrap">
      <div className="mg-fretboard-stage" style={{ width: `${boardSize.width}px`, height: `${boardSize.height}px` }}>
        <canvas
          ref={canvasRef}
          className={`mg-fretboard-canvas ${disabled ? "is-disabled" : ""}`}
          onClick={(event) => {
            if (!onCellClick || disabled) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const px = (event.clientX - rect.left) * scaleX / (window.devicePixelRatio || 1);
            const py = (event.clientY - rect.top) * scaleY / (window.devicePixelRatio || 1);
            const cell = hitTestFretboard(px, py, geom, detectMode, hitProfile);
            if (!cell) return;
            if (constraintRange) {
              const safeMin = Math.max(0, Math.min(maxFret, Math.floor(constraintRange.minFret)));
              const safeMax = Math.max(safeMin, Math.min(maxFret, Math.floor(constraintRange.maxFret)));
              if (cell.fret < safeMin || cell.fret > safeMax) return;
            }
            onCellClick(cell);
          }}
        />
      </div>
    </div>
  );
}
