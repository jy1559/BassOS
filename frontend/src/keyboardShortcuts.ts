import type { Lang } from "./i18n";

export type ShortcutBinding = {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type ShortcutGroupId = "tabs" | "video" | "metronome" | "pin" | "pip" | "popup";

export type ShortcutActionId =
  | "tab_dashboard"
  | "tab_practice"
  | "tab_gallery"
  | "tab_songs"
  | "tab_drills"
  | "tab_recommend"
  | "tab_review"
  | "tab_xp"
  | "tab_sessions"
  | "tab_quests"
  | "tab_achievements"
  | "tab_tools"
  | "tab_settings"
  | "video_toggle"
  | "video_restart"
  | "video_fullscreen"
  | "video_pin_save"
  | "video_pin_jump"
  | "video_pin_clear"
  | "score_zoom"
  | "score_prev"
  | "score_next"
  | "metronome_toggle"
  | "pip_video_toggle"
  | "pip_collapse_toggle"
  | "pip_open_studio"
  | "pip_stop_session"
  | "popup_primary"
  | "popup_close"
  | "popup_destructive"
  | "popup_alternate";

export type KeyboardShortcutBindings = Record<ShortcutActionId, ShortcutBinding | null>;

export type KeyboardShortcutSettings = {
  bindings: KeyboardShortcutBindings;
};

export type ShortcutActionMeta = {
  id: ShortcutActionId;
  group: ShortcutGroupId;
  label: { ko: string; en: string };
  description: { ko: string; en: string };
};

const MODIFIER_CODES = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

export const SUPPORTED_SHORTCUT_CODES = new Set<string>([
  "Space",
  "Enter",
  "Escape",
  "Delete",
  "Backspace",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
  ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
]);

export const DEFAULT_SHORTCUT_BINDINGS: KeyboardShortcutBindings = {
  tab_dashboard: { code: "Digit1", alt: true },
  tab_practice: { code: "Digit2", alt: true },
  tab_gallery: { code: "Digit3", alt: true },
  tab_songs: { code: "Digit4", alt: true },
  tab_drills: { code: "Digit5", alt: true },
  tab_recommend: { code: "Digit6", alt: true },
  tab_review: { code: "Digit7", alt: true },
  tab_xp: { code: "Digit8", alt: true },
  tab_sessions: { code: "Digit9", alt: true },
  tab_quests: { code: "KeyQ", alt: true },
  tab_achievements: { code: "KeyA", alt: true },
  tab_tools: { code: "KeyB", alt: true },
  tab_settings: { code: "Digit0", alt: true },
  video_toggle: { code: "Space" },
  video_restart: { code: "KeyR" },
  video_fullscreen: { code: "KeyF" },
  video_pin_save: { code: "KeyP" },
  video_pin_jump: { code: "KeyJ" },
  video_pin_clear: { code: "KeyP", shift: true },
  score_zoom: { code: "KeyG" },
  score_prev: { code: "ArrowLeft" },
  score_next: { code: "ArrowRight" },
  metronome_toggle: { code: "KeyM" },
  pip_video_toggle: { code: "KeyV" },
  pip_collapse_toggle: { code: "KeyC" },
  pip_open_studio: { code: "KeyS" },
  pip_stop_session: { code: "KeyX", shift: true },
  popup_primary: { code: "Enter" },
  popup_close: { code: "Escape" },
  popup_destructive: { code: "Delete" },
  popup_alternate: { code: "KeyT" },
};

export const DEFAULT_KEYBOARD_SHORTCUT_SETTINGS: KeyboardShortcutSettings = {
  bindings: { ...DEFAULT_SHORTCUT_BINDINGS },
};

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroupId, { ko: string; en: string }> = {
  tabs: { ko: "탭 이동", en: "Tab Navigation" },
  video: { ko: "영상", en: "Video" },
  metronome: { ko: "메트로놈", en: "Metronome" },
  pin: { ko: "핀", en: "Pin" },
  pip: { ko: "PiP", en: "PiP" },
  popup: { ko: "팝업", en: "Popup" },
};

export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  { id: "tab_dashboard", group: "tabs", label: { ko: "대시보드", en: "Dashboard" }, description: { ko: "대시보드 탭으로 이동", en: "Go to dashboard" } },
  { id: "tab_practice", group: "tabs", label: { ko: "연습 스튜디오", en: "Practice Studio" }, description: { ko: "연습 스튜디오 탭으로 이동", en: "Go to practice studio" } },
  { id: "tab_gallery", group: "tabs", label: { ko: "기록장", en: "Journal" }, description: { ko: "기록장 탭으로 이동", en: "Go to journal" } },
  { id: "tab_songs", group: "tabs", label: { ko: "곡", en: "Songs" }, description: { ko: "곡 라이브러리로 이동", en: "Go to songs" } },
  { id: "tab_drills", group: "tabs", label: { ko: "드릴/배킹트랙", en: "Drills / Backing" }, description: { ko: "드릴 라이브러리로 이동", en: "Go to drills" } },
  { id: "tab_recommend", group: "tabs", label: { ko: "추천곡", en: "Recommendations" }, description: { ko: "추천곡 탭으로 이동", en: "Go to recommendations" } },
  { id: "tab_review", group: "tabs", label: { ko: "돌아보기", en: "Review" }, description: { ko: "돌아보기 탭으로 이동", en: "Go to review" } },
  { id: "tab_xp", group: "tabs", label: { ko: "XP 기록", en: "XP Log" }, description: { ko: "XP 기록 탭으로 이동", en: "Go to XP log" } },
  { id: "tab_sessions", group: "tabs", label: { ko: "세션 기록", en: "Sessions" }, description: { ko: "세션 기록 탭으로 이동", en: "Go to sessions" } },
  { id: "tab_quests", group: "tabs", label: { ko: "퀘스트", en: "Quests" }, description: { ko: "퀘스트 탭으로 이동", en: "Go to quests" } },
  { id: "tab_achievements", group: "tabs", label: { ko: "업적", en: "Achievements" }, description: { ko: "업적 탭으로 이동", en: "Go to achievements" } },
  { id: "tab_tools", group: "tabs", label: { ko: "TAB 생성기", en: "TAB Builder" }, description: { ko: "연습 도구 탭으로 이동", en: "Go to practice tools" } },
  { id: "tab_settings", group: "tabs", label: { ko: "설정", en: "Settings" }, description: { ko: "설정 탭으로 이동", en: "Go to settings" } },
  { id: "video_toggle", group: "video", label: { ko: "영상 재생/정지", en: "Video Play/Pause" }, description: { ko: "현재 곡 영상 재생/일시정지", en: "Toggle current video playback" } },
  { id: "video_restart", group: "video", label: { ko: "영상 처음으로", en: "Video Restart" }, description: { ko: "현재 곡 영상을 처음 위치로 이동", en: "Restart current video" } },
  { id: "video_fullscreen", group: "video", label: { ko: "영상 전체화면", en: "Video Fullscreen" }, description: { ko: "현재 곡 영상을 전체화면으로 전환", en: "Toggle video fullscreen" } },
  { id: "video_pin_save", group: "pin", label: { ko: "영상 핀 저장", en: "Save Video Pin" }, description: { ko: "현재 재생 위치를 핀으로 저장", en: "Save pin at current video time" } },
  { id: "video_pin_jump", group: "pin", label: { ko: "영상 핀으로 이동", en: "Jump To Pin" }, description: { ko: "저장된 핀 위치로 이동", en: "Jump to saved pin" } },
  { id: "video_pin_clear", group: "pin", label: { ko: "영상 핀 제거", en: "Clear Video Pin" }, description: { ko: "저장된 핀을 제거", en: "Remove saved pin" } },
  { id: "score_zoom", group: "video", label: { ko: "악보 확대/축소", en: "Score Zoom" }, description: { ko: "악보 확대 모달 열기/닫기", en: "Toggle score zoom" } },
  { id: "score_prev", group: "video", label: { ko: "악보 이전", en: "Score Previous" }, description: { ko: "이전 이미지/페이지로 이동", en: "Move to previous score page" } },
  { id: "score_next", group: "video", label: { ko: "악보 다음", en: "Score Next" }, description: { ko: "다음 이미지/페이지로 이동", en: "Move to next score page" } },
  { id: "metronome_toggle", group: "metronome", label: { ko: "메트로놈 재생/정지", en: "Metronome Start/Stop" }, description: { ko: "메트로놈 시작 또는 정지", en: "Toggle metronome" } },
  { id: "pip_video_toggle", group: "pip", label: { ko: "PiP 영상 열기/닫기", en: "Toggle PiP Video" }, description: { ko: "세션 PiP 영상 패널 열기/닫기", en: "Toggle PiP video panel" } },
  { id: "pip_collapse_toggle", group: "pip", label: { ko: "PiP 접기/펼치기", en: "Collapse/Expand PiP" }, description: { ko: "세션 PiP 접기 또는 펼치기", en: "Collapse or expand session PiP" } },
  { id: "pip_open_studio", group: "pip", label: { ko: "PiP에서 스튜디오 이동", en: "Open Studio From PiP" }, description: { ko: "연습 스튜디오 탭으로 이동", en: "Go to practice studio from PiP" } },
  { id: "pip_stop_session", group: "pip", label: { ko: "PiP에서 세션 종료", en: "Stop Session From PiP" }, description: { ko: "세션 종료 모달 열기", en: "Open stop-session modal from PiP" } },
  { id: "popup_primary", group: "popup", label: { ko: "팝업 기본 동작", en: "Popup Primary" }, description: { ko: "현재 팝업의 기본 동작 실행", en: "Run popup primary action" } },
  { id: "popup_close", group: "popup", label: { ko: "팝업 닫기", en: "Popup Close" }, description: { ko: "현재 팝업 닫기 또는 취소", en: "Close or cancel current popup" } },
  { id: "popup_destructive", group: "popup", label: { ko: "팝업 위험 동작", en: "Popup Destructive" }, description: { ko: "현재 팝업의 저장 안 함/삭제 동작 실행", en: "Run popup destructive action" } },
  { id: "popup_alternate", group: "popup", label: { ko: "팝업 보조 동작", en: "Popup Alternate" }, description: { ko: "현재 팝업의 보조 동작 실행", en: "Run popup alternate action" } },
];

