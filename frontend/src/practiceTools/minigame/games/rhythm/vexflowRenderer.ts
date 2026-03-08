import {
  Annotation,
  Articulation,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
} from "vexflow";
import type { RhythmEvent, RhythmMeasure } from "../../types/models";
import type { RhythmNotationMode } from "../../userSettings";
import { buildExpectedOnsetId } from "./rhythmEngine";

type RenderedEventNote = {
  absTick: number;
  event: RhythmEvent;
  measure: number;
  note: StaveNote;
  judgeId: string | null;
  visualId: string;
};

type TiePlan = {
  fromTick: number;
  fromKind: "HIT" | "GHOST";
  toTick: number;
};

export type RhythmRenderNoteMeta = {
  index: number;
  visualId: string;
  judgeId: string | null;
  startTick: number;
  endTick: number;
  kind: "HIT" | "GHOST";
  x: number;
  width: number;
  measure: number;
  groupEl: SVGElement | null;
  noteheadEl: SVGElement | null;
};

export type RhythmTimelineAnchor = {
  index: number;
  startTick: number;
  endTick: number;
  xCenter: number;
  kind: RhythmEvent["kind"];
  measure: number;
};

export type RhythmTieVisualLink = {
  fromJudgeId: string;
  toVisualId: string;
  triggerTick: number;
};

export type RhythmRenderMeta = {
  notes: RhythmRenderNoteMeta[];
  anchors: RhythmTimelineAnchor[];
  ties: RhythmTieVisualLink[];
  stageWidth: number;
  stageHeight: number;
  timelineStartX: number;
  timelineEndX: number;
  playheadEl: HTMLDivElement;
  historyLaneEl: HTMLDivElement;
};

export type RhythmOverlayState = {
  playheadX: number | null;
};

export type RhythmNoteVisualState = "idle" | "active" | "hit" | "miss";

export type RhythmHistoryMarker = {
  id: string;
  x: number;
  kind: "HIT" | "GHOST";
  outcome: "PERFECT" | "GOOD" | "MISS" | "WRONG_TYPE" | "STRAY";
};

type RenderOptions = {
  notationMode: RhythmNotationMode;
};

function buildVisualNoteId(tick: number, kind: "HIT" | "GHOST"): string {
  return `visual-${tick}-${kind.toLowerCase()}`;
}

function durationFromEvent(event: RhythmEvent): string {
  if (event.dur === 12) return "16";
  if (event.dur === 16) return "8";
  if (event.dur === 24) return "8";
  if (event.dur === 36) return "8";
  if (event.dur === 48) return "q";
  if (event.dur === 96) return "h";
  return "q";
}

function durationOverrideFromEvent(event: RhythmEvent): Fraction {
  return new Fraction(event.dur, 192);
}

function isBassDisplayKey(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-g](?:#|b)?\/\d$/.test(value);
}

function noteKeyByMode(event: RhythmEvent, notationMode: RhythmNotationMode): string {
  const lane = event.lane ?? "MID";
  if (notationMode === "BASS_STAFF") {
    if (isBassDisplayKey(event.displayKey)) return event.displayKey;
    const bassLaneMap = {
      LOW: "g/2",
      MID: "d/3",
      OCTAVE: "g/3",
    } as const;
    return bassLaneMap[lane];
  }

  const percLaneMap = {
    LOW: "g/4",
    MID: "b/4",
    OCTAVE: "d/5",
  } as const;
  return percLaneMap[lane];
}

function applyTechniqueLabel(note: StaveNote, technique: string): void {
  const annotation = new Annotation(technique);
  annotation.setFont("Bahnschrift", 9, "700");
  annotation.setJustification(Annotation.HorizontalJustify.CENTER);
  annotation.setVerticalJustification(Annotation.VerticalJustify.TOP);
  note.addModifier(annotation, 0);
}

function noteFromEvent(event: RhythmEvent, notationMode: RhythmNotationMode, visualId: string): StaveNote {
  const base = durationFromEvent(event);
  const duration = event.kind === "REST" ? `${base}r` : base;
  const noteStruct: ConstructorParameters<typeof StaveNote>[0] = {
    keys: [noteKeyByMode(event, notationMode)],
    duration,
    duration_override: durationOverrideFromEvent(event),
    clef: notationMode === "BASS_STAFF" ? "bass" : "percussion",
    auto_stem: true,
  };

  if (event.kind === "GHOST") {
    noteStruct.type = "x";
  }

  const note = new StaveNote(noteStruct);
  note.setAttribute("id", visualId);
  note.addClass("mg-rc-note");

  if (event.dot && event.kind !== "REST") {
    Dot.buildAndAttach([note], { all: true });
  }

  if (event.accent && event.kind !== "REST") {
    note.addModifier(new Articulation("a>"), 0);
  }

  if (event.technique && event.kind !== "REST" && event.start === 0) {
    applyTechniqueLabel(note, event.technique);
  }

  return note;
}

function makeOverlay(stage: HTMLDivElement, width: number, height: number) {
  const overlay = document.createElement("div");
  overlay.className = "mg-rhythm-overlay";
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  overlay.style.pointerEvents = "none";

  const playhead = document.createElement("div");
  playhead.className = "mg-rhythm-playhead";
  overlay.appendChild(playhead);

  const historyLane = document.createElement("div");
  historyLane.className = "mg-rhythm-history-lane";
  historyLane.setAttribute("data-testid", "mg-rc-history-lane");
  overlay.appendChild(historyLane);

  stage.appendChild(overlay);
  return { playhead, historyLane };
}

function buildTiePlans(measures: RhythmMeasure[]): { tiedTargetTicks: Set<number>; tiePlans: TiePlan[] } {
  const sequence = measures.flatMap((measure, measureIndex) =>
    [...(measure.events ?? [])]
      .sort((a, b) => a.start - b.start)
      .map((event) => ({ absTick: measureIndex * 192 + event.start, event }))
  );

  const tiedTargetTicks = new Set<number>();
  const tiePlans: TiePlan[] = [];

  let activeSourceTick: number | null = null;
  let activeSourceKind: "HIT" | "GHOST" | null = null;
  let activeEndTick = -1;

  for (const item of sequence) {
    if (item.event.kind === "REST") {
      activeSourceTick = null;
      activeSourceKind = null;
      activeEndTick = -1;
      continue;
    }

    const tiedTarget: boolean = activeEndTick === item.absTick && activeSourceTick !== null && activeSourceKind !== null;
    if (tiedTarget) {
      const sourceTick = activeSourceTick as number;
      const sourceKind = activeSourceKind as "HIT" | "GHOST";
      tiedTargetTicks.add(item.absTick);
      tiePlans.push({
        fromTick: sourceTick,
        fromKind: sourceKind,
        toTick: item.absTick,
      });
    }

    const carriedSourceTick: number | null = tiedTarget ? activeSourceTick : item.absTick;
    const carriedSourceKind: "HIT" | "GHOST" | null = tiedTarget
      ? activeSourceKind
      : (item.event.kind as "HIT" | "GHOST");

    if (item.event.tieToNext && carriedSourceTick !== null && carriedSourceKind !== null) {
      activeSourceTick = carriedSourceTick;
      activeSourceKind = carriedSourceKind;
      activeEndTick = item.absTick + item.event.dur;
    } else {
      activeSourceTick = null;
      activeSourceKind = null;
      activeEndTick = -1;
    }
  }

  return { tiedTargetTicks, tiePlans };
}