export function cloneShortcutBinding(binding: ShortcutBinding | null): ShortcutBinding | null {
  if (!binding) return null;
  return {
    code: binding.code,
    ctrl: Boolean(binding.ctrl),
    alt: Boolean(binding.alt),
    shift: Boolean(binding.shift),
  };
}

export function normalizeShortcutBinding(raw: unknown, fallback: ShortcutBinding | null = null): ShortcutBinding | null {
  if (!raw || typeof raw !== "object") {
    return cloneShortcutBinding(fallback);
  }
  const item = raw as Record<string, unknown>;
  const code = String(item.code || "").trim();
  if (!code || MODIFIER_CODES.has(code) || !SUPPORTED_SHORTCUT_CODES.has(code)) {
    return cloneShortcutBinding(fallback);
  }
  return {
    code,
    ctrl: Boolean(item.ctrl),
    alt: Boolean(item.alt),
    shift: Boolean(item.shift),
  };
}

export function normalizeKeyboardShortcutSettings(raw: unknown): KeyboardShortcutSettings {
  const source =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).bindings === "object"
      ? ((raw as Record<string, unknown>).bindings as Record<string, unknown>)
      : {};
  const bindings = {} as KeyboardShortcutBindings;
  for (const action of SHORTCUT_ACTIONS) {
    bindings[action.id] = normalizeShortcutBinding(source[action.id], DEFAULT_SHORTCUT_BINDINGS[action.id]);
  }
  return { bindings };
}