function buildTuplets(renderedEvents: RenderedEventNote[]): Tuplet[] {
  const tuplets: Tuplet[] = [];

  for (let index = 0; index < renderedEvents.length; ) {
    if (renderedEvents[index].event.tuplet !== 3) {
      index += 1;
      continue;
    }

    const run: RenderedEventNote[] = [];
    while (index < renderedEvents.length && renderedEvents[index].event.tuplet === 3) {
      run.push(renderedEvents[index]);
      index += 1;
    }

    for (let offset = 0; offset + 2 < run.length; offset += 3) {
      const group = run.slice(offset, offset + 3);
      const tuplet = new Tuplet(
        group.map((item) => item.note),
        {
          num_notes: 3,
          notes_occupied: 2,
          bracketed: group.some((item) => item.event.kind === "REST"),
        }
      );
      tuplets.push(tuplet);
    }
  }

  return tuplets;
}

function renderMeasure(
  context: ReturnType<Renderer["getContext"]>,
  measure: RhythmMeasure,
  measureIndex: number,
  x: number,
  y: number,
  width: number,
  notationMode: RhythmNotationMode,
  tiedTargetTicks: Set<number>
): { renderedEvents: RenderedEventNote[]; anchors: RhythmTimelineAnchor[] } {
  const stave = new Stave(x, y, width);
  stave.setContext(context).draw();

  const events = [...(measure.events ?? [])].sort((a, b) => a.start - b.start);
  const renderedEvents = events.map((event) => {
    const absTick = measureIndex * 192 + event.start;
    const isTiedTarget = tiedTargetTicks.has(absTick);
    const judgeId = event.kind === "REST" || isTiedTarget ? null : buildExpectedOnsetId(absTick, event.kind);
    const visualId = event.kind === "REST" ? `rest-${absTick}` : judgeId ?? buildVisualNoteId(absTick, event.kind);
    return {
      absTick,
      event,
      measure: measureIndex,
      note: noteFromEvent(event, notationMode, visualId),
      judgeId,
      visualId,
    };
  });

  const voice = new Voice({ num_beats: 4, beat_value: 4 });
  voice.setStrict(false);
  voice.addTickables(renderedEvents.map((item) => item.note));

  const tuplets = buildTuplets(renderedEvents);
  const beams = Beam.generateBeams(
    renderedEvents.map((item) => item.note),
    { groups: [new Fraction(1, 4)] }
  );

  new Formatter().joinVoices([voice]).format([voice], Math.max(80, width - 24));
  voice.draw(context, stave);
  beams.forEach((beam) => {
    beam.setContext(context).draw();
  });
  tuplets.forEach((tuplet) => {
    tuplet.setContext(context).draw();
  });

  const anchors = renderedEvents.map((item) => {
    const box = item.note.getBoundingBox();
    const noteHeads = ((item.note as unknown as { noteHeads?: Array<any> }).noteHeads ?? []) as Array<any>;
    const noteheadEl = noteHeads[0]?.getSVGElement?.() ?? null;
    let xCenter = item.note.getAbsoluteX();
    if (item.event.kind !== "REST" && noteheadEl && "getBBox" in noteheadEl) {
      const noteheadBox = (noteheadEl as SVGGraphicsElement).getBBox();
      xCenter = noteheadBox.x + noteheadBox.width / 2;
    } else if (box) {
      xCenter = box.getX() + box.getW() / 2;
    }

    return {
      index: 0,
      startTick: item.absTick,
      endTick: item.absTick + item.event.dur,
      xCenter,
      kind: item.event.kind,
      measure: measureIndex,
    };
  });

  return { renderedEvents, anchors };
}

function isPlayableRenderedEvent(item: RenderedEventNote): item is RenderedEventNote & { event: RhythmEvent & { kind: "HIT" | "GHOST" } } {
  return item.event.kind === "HIT" || item.event.kind === "GHOST";
}

function hydrateNoteMeta(rendered: RenderedEventNote[]): RhythmRenderNoteMeta[] {
  return rendered
    .filter(isPlayableRenderedEvent)
    .map((item, index) => {
      const box = item.note.getBoundingBox();
      const noteHeads = ((item.note as unknown as { noteHeads?: Array<any> }).noteHeads ?? []) as Array<any>;
      const noteheadEl = noteHeads[0]?.getSVGElement?.() ?? null;
      const groupEl = item.note.getSVGElement() ?? null;

      let xCenter = item.note.getAbsoluteX();
      if (noteheadEl && "getBBox" in noteheadEl) {
        const noteheadBox = (noteheadEl as SVGGraphicsElement).getBBox();
        xCenter = noteheadBox.x + noteheadBox.width / 2;
      } else if (box) {
        xCenter = box.getX() + box.getW() / 2;
      }

      if (groupEl) {
        groupEl.classList.add("mg-rc-note");
        groupEl.setAttribute("data-note-kind", item.event.kind.toLowerCase());
        groupEl.setAttribute("data-visual-id", item.visualId);
        groupEl.setAttribute("data-visual-state", "idle");
      }

      if (noteheadEl) {
        noteheadEl.classList.add("mg-rc-notehead");
        noteheadEl.setAttribute("data-note-kind", item.event.kind.toLowerCase());
        noteheadEl.setAttribute("data-visual-id", item.visualId);
        noteheadEl.setAttribute("data-visual-state", "idle");
      }

      return {
        index,
        visualId: item.visualId,
        judgeId: item.judgeId,
        startTick: item.absTick,
        endTick: item.absTick + item.event.dur,
        kind: item.event.kind,
        x: xCenter,
        width: box ? Math.max(10, box.getW()) : 14,
        measure: item.measure,
        groupEl,
        noteheadEl,
      };
    });
}

function drawTies(
  context: ReturnType<Renderer["getContext"]>,
  renderedEvents: RenderedEventNote[],
  tiePlans: TiePlan[]
): RhythmTieVisualLink[] {
  const byTick = new Map<number, RenderedEventNote>();
  renderedEvents.forEach((item) => {
    byTick.set(item.absTick, item);
  });

  const tieLinks: RhythmTieVisualLink[] = [];
  for (const plan of tiePlans) {
    const source = byTick.get(plan.fromTick);
    const target = byTick.get(plan.toTick);
    if (!source || !target) continue;
    if (source.event.kind === "REST" || target.event.kind === "REST") continue;

    const tie = new StaveTie({
      first_note: source.note,
      last_note: target.note,
      first_indices: [0],
      last_indices: [0],
    });
    tie.setContext(context).draw();

    tieLinks.push({
      fromJudgeId: buildExpectedOnsetId(plan.fromTick, plan.fromKind),
      toVisualId: target.visualId,
      triggerTick: plan.toTick,
    });
  }

  return tieLinks;
}

function setPlayhead(el: HTMLDivElement, x: number | null) {
  if (x === null) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.style.left = `${Math.round(x)}px`;
}

export function updateRhythmOverlay(meta: RhythmRenderMeta, state: RhythmOverlayState): void {
  setPlayhead(meta.playheadEl, state.playheadX);
}

function toggleStateClass(el: Element, state: RhythmNoteVisualState): void {
  el.classList.toggle("mg-rhythm-active-note", state === "active");
  el.classList.toggle("mg-rhythm-hit-note", state === "hit");
  el.classList.toggle("mg-rhythm-miss-note", state === "miss");
}

export function applyRhythmNoteStates(meta: RhythmRenderMeta, states: Record<string, RhythmNoteVisualState>): void {
  for (const note of meta.notes) {
    const nextState = states[note.visualId] ?? "idle";

    if (note.groupEl) {
      if (note.groupEl.getAttribute("data-visual-state") !== nextState) {
        note.groupEl.setAttribute("data-visual-state", nextState);
      }
      toggleStateClass(note.groupEl, nextState);
    }

    if (note.noteheadEl) {
      if (note.noteheadEl.getAttribute("data-visual-state") !== nextState) {
        note.noteheadEl.setAttribute("data-visual-state", nextState);
      }
      toggleStateClass(note.noteheadEl, nextState);
    }
  }
}