export function shortcutBindingSignature(binding: ShortcutBinding | null): string {
  if (!binding) return "";
  return `${binding.ctrl ? "1" : "0"}|${binding.alt ? "1" : "0"}|${binding.shift ? "1" : "0"}|${binding.code}`;
}

export function shortcutBindingEquals(left: ShortcutBinding | null, right: ShortcutBinding | null): boolean {
  return shortcutBindingSignature(left) === shortcutBindingSignature(right);
}

function humanizeShortcutCode(code: string, lang: Lang): string {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return lang === "ko" ? "Space" : "Space";
  if (code === "ArrowLeft") return lang === "ko" ? "Left" : "Left";
  if (code === "ArrowRight") return lang === "ko" ? "Right" : "Right";
  if (code === "ArrowUp") return lang === "ko" ? "Up" : "Up";
  if (code === "ArrowDown") return lang === "ko" ? "Down" : "Down";
  if (code === "Enter") return "Enter";
  if (code === "Escape") return "Esc";
  if (code === "Delete") return lang === "ko" ? "Delete" : "Delete";
  if (code === "Backspace") return lang === "ko" ? "Backspace" : "Backspace";
  return code;
}

export function formatShortcutBinding(binding: ShortcutBinding | null, lang: Lang): string {
  if (!binding) return lang === "ko" ? "없음" : "None";
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(humanizeShortcutCode(binding.code, lang));
  return parts.join(" + ");
}

export function eventToShortcutBinding(event: KeyboardEvent): ShortcutBinding | null {
  if (event.metaKey) return null;
  const code = String(event.code || "").trim();
  if (!code || MODIFIER_CODES.has(code) || !SUPPORTED_SHORTCUT_CODES.has(code)) return null;
  return {
    code,
    ctrl: event.ctrlKey || undefined,
    alt: event.altKey || undefined,
    shift: event.shiftKey || undefined,
  };
}

export function findShortcutConflict(
  bindings: KeyboardShortcutBindings,
  candidate: ShortcutBinding | null,
  excludeActionId?: ShortcutActionId
): ShortcutActionId | null {
  const targetSignature = shortcutBindingSignature(candidate);
  if (!targetSignature) return null;
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === excludeActionId) continue;
    if (shortcutBindingSignature(bindings[action.id]) === targetSignature) {
      return action.id;
    }
  }
  return null;
}

export function shortcutMetaById(actionId: ShortcutActionId): ShortcutActionMeta {
  const item = SHORTCUT_ACTIONS.find((entry) => entry.id === actionId);
  if (!item) {
    throw new Error(`Unknown shortcut action: ${actionId}`);
  }
  return item;
}