export function renderRhythmHistory(meta: RhythmRenderMeta, markers: RhythmHistoryMarker[]): void {
  meta.historyLaneEl.innerHTML = "";
  for (const marker of markers) {
    const node = document.createElement("div");
    node.className = "mg-rhythm-history-marker";
    node.style.left = `${Math.round(marker.x)}px`;
    node.textContent = marker.kind === "HIT" ? "H" : "G";
    node.dataset.kind = marker.kind.toLowerCase();
    node.dataset.outcome = marker.outcome.toLowerCase();
    meta.historyLaneEl.appendChild(node);
  }
}

export function renderRhythm(container: HTMLDivElement, measures: RhythmMeasure[], options: RenderOptions): RhythmRenderMeta {
  const availableWidth = Math.max(320, container.clientWidth || 820);
  const drawWidth = Math.max(900, availableWidth - 8);
  const height = 210;
  container.innerHTML = "";

  const viewport = document.createElement("div");
  viewport.className = "mg-rhythm-scroll";
  viewport.style.width = "100%";
  viewport.style.height = `${height}px`;
  viewport.style.overflowX = "auto";
  viewport.style.overflowY = "hidden";
  viewport.style.position = "relative";
  container.appendChild(viewport);

  const stage = document.createElement("div");
  stage.className = "mg-rhythm-stage";
  stage.style.width = `${drawWidth}px`;
  stage.style.height = `${height}px`;
  stage.style.position = "relative";
  viewport.appendChild(stage);

  const renderer = new Renderer(stage, Renderer.Backends.SVG);
  renderer.resize(drawWidth, height);
  const context = renderer.getContext();

  const padding = 10;
  const staveY = 38;
  const staveHeight = 122;
  const measureCount = 4;
  const headerWidth = 88;
  const timelineStartX = padding + headerWidth + 8;
  const measureWidth = Math.floor((drawWidth - padding * 2 - headerWidth) / measureCount);
  const timelineEndX = timelineStartX + measureWidth * measureCount - 16;

  const headerStave = new Stave(padding, staveY, headerWidth - 10);
  if (options.notationMode === "BASS_STAFF") {
    headerStave.addClef("bass").addTimeSignature("4/4");
  } else {
    headerStave.addClef("percussion").addTimeSignature("4/4");
  }
  headerStave.setContext(context).draw();

  const { tiedTargetTicks, tiePlans } = buildTiePlans(measures);
  const allRenderedEvents: RenderedEventNote[] = [];
  const anchors: RhythmTimelineAnchor[] = [];

  for (let index = 0; index < measureCount; index += 1) {
    const measure = measures[index] ?? { events: [] };
    const x = timelineStartX + index * measureWidth;
    const rendered = renderMeasure(context, measure, index, x, staveY, measureWidth - 6, options.notationMode, tiedTargetTicks);
    allRenderedEvents.push(...rendered.renderedEvents);
    anchors.push(...rendered.anchors);
  }

  const tieLinks = drawTies(context, allRenderedEvents, tiePlans);

  const metas = hydrateNoteMeta(
    [...allRenderedEvents].sort((a, b) => {
      if (a.absTick !== b.absTick) return a.absTick - b.absTick;
      return a.visualId.localeCompare(b.visualId);
    })
  );

  anchors.sort((a, b) => a.startTick - b.startTick);
  anchors.forEach((item, index) => {
    item.index = index;
  });

  const overlays = makeOverlay(stage, drawWidth, height);
  overlays.playhead.style.height = `${staveHeight}px`;
  overlays.playhead.style.top = `${staveY - 4}px`;

  return {
    notes: metas,
    anchors,
    ties: tieLinks,
    stageWidth: drawWidth,
    stageHeight: height,
    timelineStartX,
    timelineEndX,
    playheadEl: overlays.playhead,
    historyLaneEl: overlays.historyLane,
  };
}
