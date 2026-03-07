import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getRecords, getSessions, retargetSession, startSession, stopSession, switchSession } from "../api";
import { SessionStopModal } from "../components/session/SessionStopModal";
import type { Lang } from "../i18n";
import { formatShortcutBinding, type ShortcutActionId } from "../keyboardShortcuts";
import { useShortcutLayer, useShortcutRouter } from "../shortcutRouter";
import type { HudSummary, RecordPost, SessionItem, SessionStopResult } from "../types/models";
import { formatDisplayXp } from "../utils/xpDisplay";
import { GlobalMetronomeDock, useMetronome } from "../metronome";

export type SessionPipVideoPayload = {
  sessionId: string;
  targetKind: "song";
  targetId: string;
  title: string;
  subtitle: string;
  sourceUrl?: string;
  embedUrl?: string;
  videoUrl?: string;
};

export type SessionPipVideoControlPayload = {
  sessionId: string;
  targetKind: "song";
  targetId: string;
  canControl: boolean;
  isPlaying: boolean;
  hasPin: boolean;
  togglePlayback: () => void;
  savePinAtCurrent: () => void;
  jumpToPin: () => void;
  clearPin: () => void;
  restart: () => void;
};

type Props = {
  lang: Lang;
  hud: HudSummary;
  catalogs: {
    song_library: Array<Record<string, string>>;
    drill_library: Array<Record<string, string>>;
    drills: Array<Record<string, string>>;
  };
  backingTracks: Array<Record<string, string>>;
  onRefresh: () => Promise<void>;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  isActive: boolean;
  pipMode: "mini" | "none";
  tabSwitchPlayback: "continue" | "pause" | "pip_only";
  onSessionPipVideoChange?: (payload: SessionPipVideoPayload | null) => void;
  onSessionPipVideoControlChange?: (payload: SessionPipVideoControlPayload | null) => void;
  onSessionCompleted?: (result: SessionStopResult) => void;
  xpDisplayScale?: number;
};

type PracticeType = "song" | "drill";

type OptionGroup = {
  key: string;
  label: string;
  items: Array<Record<string, string>>;
};

type SongVideoOption = {
  value: string;
  label: string;
  group: "main" | "sub" | "journal";
};

type PendingSwitchPrompt = {
  nextType: PracticeType;
  nextId: string;
  underMin: boolean;
};

type PlaybackSurface = "none" | "video" | "metronome";

type YoutubePlayerLike = {
  playVideo?: () => void;
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime?: () => number;
  getPlayerState?: () => number;
  destroy?: () => void;
};

type YoutubeNamespace = {
  Player?: new (
    element: string | HTMLElement,
    options?: {
      events?: {
        onReady?: (event: { target: YoutubePlayerLike }) => void;
        onStateChange?: (event: { data: number; target: YoutubePlayerLike }) => void;
      };
    }
  ) => YoutubePlayerLike;
};

declare global {
  interface Window {
    YT?: YoutubeNamespace;
    onYouTubeIframeAPIReady?: (() => void) | undefined;
  }
}

const YOUTUBE_IFRAME_API_SCRIPT_ID = "bassos-youtube-iframe-api";
let youtubeIframeApiPromise: Promise<YoutubeNamespace> | null = null;

function loadYoutubeIframeApi(): Promise<YoutubeNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is unavailable"));
  }
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }
  youtubeIframeApiPromise = new Promise<YoutubeNamespace>((resolve, reject) => {
    const finish = () => {
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube IFrame API unavailable"));
      }
    };
    const existingScript = document.getElementById(YOUTUBE_IFRAME_API_SCRIPT_ID) as HTMLScriptElement | null;
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      finish();
    };
    if (!existingScript) {
      const script = document.createElement("script");
      script.id = YOUTUBE_IFRAME_API_SCRIPT_ID;
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load YouTube IFrame API"));
      document.head.appendChild(script);
    }
    window.setTimeout(() => finish(), 5000);
  }).catch((error) => {
    youtubeIframeApiPromise = null;
    throw error;
  });
  return youtubeIframeApiPromise;
}

function toDatetimeLocalInput(raw: string | undefined, fallback = new Date()): string {
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      const hh = String(parsed.getHours()).padStart(2, "0");
      const mi = String(parsed.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    }
  }
  const yyyy = fallback.getFullYear();
  const mm = String(fallback.getMonth() + 1).padStart(2, "0");
  const dd = String(fallback.getDate()).padStart(2, "0");
  const hh = String(fallback.getHours()).padStart(2, "0");
  const mi = String(fallback.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function toIsoIfValid(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function splitLinks(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("http"));
}

function splitGenres(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[|,;/]/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function splitTags(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[|,;/]/g)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function splitScorePaths(raw: string): string[] {
  return String(raw || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitImageValues(raw: string): string[] {
  return String(raw || "")
    .split(/[;\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mediaSource(path: string): string {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) return raw;
  return `/media/${raw}`;
}

function coverSource(song: Record<string, string> | null): string {
  if (!song) return "";
  if (song.cover_url) return song.cover_url;
  if (song.cover_path) return mediaSource(song.cover_path);
  return "";
}

function rankItems(
  items: Array<Record<string, string>>,
  sessions: SessionItem[],
  kind: "song" | "drill",
  query: string
): Array<Record<string, string>> {
  const normalized = query.trim().toLowerCase();
  const count = new Map<string, number>();
  for (const session of sessions) {
    const id = kind === "song" ? session.song_library_id || "" : session.drill_id || "";
    if (!id) continue;
    count.set(id, (count.get(id) ?? 0) + 1);
  }

  return [...items]
    .filter((item) => {
      const id = kind === "song" ? item.library_id || "" : item.drill_id || "";
      const title = kind === "song" ? item.title || "" : item.name || "";
      const text = `${id} ${title}`.toLowerCase();
      return !normalized || text.includes(normalized);
    })
    .sort((a, b) => {
      const aFav = String(a.favorite || "").toLowerCase();
      const bFav = String(b.favorite || "").toLowerCase();
      const favDiff = Number(["1", "true", "yes"].includes(bFav)) - Number(["1", "true", "yes"].includes(aFav));
      if (favDiff !== 0) return favDiff;
      const aId = kind === "song" ? a.library_id || "" : a.drill_id || "";
      const bId = kind === "song" ? b.library_id || "" : b.drill_id || "";
      const diff = (count.get(bId) ?? 0) - (count.get(aId) ?? 0);
      if (diff !== 0) return diff;
      const aTitle = kind === "song" ? a.title || aId : a.name || aId;
      const bTitle = kind === "song" ? b.title || bId : b.name || bId;
      return aTitle.localeCompare(bTitle);
    });
}

function renderStartAt(value: string): { date: string; time: string } {
  const raw = (value || "").replace("T", " ").replace("Z", "");
  return {
    date: raw.slice(0, 10),
    time: raw.slice(11, 16),
  };
}

function shortPaceText(item: SessionItem): string {
  const base = `${item.duration_min || 0}m`;
  const songSpeed = item.song_speed as Record<string, unknown> | undefined;
  const drillBpm = item.drill_bpm as Record<string, unknown> | undefined;
  if (songSpeed?.mode === "range") return `${base} · ${songSpeed.start}%~${songSpeed.end}%`;
  if (songSpeed?.single) return `${base} · ${songSpeed.single}%`;
  if (drillBpm?.mode === "range") return `${base} · ${drillBpm.start}~${drillBpm.end}bpm`;
  if (drillBpm?.single) return `${base} · ${drillBpm.single}bpm`;
  return base;
}

function fmtSec(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const hh = String(Math.floor(safe / 3600)).padStart(2, "0");
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function toYoutubeEmbed(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const withApiParams = (embedUrl: URL) => {
      embedUrl.searchParams.set("enablejsapi", "1");
      embedUrl.searchParams.set("playsinline", "1");
      if (typeof window !== "undefined" && window.location?.origin) {
        embedUrl.searchParams.set("origin", window.location.origin);
      }
      return embedUrl.toString();
    };
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace("/", "").trim();
      if (!id) return "";
      return withApiParams(new URL(`https://www.youtube.com/embed/${id}`));
    }
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      if (id) return withApiParams(new URL(`https://www.youtube.com/embed/${id}`));
      if (parsed.pathname.startsWith("/embed/")) return withApiParams(parsed);
    }
  } catch {
    return "";
  }
  return "";
}

function toYoutubeThumb(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    let id = "";
    if (parsed.hostname.includes("youtu.be")) {
      id = parsed.pathname.replace("/", "").trim();
    } else if (parsed.hostname.includes("youtube.com")) {
      id = parsed.searchParams.get("v") || "";
      if (!id && parsed.pathname.startsWith("/embed/")) {
        id = parsed.pathname.replace("/embed/", "").trim();
      }
      if (!id && parsed.pathname.startsWith("/shorts/")) {
        id = parsed.pathname.replace("/shorts/", "").trim();
      }
    }
    if (!id) return "";
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } catch {
    return "";
  }
}

function drillImageSources(drill: Record<string, string> | null): string[] {
  if (!drill) return [];
  const sources: string[] = [];
  const push = (value: string, media = false) => {
    const token = String(value || "").trim();
    if (!token) return;
    const src = media ? mediaSource(token) : token;
    if (!sources.includes(src)) sources.push(src);
  };

  splitImageValues(drill.image_url || "").forEach((item) => push(item, false));
  splitScorePaths(drill.image_paths || "").forEach((item) => push(item, true));
  push(drill.image_path || "", true);
  return sources;
}

function withPdfPage(url: string, page: number): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const safePage = Math.max(1, Math.floor(page));
  const base = raw.split("#")[0];
  return `${base}#page=${safePage}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isPanelToggleBlockedTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return Boolean(element.closest("button,input,select,textarea,a,label,summary,[role='button']"));
}

function isPlayableVideoUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".ogg") || lower.includes("/media/");
}

function openImageFullscreen(target: HTMLImageElement, fallback: () => void): void {
  if (typeof target.requestFullscreen !== "function") {
    fallback();
    return;
  }
  void target.requestFullscreen().catch(() => fallback());
}

function fileNameFromPath(path: string): string {
  const token = String(path || "").trim();
  if (!token) return "";
  const parts = token.split("/");
  return parts[parts.length - 1] || token;
}

function normalizeDrills(
  drills: Array<Record<string, string>>,
  drillLibrary: Array<Record<string, string>>
): Array<Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const item of drills) {
    const key = item.drill_id || `${item.name || ""}_${item.area || ""}`;
    map.set(key, { ...item });
  }
  for (const item of drillLibrary) {
    const key = item.drill_id || `${item.name || ""}_${item.area || ""}`;
    map.set(key, { ...(map.get(key) || {}), ...item });
  }
  return Array.from(map.values());
}

function drillSubActivity(drill: Record<string, string> | null): string {
  const area = (drill?.area || "").toLowerCase();
  if (area.includes("slap")) return "Slap";
  if (area.includes("theory")) return "Theory";
  if (area.includes("funk") || area.includes("groove")) return "Funk";
  return "Core";
}

function parseBpm(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

const VIDEO_PIN_STORAGE_KEY = "bassos.video.pins.v1";
const SONG_VIDEO_SELECTION_STORAGE_KEY = "bassos.song.video.selection.v1";
const SONG_VIDEO_IFRAME_ID = "bassos-song-video-iframe";

function readVideoPinStore(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VIDEO_PIN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const second = Number(value);
      if (!key || !Number.isFinite(second) || second < 0) continue;
      next[key] = second;
    }
    return next;
  } catch {
    return {};
  }
}

function writeVideoPinStore(store: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIDEO_PIN_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore local storage write errors.
  }
}

function readSongVideoSelectionStore(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SONG_VIDEO_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const songId = String(key || "").trim();
      const link = String(value || "").trim();
      if (!songId || !link) continue;
      next[songId] = link;
    }
    return next;
  } catch {
    return {};
  }
}

function writeSongVideoSelectionStore(store: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SONG_VIDEO_SELECTION_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore local storage write errors.
  }
}

function formatVideoSecond(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function extractYoutubeCurrentTimeFromMessage(data: unknown): number | null {
  let payload: unknown = data;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  const packet = payload as Record<string, unknown>;
  const info = packet.info;
  if (info && typeof info === "object") {
    const infoRecord = info as Record<string, unknown>;
    const currentTime = Number(infoRecord.currentTime);
    if (Number.isFinite(currentTime) && currentTime >= 0) {
      return currentTime;
    }
  }
  const topLevelCurrentTime = Number(packet.currentTime);
  if (Number.isFinite(topLevelCurrentTime) && topLevelCurrentTime >= 0) {
    return topLevelCurrentTime;
  }
  return null;
}

function isYoutubeMessageFromCurrentIframe(event: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  if (!iframe) return false;
  const sourceMatches = Boolean(iframe.contentWindow && event.source === iframe.contentWindow);
  if (sourceMatches) return true;
  let payload: unknown = event.data;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return false;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return false;
    }
  }
  if (!payload || typeof payload !== "object") return false;
  const packet = payload as Record<string, unknown>;
  const packetId = String(packet.id || "").trim();
  if (!packetId) return false;
  return packetId === String(iframe.id || "").trim();
}

function isFavorite(value: string): boolean {
  const raw = String(value || "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function songStatusGroup(status: string, lang: Lang): string {
  const value = String(status || "").trim();
  const pre = new Set(["목표", "예정", "카피중"]);
  const doing = new Set(["시작", "루프 연습", "연습 중"]);
  const done = new Set(["마무리", "공연완료", "포기"]);
  if (pre.has(value)) return lang === "ko" ? "시작 전" : "Before Start";
  if (doing.has(value)) return lang === "ko" ? "진행 중" : "In Progress";
  if (done.has(value)) return lang === "ko" ? "완료" : "Done";
  return lang === "ko" ? "기타" : "Others";
}

function groupSongOptions(items: Array<Record<string, string>>, lang: Lang): OptionGroup[] {
  const favorites = items.filter((item) => isFavorite(item.favorite || ""));
  const map = new Map<string, Array<Record<string, string>>>();
  items
    .filter((item) => !isFavorite(item.favorite || ""))
    .forEach((item) => {
      const key = songStatusGroup(item.status || "", lang);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
  const groups: OptionGroup[] = [];
  if (favorites.length) {
    groups.push({
      key: "favorite",
      label: lang === "ko" ? `★ 즐겨찾기 (${favorites.length})` : `★ Favorites (${favorites.length})`,
      items: favorites,
    });
  }
  Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([label, rows]) => {
      groups.push({ key: label, label: `${label} (${rows.length})`, items: rows });
    });
  return groups;
}

function groupDrillOptions(items: Array<Record<string, string>>, lang: Lang): OptionGroup[] {
  const favorites = items.filter((item) => isFavorite(item.favorite || ""));
  const map = new Map<string, Array<Record<string, string>>>();
  items
    .filter((item) => !isFavorite(item.favorite || ""))
    .forEach((item) => {
      const key = String(item.area || "").trim() || (lang === "ko" ? "미분류" : "Uncategorized");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
  const groups: OptionGroup[] = [];
  if (favorites.length) {
    groups.push({
      key: "favorite",
      label: lang === "ko" ? `★ 즐겨찾기 (${favorites.length})` : `★ Favorites (${favorites.length})`,
      items: favorites,
    });
  }
  Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([label, rows]) => {
      groups.push({ key: label, label: `${label} (${rows.length})`, items: rows });
    });
  return groups;
}

export function PracticeStudioPage({
  lang,
  hud,
  catalogs,
  backingTracks,
  onRefresh,
  notify,
  isActive,
  pipMode,
  tabSwitchPlayback,
  onSessionPipVideoChange,
  onSessionPipVideoControlChange,
  onSessionCompleted,
  xpDisplayScale = 50,
}: Props) {
  const metronome = useMetronome();
  const shortcutRouter = useShortcutRouter();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [practiceType, setPracticeType] = useState<PracticeType>(hud.active_session?.drill_id ? "drill" : "song");
  const [songId, setSongId] = useState(hud.active_session?.song_library_id ?? "");
  const [drillId, setDrillId] = useState(hud.active_session?.drill_id ?? "");
  const [backingId, setBackingId] = useState("");
  const [useBackingTrack, setUseBackingTrack] = useState(false);

  const [songQuery, setSongQuery] = useState("");
  const [drillQuery, setDrillQuery] = useState("");
  const [backingQuery, setBackingQuery] = useState("");

  const [songStatusFilter, setSongStatusFilter] = useState("all");
  const [songGenreFilter, setSongGenreFilter] = useState("all");
  const [drillAreaFilter, setDrillAreaFilter] = useState("all");
  const [drillTagFilter, setDrillTagFilter] = useState("all");

  const [showFilters, setShowFilters] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showBackingFilters, setShowBackingFilters] = useState(false);
  const [showStartPanel, setShowStartPanel] = useState(!Boolean(hud.active_session?.session_id));
  const [startStep, setStartStep] = useState<1 | 2>(1);
  const [zoomAsset, setZoomAsset] = useState<{ kind: "image" | "pdf"; url: string; title: string } | null>(null);
  const [showStopModal, setShowStopModal] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pendingSwitchPrompt, setPendingSwitchPrompt] = useState<PendingSwitchPrompt | null>(null);
  const [showSwitchTimeEditor, setShowSwitchTimeEditor] = useState(false);
  const [switchTimeStartAtInput, setSwitchTimeStartAtInput] = useState("");
  const [switchTimeEndAtInput, setSwitchTimeEndAtInput] = useState("");
  const [switchTimeBusy, setSwitchTimeBusy] = useState(false);
  const [showSwitchTimeUnderMinAlert, setShowSwitchTimeUnderMinAlert] = useState(false);
  const [activePlaybackSurface, setActivePlaybackSurface] = useState<PlaybackSurface>("none");

  const [selectedSongLink, setSelectedSongLink] = useState("");
  const [isSongVideoPlaying, setIsSongVideoPlaying] = useState(false);
  const [songYoutubePlayerState, setSongYoutubePlayerState] = useState(-1);
  const [songYoutubeCurrentSec, setSongYoutubeCurrentSec] = useState(0);
  const [songVideoPinSec, setSongVideoPinSec] = useState<number | null>(null);
  const [songSplitDirection, setSongSplitDirection] = useState<"horizontal" | "vertical">("horizontal");
  const [songSplitRatio, setSongSplitRatio] = useState(0.56);
  const [isSongSplitResizing, setIsSongSplitResizing] = useState(false);
  const songSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const songVideoHostRef = useRef<HTMLDivElement | null>(null);
  const songVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const songVideoIframeRef = useRef<HTMLIFrameElement | null>(null);
  const songYoutubePlayerRef = useRef<YoutubePlayerLike | null>(null);
  const songYoutubePlayerReadyRef = useRef(false);
  const [scoreContentTab, setScoreContentTab] = useState<"pdf" | "images">("pdf");
  const [scorePdfPage, setScorePdfPage] = useState(1);
  const [selectedScoreImage, setSelectedScoreImage] = useState("");
  const [selectedDrillImage, setSelectedDrillImage] = useState("");
  const [scoreImageLayout, setScoreImageLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [scoreVisibleCount, setScoreVisibleCount] = useState(2);
  const [linkedSongRecords, setLinkedSongRecords] = useState<RecordPost[]>([]);
  const [backingGenreFilter, setBackingGenreFilter] = useState("all");
  const [backingBpmMin, setBackingBpmMin] = useState("");
  const [backingBpmMax, setBackingBpmMax] = useState("");
  const songYoutubeCurrentSecRef = useRef(0);
  const prevSelectedSongIdRef = useRef(String(hud.active_session?.song_library_id || ""));
  const activeStart = hud.active_session?.start_at ? new Date(hud.active_session.start_at).getTime() : 0;
  const setMetronomeProfileKey = metronome.setProfileKey;
  const shortcutBindings = shortcutRouter.bindings.bindings;
  const shortcutText = (actionId: ShortcutActionId) => formatShortcutBinding(shortcutBindings[actionId], lang);

  useEffect(() => {
    void getSessions(1000).then(setSessions).catch(() => undefined);
  }, [hud.total_xp]);

  useEffect(() => {
    if (!activeStart) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - activeStart) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeStart]);

  useEffect(() => {
    if (!songId) {
      setLinkedSongRecords([]);
      return;
    }
    void getRecords({ limit: 300, song_library_id: songId, media_type: "video" })
      .then((rows) => setLinkedSongRecords(rows))
      .catch(() => setLinkedSongRecords([]));
  }, [songId, hud.total_xp]);

  useEffect(() => {
    if (hud.active_session?.session_id && hud.active_session?.song_library_id) {
      setPracticeType("song");
      setSongId(hud.active_session.song_library_id);
      setStartStep(2);
      setShowStartPanel(false);
      return;
    }
    if (hud.active_session?.session_id && hud.active_session?.drill_id) {
      setPracticeType("drill");
      setDrillId(hud.active_session.drill_id);
      setStartStep(2);
      setShowStartPanel(false);
      return;
    }
    if (hud.active_session?.session_id) {
      setSongId("");
      setDrillId("");
      setStartStep(2);
      setShowStartPanel(false);
    }
  }, [hud.active_session?.session_id, hud.active_session?.song_library_id, hud.active_session?.drill_id]);

  useEffect(() => {
    if (hud.active_session?.session_id) return;
    setPendingSwitchPrompt(null);
    setShowSwitchTimeEditor(false);
    setShowSwitchTimeUnderMinAlert(false);
  }, [hud.active_session?.session_id]);

  useEffect(() => {
    if (practiceType === "song" && songId) {
      setMetronomeProfileKey(`song:${songId}`);
      return;
    }
    setMetronomeProfileKey("");
  }, [practiceType, setMetronomeProfileKey, songId]);

  const drillPool = useMemo(
    () => normalizeDrills(catalogs.drills, catalogs.drill_library),
    [catalogs.drills, catalogs.drill_library]
  );

  const songStatusOptions = useMemo(
    () => ["all", ...Array.from(new Set(catalogs.song_library.map((item) => item.status || "").filter(Boolean))).sort()],
    [catalogs.song_library]
  );
  const songGenreOptions = useMemo(
    () => ["all", ...Array.from(new Set(catalogs.song_library.flatMap((item) => splitGenres(item.genre || "")))).sort()],
    [catalogs.song_library]
  );
  const drillAreaOptions = useMemo(
    () => ["all", ...Array.from(new Set(drillPool.map((item) => item.area || "").filter(Boolean))).sort()],
    [drillPool]
  );
  const drillTagOptions = useMemo(
    () => ["all", ...Array.from(new Set(drillPool.flatMap((item) => splitTags(item.tags || "")))).sort()],
    [drillPool]
  );

  const filteredSongs = useMemo(() => {
    return catalogs.song_library.filter((item) => {
      if (songStatusFilter !== "all" && (item.status || "") !== songStatusFilter) return false;
      if (songGenreFilter !== "all" && !splitGenres(item.genre || "").includes(songGenreFilter)) return false;
      return true;
    });
  }, [catalogs.song_library, songStatusFilter, songGenreFilter]);

  const filteredDrills = useMemo(() => {
    return drillPool.filter((item) => {
      if (drillAreaFilter !== "all" && (item.area || "") !== drillAreaFilter) return false;
      if (drillTagFilter !== "all" && !splitTags(item.tags || "").includes(drillTagFilter)) return false;
      return true;
    });
  }, [drillPool, drillAreaFilter, drillTagFilter]);

  const rankedSongs = useMemo(
    () => rankItems(filteredSongs, sessions, "song", songQuery),
    [filteredSongs, sessions, songQuery]
  );
  const rankedDrills = useMemo(
    () => rankItems(filteredDrills, sessions, "drill", drillQuery),
    [filteredDrills, sessions, drillQuery]
  );
  const songOptionGroups = useMemo(() => groupSongOptions(rankedSongs, lang), [rankedSongs, lang]);
  const drillOptionGroups = useMemo(() => groupDrillOptions(rankedDrills, lang), [rankedDrills, lang]);
  const quickSongPicks = useMemo(() => rankedSongs.slice(0, 8), [rankedSongs]);
  const quickDrillPicks = useMemo(() => rankedDrills.slice(0, 8), [rankedDrills]);

  const song = useMemo(
    () => catalogs.song_library.find((item) => item.library_id === songId) ?? null,
    [catalogs.song_library, songId]
  );
  const drill = useMemo(
    () => drillPool.find((item) => item.drill_id === drillId) ?? null,
    [drillPool, drillId]
  );

  const songVideoOptions = useMemo<SongVideoOption[]>(() => {
    if (!song) return [];
    const out: SongVideoOption[] = [];
    const seen = new Set<string>();
    const addOption = (value: string, label: string, group: SongVideoOption["group"]) => {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push({ value: normalized, label, group });
    };

    splitLinks(song.original_url || "").forEach((link, idx) =>
      addOption(link, lang === "ko" ? `메인 URL ${idx + 1}` : `Main URL ${idx + 1}`, "main")
    );
    const subLinks = [...splitLinks(song.sub_urls || ""), ...splitLinks(song.best_take_url || "")];
    subLinks.forEach((link, idx) =>
      addOption(link, lang === "ko" ? `서브 URL ${idx + 1}` : `Sub URL ${idx + 1}`, "sub")
    );

    let journalIndex = 1;
    linkedSongRecords.forEach((post) => {
      const baseTitle = (post.title || "").trim();
      post.attachments
        .filter((attachment) => attachment.media_type === "video")
        .forEach((attachment) => {
          const link = attachment.url || (attachment.path ? `/media/${attachment.path}` : "");
          if (!link) return;
          const labelBase = baseTitle || (lang === "ko" ? "연습영상" : "Journal Video");
          addOption(link, `${labelBase} #${journalIndex}`, "journal");
          journalIndex += 1;
        });
    });
    return out;
  }, [song, linkedSongRecords, lang]);

  const songLinks = useMemo(() => songVideoOptions.map((option) => option.value), [songVideoOptions]);

  useEffect(() => {
    const currentSongId = String(songId || "").trim();
    const prevSongId = prevSelectedSongIdRef.current;
    const songChanged = prevSongId !== currentSongId;
    prevSelectedSongIdRef.current = currentSongId;

    if (!currentSongId) {
      if (selectedSongLink) setSelectedSongLink("");
      return;
    }

    const savedLink = String(readSongVideoSelectionStore()[currentSongId] || "").trim();
    const savedLinkValid = Boolean(savedLink && songLinks.includes(savedLink));
    const currentLinkValid = Boolean(selectedSongLink && songLinks.includes(selectedSongLink));

    if (songChanged) {
      if (savedLinkValid) {
        if (selectedSongLink !== savedLink) setSelectedSongLink(savedLink);
        return;
      }
      if (selectedSongLink) setSelectedSongLink("");
      return;
    }

    if (!selectedSongLink) {
      if (savedLinkValid) setSelectedSongLink(savedLink);
      return;
    }

    if (!currentLinkValid) {
      if (savedLinkValid) {
        setSelectedSongLink(savedLink);
      } else {
        setSelectedSongLink("");
      }
    }
  }, [songId, songLinks, selectedSongLink]);

  const handleSongVideoSourceChange = (nextLinkRaw: string) => {
    const nextLink = String(nextLinkRaw || "").trim();
    setSelectedSongLink(nextLink);
    const currentSongId = String(songId || "").trim();
    if (!currentSongId) return;
    const store = readSongVideoSelectionStore();
    if (nextLink) {
      store[currentSongId] = nextLink;
    } else {
      delete store[currentSongId];
    }
    writeSongVideoSelectionStore(store);
  };

  useEffect(() => {
    setIsSongVideoPlaying(false);
    setSongYoutubePlayerState(-1);
    setSongYoutubeCurrentSec(0);
    songYoutubePlayerReadyRef.current = false;
  }, [selectedSongLink]);

  useEffect(() => {
    songYoutubeCurrentSecRef.current = songYoutubeCurrentSec;
  }, [songYoutubeCurrentSec]);

  useEffect(() => {
    if (!isActive) {
      setActivePlaybackSurface("none");
      return;
    }
    if (activePlaybackSurface === "video" && (practiceType !== "song" || !selectedSongLink)) {
      setActivePlaybackSurface("none");
    }
  }, [activePlaybackSurface, isActive, practiceType, selectedSongLink]);

  useEffect(() => {
    if (practiceType !== "drill") return;
    if (!drill) {
      setBackingId("");
      return;
    }
    setUseBackingTrack(false);
    const defaultBacking = String(drill.default_backing_id || "").trim();
    if (defaultBacking) {
      setBackingId((prev) => prev || defaultBacking);
    }
  }, [practiceType, drill]);

  useEffect(() => {
    if (practiceType !== "drill" && useBackingTrack) {
      setUseBackingTrack(false);
    }
  }, [practiceType, useBackingTrack]);

  useEffect(() => {
    if (hud.active_session?.session_id) return;
    if (practiceType === "song" && !songId) setShowStartPanel(true);
    if (practiceType === "drill" && !drillId) setShowStartPanel(true);
  }, [hud.active_session?.session_id, practiceType, songId, drillId]);

  const backingGenreOptions = useMemo(() => {
    return [
      "all",
      ...Array.from(new Set(backingTracks.map((item) => String(item.genre || "").trim()).filter(Boolean))).sort(),
    ];
  }, [backingTracks]);

  const backingCandidates = useMemo(() => {
    const q = backingQuery.trim().toLowerCase();
    const min = parseBpm(backingBpmMin);
    const max = parseBpm(backingBpmMax);
    const defaultBacking = String(drill?.default_backing_id || "").trim();

    const rows = backingTracks
      .filter((item) => {
        if (!q) return true;
        const text = `${item.backing_id || ""} ${item.title || ""} ${item.genre || ""} ${item.chords || ""} ${item.tags || ""}`.toLowerCase();
        return text.includes(q);
      })
      .filter((item) => {
        if (backingGenreFilter === "all") return true;
        return (item.genre || "") === backingGenreFilter;
      })
      .filter((item) => {
        const bpm = parseBpm(String(item.bpm || ""));
        if (min !== null && bpm !== null && bpm < min) return false;
        if (max !== null && bpm !== null && bpm > max) return false;
        return true;
      });

    rows.sort((a, b) => {
      const aLinked = (a.drill_id || "") === drillId ? 1 : 0;
      const bLinked = (b.drill_id || "") === drillId ? 1 : 0;
      if (aLinked !== bLinked) return bLinked - aLinked;
      const aDefault = (a.backing_id || "") === defaultBacking ? 1 : 0;
      const bDefault = (b.backing_id || "") === defaultBacking ? 1 : 0;
      if (aDefault !== bDefault) return bDefault - aDefault;
      return (a.title || a.backing_id || "").localeCompare(b.title || b.backing_id || "");
    });
    return rows;
  }, [backingTracks, backingQuery, backingGenreFilter, backingBpmMin, backingBpmMax, drillId, drill?.default_backing_id]);

  const backingOptionGroups = useMemo(() => {
    const map = new Map<string, Array<Record<string, string>>>();
    backingCandidates.forEach((item) => {
      const key = String(item.genre || "").trim() || (lang === "ko" ? "기타" : "Others");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, items]) => ({ key: label, label: `${label} (${items.length})`, items }));
  }, [backingCandidates, lang]);

  useEffect(() => {
    if (!useBackingTrack) return;
    if (!backingCandidates.length) {
      setBackingId("");
      return;
    }
    const defaultBacking = String(drill?.default_backing_id || "").trim();
    if (defaultBacking && backingCandidates.some((item) => item.backing_id === defaultBacking)) {
      if (!backingId || !backingCandidates.some((item) => item.backing_id === backingId)) {
        setBackingId(defaultBacking);
      }
      return;
    }
    if (!backingId || !backingCandidates.some((item) => item.backing_id === backingId)) {
      setBackingId(backingCandidates[0].backing_id || "");
    }
  }, [useBackingTrack, backingCandidates, backingId, drill?.default_backing_id]);

  const selectedBacking = useMemo(
    () => backingTracks.find((item) => item.backing_id === backingId) ?? null,
    [backingTracks, backingId]
  );

  const songLinkGroups = useMemo(
    () => [
      {
        key: "main",
        label: lang === "ko" ? "메인 URL" : "Main URL",
        items: songVideoOptions.filter((item) => item.group === "main"),
      },
      {
        key: "sub",
        label: lang === "ko" ? "서브 URL" : "Sub URL",
        items: songVideoOptions.filter((item) => item.group === "sub"),
      },
      {
        key: "journal",
        label: lang === "ko" ? "연습영상" : "Journal Videos",
        items: songVideoOptions.filter((item) => item.group === "journal"),
      },
    ].filter((group) => group.items.length > 0),
    [songVideoOptions, lang]
  );

  const songScorePdf = useMemo(() => mediaSource(song?.score_pdf_path || ""), [song?.score_pdf_path]);
  const songScoreImagePaths = useMemo(() => splitScorePaths(song?.score_image_paths || ""), [song?.score_image_paths]);
  const songScoreImages = useMemo(
    () => songScoreImagePaths.map((path) => mediaSource(path)).filter(Boolean),
    [songScoreImagePaths]
  );
  const hasSongVideo = songVideoOptions.length > 0;
  const hasSongScore = Boolean(songScorePdf) || songScoreImages.length > 0;
  const scorePdfSrc = useMemo(() => withPdfPage(songScorePdf, scorePdfPage), [songScorePdf, scorePdfPage]);
  const selectedScoreIndex = useMemo(() => songScoreImages.indexOf(selectedScoreImage), [songScoreImages, selectedScoreImage]);
  const visibleScoreImageItems = useMemo(() => {
    if (!songScoreImages.length) return [] as Array<{ src: string; index: number }>;
    const safeCount = Math.max(1, Math.min(6, Math.floor(scoreVisibleCount)));
    const count = Math.min(songScoreImages.length, safeCount);
    const anchor = selectedScoreIndex >= 0 ? selectedScoreIndex : 0;
    const maxStart = Math.max(0, songScoreImages.length - count);
    const start = Math.max(0, Math.min(maxStart, anchor - Math.floor(count / 2)));
    return songScoreImages.slice(start, start + count).map((src, offset) => ({ src, index: start + offset }));
  }, [songScoreImages, scoreVisibleCount, selectedScoreIndex]);

  useEffect(() => {
    if (songScorePdf) {
      setScoreContentTab("pdf");
      return;
    }
    if (songScoreImages.length) {
      setScoreContentTab("images");
      return;
    }
    setScoreContentTab("pdf");
  }, [songId, songScorePdf, songScoreImages.length]);

  useEffect(() => {
    setScorePdfPage(1);
  }, [songId, songScorePdf]);

  useEffect(() => {
    if (!songScoreImages.length) {
      setSelectedScoreImage("");
      return;
    }
    if (!selectedScoreImage || !songScoreImages.includes(selectedScoreImage)) {
      setSelectedScoreImage(songScoreImages[0]);
    }
  }, [songScoreImages, selectedScoreImage]);

  useEffect(() => {
    if (!songId) return;
    if (songLinks.length && hasSongScore) return;
    setSongSplitRatio(0.56);
  }, [songId, songLinks.length, hasSongScore]);

  const songCover = useMemo(() => coverSource(song), [song]);
  const songEmbed = useMemo(() => toYoutubeEmbed(selectedSongLink), [selectedSongLink]);
  const songDirectVideo = useMemo(() => (isPlayableVideoUrl(selectedSongLink) ? selectedSongLink : ""), [selectedSongLink]);
  const currentVideoPinKey = useMemo(() => String(selectedSongLink || "").trim(), [selectedSongLink]);
  const backingEmbed = useMemo(() => toYoutubeEmbed(selectedBacking?.youtube_url || ""), [selectedBacking?.youtube_url]);
  const drillImages = useMemo(() => drillImageSources(drill), [drill]);
  const songVideoPlaying = useMemo(() => {
    if (songDirectVideo && songVideoElementRef.current) {
      const node = songVideoElementRef.current;
      return !node.paused && !node.ended;
    }
    if (songEmbed) {
      return songYoutubePlayerState === 1 || songYoutubePlayerState === 3 || isSongVideoPlaying;
    }
    return false;
  }, [songDirectVideo, songEmbed, songYoutubePlayerState, isSongVideoPlaying]);

  useEffect(() => {
    if (!currentVideoPinKey) {
      setSongVideoPinSec(null);
      return;
    }
    const store = readVideoPinStore();
    const saved = store[currentVideoPinKey];
    if (!Number.isFinite(saved) || saved < 0) {
      setSongVideoPinSec(null);
      return;
    }
    setSongVideoPinSec(saved);
  }, [currentVideoPinKey]);

  useEffect(() => {
    if (!drillImages.length) {
      setSelectedDrillImage("");
      return;
    }
    if (!selectedDrillImage || !drillImages.includes(selectedDrillImage)) {
      setSelectedDrillImage(drillImages[0]);
    }
  }, [drillImages, selectedDrillImage, drillId]);

  const targetLogs = useMemo(() => {
    const filtered = sessions
      .filter((item) =>
        practiceType === "song"
          ? Boolean(songId) && item.song_library_id === songId
          : Boolean(drillId) && item.drill_id === drillId
      )
      .sort((a, b) => (b.start_at || "").localeCompare(a.start_at || ""));
    return filtered.slice(0, 30);
  }, [sessions, practiceType, songId, drillId]);

  const targetSummary = useMemo(() => {
    const totalSessions = targetLogs.length;
    const totalMinutes = targetLogs.reduce((acc, item) => acc + (item.duration_min || 0), 0);
    const totalXp = targetLogs.reduce((acc, item) => acc + (item.xp || 0), 0);
    const firstAt = targetLogs[totalSessions - 1]?.start_at || "";
    const lastAt = targetLogs[0]?.start_at || "";
    return { totalSessions, totalMinutes, totalXp, firstAt, lastAt };
  }, [targetLogs]);

  const restoreActiveSelection = () => {
    const activeSongId = String(hud.active_session?.song_library_id || "");
    const activeDrillId = String(hud.active_session?.drill_id || "");
    if (activeSongId) {
      setPracticeType("song");
      setSongId(activeSongId);
      setDrillId("");
      return;
    }
    if (activeDrillId) {
      setPracticeType("drill");
      setDrillId(activeDrillId);
      setSongId("");
      return;
    }
    setSongId("");
    setDrillId("");
  };

  const buildTargetPayload = (nextType: PracticeType, nextId: string) => {
    if (nextType === "song") {
      const nextSong = catalogs.song_library.find((item) => item.library_id === nextId) ?? null;
      return {
        activity: "Song",
        sub_activity: "SongPractice",
        song_library_id: nextId,
        title: nextSong?.title || "",
      };
    }
    const nextDrill = drillPool.find((item) => item.drill_id === nextId) ?? null;
    return {
      activity: "Drill",
      sub_activity: drillSubActivity(nextDrill),
      drill_id: nextId,
      title: nextDrill?.name || "",
    };
  };

  const switchStopTags = (activity: "Song" | "Drill" | "Etc", subActivity: string) => {
    const subTagMap: Record<string, string> = {
      SongPractice: "SONG_PRACTICE",
      SongLearn: "SONG_LEARN",
      SongCopy: "SONG_COPY",
      Core: "CORE",
      Funk: "FUNK",
      Slap: "SLAP",
      Theory: "THEORY",
      SongDiscovery: "SONG_DISCOVERY",
      Community: "COMMUNITY",
      Gear: "GEAR",
      Etc: "ETC",
    };
    return [activity.toUpperCase(), subTagMap[subActivity] || ""].filter(Boolean);
  };

  const runSwitchSession = async (
    nextType: PracticeType,
    nextId: string,
    options?: {
      chainSavedSegments?: Array<Record<string, unknown>>;
      chainUnderMinCount?: number;
    }
  ): Promise<boolean> => {
    const switchPayload: Record<string, unknown> = { ...buildTargetPayload(nextType, nextId) };
    if (options?.chainSavedSegments) {
      switchPayload.chain_saved_segments = options.chainSavedSegments;
    }
    if (typeof options?.chainUnderMinCount === "number") {
      switchPayload.chain_under_min_count = Math.max(0, Math.floor(options.chainUnderMinCount));
    }
    const switched = await switchSession(switchPayload as Parameters<typeof switchSession>[0]);
    if (switched.under_min_skipped) {
      notify(lang === "ko" ? "10분 미만 세션은 저장되지 않았습니다." : "The under-10-minute segment was skipped.", "info");
    }
    notify(lang === "ko" ? "세션 전환 완료" : "Session switched", "success");
    if (nextType === "song") {
      setPracticeType("song");
      setSongId(nextId);
      setDrillId("");
    } else {
      setPracticeType("drill");
      setDrillId(nextId);
      setSongId("");
    }
    setShowStartPanel(false);
    await onRefresh();
    return true;
  };

  const buildSwitchStopPayload = (startIso: string, endIso: string) => {
    const activeSongId = String(hud.active_session?.song_library_id || "");
    const activeDrillId = String(hud.active_session?.drill_id || "");
    let activity: "Song" | "Drill" | "Etc" = "Etc";
    let subActivity = String(hud.active_session?.sub_activity || "Etc") || "Etc";
    if (activeSongId) {
      activity = "Song";
      if (!subActivity || subActivity === "Etc") subActivity = "SongPractice";
    } else if (activeDrillId) {
      activity = "Drill";
      if (!subActivity || subActivity === "Etc") subActivity = "Core";
    }
    return {
      activity,
      sub_activity: subActivity,
      song_library_id: activity === "Song" ? activeSongId : "",
      drill_id: activity === "Drill" ? activeDrillId : "",
      notes: String(hud.active_session?.notes || ""),
      start_at: startIso,
      end_at: endIso,
      tags: switchStopTags(activity, subActivity),
    };
  };

  const closePendingSwitchPrompt = () => {
    setPendingSwitchPrompt(null);
    restoreActiveSelection();
  };

  const confirmPendingSwitch = async () => {
    const pending = pendingSwitchPrompt;
    if (!pending) return;
    setPendingSwitchPrompt(null);
    try {
      await runSwitchSession(pending.nextType, pending.nextId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Switch failed", "error");
      restoreActiveSelection();
    }
  };

  const openSwitchTimeEditor = () => {
    const activeStartValue = String(hud.active_session?.start_at || "");
    const now = new Date();
    const startValue = toDatetimeLocalInput(activeStartValue, new Date(now.getTime() - 10 * 60 * 1000));
    const startDate = new Date(startValue);
    let endDate = now;
    if (!Number.isNaN(startDate.getTime()) && endDate.getTime() <= startDate.getTime()) {
      endDate = new Date(startDate.getTime() + 60 * 1000);
    }
    setSwitchTimeStartAtInput(startValue);
    setSwitchTimeEndAtInput(toDatetimeLocalInput(undefined, endDate));
    setShowSwitchTimeUnderMinAlert(false);
    setShowSwitchTimeEditor(true);
  };

  const closeSwitchTimeEditor = () => {
    setShowSwitchTimeEditor(false);
    setShowSwitchTimeUnderMinAlert(false);
    setPendingSwitchPrompt(null);
    restoreActiveSelection();
  };

  const saveSwitchTimeAndSwitch = async () => {
    const pending = pendingSwitchPrompt;
    if (!pending) return;
    const startIso = toIsoIfValid(switchTimeStartAtInput);
    const endIso = toIsoIfValid(switchTimeEndAtInput);
    if (!startIso || !endIso) {
      notify(lang === "ko" ? "시작/종료 시간을 확인해주세요." : "Please check start/end time.", "error");
      return;
    }
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (end.getTime() <= start.getTime()) {
      notify(lang === "ko" ? "종료 시각이 시작보다 늦어야 합니다." : "End time must be later than start time.", "error");
      return;
    }
    const durationMin = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
    if (durationMin < 10) {
      setShowSwitchTimeUnderMinAlert(true);
      return;
    }

    try {
      setSwitchTimeBusy(true);
      const stopPayload = buildSwitchStopPayload(startIso, endIso);
      const stopResult = await stopSession(stopPayload);
      const chainSegments = (stopResult.session_chain?.segments || []) as Array<Record<string, unknown>>;
      const chainUnderMinCount = Math.max(0, Number(hud.active_session?.chain_under_min_count || 0));
      setShowSwitchTimeEditor(false);
      setShowSwitchTimeUnderMinAlert(false);
      await runSwitchSession(pending.nextType, pending.nextId, {
        chainSavedSegments: chainSegments,
        chainUnderMinCount,
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Switch save failed", "error");
      restoreActiveSelection();
    } finally {
      setSwitchTimeBusy(false);
      setPendingSwitchPrompt(null);
    }
  };

  const requestTargetSwitch = async (nextType: PracticeType, nextId: string): Promise<boolean> => {
    if (!hud.active_session?.session_id) return false;
    if (!nextId) {
      restoreActiveSelection();
      return false;
    }
    const activeSongId = String(hud.active_session.song_library_id || "");
    const activeDrillId = String(hud.active_session.drill_id || "");
    const sameTarget = nextType === "song" ? activeSongId === nextId : activeDrillId === nextId;
    if (sameTarget && (activeSongId || activeDrillId)) {
      if (nextType === "song") setSongId(nextId);
      else setDrillId(nextId);
      return true;
    }

    const hasActiveTarget = Boolean(activeSongId || activeDrillId);
    if (!hasActiveTarget) {
      try {
        await retargetSession(buildTargetPayload(nextType, nextId));
        notify(lang === "ko" ? "현재 세션 대상이 변경되었습니다." : "Current session target updated.", "success");
        if (nextType === "song") {
          setPracticeType("song");
          setSongId(nextId);
          setDrillId("");
        } else {
          setPracticeType("drill");
          setDrillId(nextId);
          setSongId("");
        }
        setShowStartPanel(false);
        await onRefresh();
        return true;
      } catch (error) {
        notify(error instanceof Error ? error.message : "Retarget failed", "error");
        restoreActiveSelection();
        return false;
      }
    }

    const underMin = elapsedSec < 10 * 60;
    setPendingSwitchPrompt({ nextType, nextId, underMin });
    return false;
  };

  useShortcutLayer(
    pendingSwitchPrompt && !showSwitchTimeEditor
      ? {
          priority: 520,
          allowInEditable: true,
          handlers: {
            popup_close: () => {
              closePendingSwitchPrompt();
            },
            popup_primary: () => {
              void confirmPendingSwitch();
            },
            popup_destructive: () => {
              if (!pendingSwitchPrompt.underMin) return false;
              void confirmPendingSwitch();
            },
            popup_alternate: () => {
              if (!pendingSwitchPrompt.underMin) return false;
              openSwitchTimeEditor();
            },
          },
        }
      : null
  );

  useShortcutLayer(
    showSwitchTimeEditor
      ? {
          priority: 530,
          allowInEditable: true,
          handlers: {
            popup_close: () => {
              if (switchTimeBusy) return false;
              closeSwitchTimeEditor();
            },
            popup_primary: () => {
              if (switchTimeBusy) return false;
              void saveSwitchTimeAndSwitch();
            },
          },
        }
      : null
  );

  useShortcutLayer(
    showSwitchTimeUnderMinAlert
      ? {
          priority: 540,
          allowInEditable: true,
          handlers: {
            popup_close: () => {
              setShowSwitchTimeUnderMinAlert(false);
            },
            popup_primary: () => {
              setShowSwitchTimeUnderMinAlert(false);
            },
          },
        }
      : null
  );

  const startTargetSession = async () => {
    const hasActive = Boolean(hud.active_session?.session_id);
    const nextId = practiceType === "song" ? songId : drillId;
    if (hasActive) {
      await requestTargetSwitch(practiceType, nextId);
      return;
    }
    if (practiceType === "song") {
      if (!songId) {
        notify(lang === "ko" ? "먼저 곡을 선택해주세요." : "Select a song first.", "error");
        return;
      }
      await startSession({
        activity: "Song",
        sub_activity: "SongPractice",
        song_library_id: songId,
        title: song?.title || "",
      });
    } else {
      if (!drillId) {
        notify(lang === "ko" ? "먼저 드릴을 선택해주세요." : "Select a drill first.", "error");
        return;
      }
      await startSession({
        activity: "Drill",
        sub_activity: drillSubActivity(drill),
        drill_id: drillId,
        title: drill?.name || "",
      });
    }
    notify(lang === "ko" ? "세션 시작" : "Session started", "success");
    setShowStartPanel(false);
    await onRefresh();
  };

  const openZoomAsset = (kind: "image" | "pdf", url: string, title: string) => {
    setZoomAsset({ kind, url, title });
  };

  const beginSongSplitResize = (event: { clientX: number; clientY: number; preventDefault: () => void }) => {
    event.preventDefault();
    const container = songSplitContainerRef.current;
    if (!container) return;
    const dragDirection = songSplitDirection;
    setIsSongSplitResizing(true);

    const updateRatioFromPoint = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (dragDirection === "horizontal") {
        const raw = (clientX - rect.left) / Math.max(1, rect.width);
        setSongSplitRatio(Math.max(0.25, Math.min(0.75, raw)));
        return;
      }
      const raw = (clientY - rect.top) / Math.max(1, rect.height);
      setSongSplitRatio(Math.max(0.25, Math.min(0.75, raw)));
    };

    const onMove = (moveEvent: MouseEvent) => {
      updateRatioFromPoint(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setIsSongSplitResizing(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    updateRatioFromPoint(event.clientX, event.clientY);
  };

  const postYoutubeCommand = (func: string, args: Array<string | number | boolean> = []) => {
    const iframe = songVideoIframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  };

  const readYoutubePlayerCurrentSecond = (): number | null => {
    if (!songYoutubePlayerReadyRef.current) return null;
    const player = songYoutubePlayerRef.current;
    if (!player || typeof player.getCurrentTime !== "function") return null;
    const second = Number(player.getCurrentTime());
    if (!Number.isFinite(second) || second < 0) return null;
    return second;
  };

  const readYoutubePlayerState = (): number | null => {
    if (!songYoutubePlayerReadyRef.current) return null;
    const player = songYoutubePlayerRef.current;
    if (!player || typeof player.getPlayerState !== "function") return null;
    const state = Number(player.getPlayerState());
    if (!Number.isFinite(state)) return null;
    return state;
  };

  const applyYoutubePlaybackState = (state: number) => {
    setSongYoutubePlayerState(state);
    if (state === 1 || state === 3) setIsSongVideoPlaying(true);
    if (state === 0 || state === 2 || state === -1 || state === 5) setIsSongVideoPlaying(false);
  };

  const shiftScoreImage = (direction: -1 | 1) => {
    if (!songScoreImages.length) return;
    setSelectedScoreImage((prev) => {
      const current = songScoreImages.indexOf(prev);
      const base = current >= 0 ? current : 0;
      const next = (base + direction + songScoreImages.length) % songScoreImages.length;
      return songScoreImages[next];
    });
  };

  const shiftScorePdfPage = (direction: -1 | 1) => {
    setScorePdfPage((prev) => Math.max(1, prev + direction));
  };

  const isSongVideoPlayingNow = (): boolean => {
    if (songDirectVideo && songVideoElementRef.current) {
      const node = songVideoElementRef.current;
      return !node.paused && !node.ended;
    }
    if (songEmbed) {
      const playerState = readYoutubePlayerState();
      if (playerState !== null) {
        return playerState === 1 || playerState === 3;
      }
      return songYoutubePlayerState === 1 || songYoutubePlayerState === 3 || isSongVideoPlaying;
    }
    return false;
  };

  const toggleSongVideoPlayback = () => {
    const currentlyPlaying = isSongVideoPlayingNow();
    if (songDirectVideo && songVideoElementRef.current) {
      const target = songVideoElementRef.current;
      if (target.paused || target.ended) {
        void target.play().catch(() => undefined);
        setIsSongVideoPlaying(true);
      } else {
        target.pause();
        setIsSongVideoPlaying(false);
      }
      return;
    }
    if (songEmbed && songVideoIframeRef.current) {
      const player = songYoutubePlayerRef.current;
      if (currentlyPlaying) {
        if (player?.pauseVideo) player.pauseVideo();
        else postYoutubeCommand("pauseVideo");
        setIsSongVideoPlaying(false);
        setSongYoutubePlayerState(2);
      } else {
        if (player?.playVideo) player.playVideo();
        else postYoutubeCommand("playVideo");
        setIsSongVideoPlaying(true);
        setSongYoutubePlayerState(1);
      }
    }
  };

  const pauseSongVideoPlayback = () => {
    if (songDirectVideo && songVideoElementRef.current) {
      songVideoElementRef.current.pause();
      setIsSongVideoPlaying(false);
      return;
    }
    if (songEmbed && songVideoIframeRef.current) {
      const player = songYoutubePlayerRef.current;
      if (player?.pauseVideo) player.pauseVideo();
      else postYoutubeCommand("pauseVideo");
      setIsSongVideoPlaying(false);
      setSongYoutubePlayerState(2);
    }
  };

  const getCurrentSongVideoSecond = () => {
    if (songDirectVideo && songVideoElementRef.current) {
      return Math.max(0, Number(songVideoElementRef.current.currentTime || 0));
    }
    if (songEmbed) {
      const playerSecond = readYoutubePlayerCurrentSecond();
      if (playerSecond !== null) return Math.max(0, playerSecond);
      return Math.max(0, Number(songYoutubeCurrentSecRef.current || 0));
    }
    return 0;
  };

  const requestFreshYoutubeCurrentSecond = () => {
    const iframe = songVideoIframeRef.current;
    if (!songEmbed || !iframe?.contentWindow) {
      return Promise.resolve(Math.max(0, Number(songYoutubeCurrentSecRef.current || 0)));
    }
    const directSecond = readYoutubePlayerCurrentSecond();
    if (directSecond !== null && directSecond > 0) {
      return Promise.resolve(Math.max(0, directSecond));
    }
    if (directSecond !== null) {
      const state = readYoutubePlayerState();
      if (state !== 1 && state !== 3) {
        return Promise.resolve(Math.max(0, directSecond));
      }
    }
    return new Promise<number>((resolve) => {
      let settled = false;
      const startedAt = Date.now();
      let timeoutId = 0;
      let pollId = 0;
      const finish = (value: number) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        window.clearInterval(pollId);
        window.removeEventListener("message", onMessage);
        resolve(Math.max(0, Number(value || 0)));
      };
      const onMessage = (event: MessageEvent) => {
        if (!isYoutubeMessageFromCurrentIframe(event, iframe)) return;
        const currentTime = extractYoutubeCurrentTimeFromMessage(event.data);
        if (currentTime === null) return;
        setSongYoutubeCurrentSec(currentTime);
        finish(currentTime);
      };
      pollId = window.setInterval(() => {
        const playerSecond = readYoutubePlayerCurrentSecond();
        if (playerSecond !== null) {
          setSongYoutubeCurrentSec(playerSecond);
          const state = readYoutubePlayerState();
          if (playerSecond > 0 || (state !== 1 && state !== 3)) {
            finish(playerSecond);
            return;
          }
        }
        if (Date.now() - startedAt > 760) {
          finish(Math.max(0, Number(songYoutubeCurrentSecRef.current || 0)));
        }
      }, 90);
      timeoutId = window.setTimeout(() => {
        finish(Math.max(0, Number(songYoutubeCurrentSecRef.current || 0)));
      }, 720);
      window.addEventListener("message", onMessage);
      postYoutubeCommand("getCurrentTime");
      window.setTimeout(() => postYoutubeCommand("getCurrentTime"), 140);
    });
  };

  const seekSongVideoTo = (second: number) => {
    const targetSecond = Math.max(0, Number(second || 0));
    const shouldResume = isSongVideoPlayingNow();
    if (songDirectVideo && songVideoElementRef.current) {
      const target = songVideoElementRef.current;
      target.currentTime = targetSecond;
      if (shouldResume) void target.play().catch(() => undefined);
      return;
    }
    if (songEmbed && songVideoIframeRef.current) {
      const player = songYoutubePlayerRef.current;
      if (player?.seekTo) {
        player.seekTo(targetSecond, true);
        if (shouldResume && player.playVideo) player.playVideo();
      } else {
        postYoutubeCommand("seekTo", [targetSecond, true]);
        if (shouldResume) postYoutubeCommand("playVideo");
      }
    }
  };

  const resetSongVideoToStart = () => {
    seekSongVideoTo(0);
  };

  const saveSongVideoPinAtCurrent = () => {
    const key = currentVideoPinKey;
    if (!key) return;
    const commit = (rawSecond: number) => {
      const currentSecond = Math.max(0, Math.floor(rawSecond));
      const store = readVideoPinStore();
      store[key] = currentSecond;
      writeVideoPinStore(store);
      setSongVideoPinSec(currentSecond);
      notify(
        lang === "ko"
          ? `영상 핀 저장: ${formatVideoSecond(currentSecond)}`
          : `Video pin saved: ${formatVideoSecond(currentSecond)}`,
        "success"
      );
    };
    if (songEmbed) {
      const stableFallbackSecond = Math.max(0, Number(songYoutubeCurrentSecRef.current || 0));
      void requestFreshYoutubeCurrentSecond()
        .then(async (second) => {
          let resolvedSecond = Math.max(
            0,
            second,
            stableFallbackSecond,
            Number(readYoutubePlayerCurrentSecond() || 0),
          );
          if (resolvedSecond <= 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
            const retrySecond = await requestFreshYoutubeCurrentSecond();
            resolvedSecond = Math.max(
              0,
              resolvedSecond,
              retrySecond,
              Number(readYoutubePlayerCurrentSecond() || 0),
              Number(songYoutubeCurrentSecRef.current || 0),
            );
          }
          commit(resolvedSecond);
        })
        .catch(() => commit(stableFallbackSecond));
      return;
    }
    commit(getCurrentSongVideoSecond());
  };

  const clearSongVideoPin = () => {
    const key = currentVideoPinKey;
    if (!key) return;
    const store = readVideoPinStore();
    if (Object.prototype.hasOwnProperty.call(store, key)) {
      delete store[key];
      writeVideoPinStore(store);
    }
    setSongVideoPinSec(null);
  };

  const jumpSongVideoToPin = () => {
    if (songVideoPinSec === null) {
      resetSongVideoToStart();
      return;
    }
    seekSongVideoTo(songVideoPinSec);
  };

  useEffect(() => {
    if (!songEmbed) {
      const player = songYoutubePlayerRef.current;
      songYoutubePlayerRef.current = null;
      songYoutubePlayerReadyRef.current = false;
      if (player?.destroy) {
        try {
          player.destroy();
        } catch {
          // Ignore player destroy failures.
        }
      }
      return;
    }
    const iframe = songVideoIframeRef.current;
    if (!iframe) return;
    let cancelled = false;

    const initYoutubePlayer = async () => {
      try {
        const YT = await loadYoutubeIframeApi();
        if (cancelled || !YT.Player) return;

        const prevPlayer = songYoutubePlayerRef.current;
        songYoutubePlayerRef.current = null;
        songYoutubePlayerReadyRef.current = false;
        if (prevPlayer?.destroy) {
          try {
            prevPlayer.destroy();
          } catch {
            // Ignore player destroy failures.
          }
        }

        const player = new YT.Player(iframe, {
          events: {
            onReady: (event) => {
              if (cancelled) return;
              songYoutubePlayerRef.current = event.target;
              songYoutubePlayerReadyRef.current = true;
              const second = Number(event.target.getCurrentTime?.() ?? 0);
              if (Number.isFinite(second) && second >= 0) {
                setSongYoutubeCurrentSec(second);
              }
              const state = Number(event.target.getPlayerState?.() ?? -1);
              if (Number.isFinite(state)) {
                applyYoutubePlaybackState(state);
              }
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const state = Number(event.data);
              if (!Number.isFinite(state)) return;
              applyYoutubePlaybackState(state);
              const second = readYoutubePlayerCurrentSecond();
              if (second !== null) {
                setSongYoutubeCurrentSec(second);
              }
            },
          },
        });
        songYoutubePlayerRef.current = player;
      } catch {
        songYoutubePlayerReadyRef.current = false;
        // Keep postMessage fallback path when API bootstrap fails.
      }
    };

    void initYoutubePlayer();
    return () => {
      cancelled = true;
      const player = songYoutubePlayerRef.current;
      songYoutubePlayerRef.current = null;
      songYoutubePlayerReadyRef.current = false;
      if (player?.destroy) {
        try {
          player.destroy();
        } catch {
          // Ignore player destroy failures.
        }
      }
    };
  }, [songEmbed, selectedSongLink]);

  useEffect(() => {
    if (!songEmbed) {
      setSongYoutubePlayerState(-1);
      return;
    }
    const iframe = songVideoIframeRef.current;
    if (!iframe) return;

    const send = (func: string, args: Array<string | number | boolean> = []) => {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    };

    const bindYoutubeEvents = () => {
      send("addEventListener", ["onReady"]);
      send("addEventListener", ["onStateChange"]);
    };

    const onLoad = () => bindYoutubeEvents();
    iframe.addEventListener("load", onLoad);
    bindYoutubeEvents();

    const infoTimer = window.setInterval(() => {
      send("getCurrentTime");
      send("getPlayerState");
    }, 450);

    const onMessage = (event: MessageEvent) => {
      if (!isYoutubeMessageFromCurrentIframe(event, iframe)) return;
      let payload: unknown = event.data;
      if (typeof payload === "string") {
        const trimmed = payload.trim();
        if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return;
        try {
          payload = JSON.parse(trimmed);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== "object") return;
      const data = payload as Record<string, unknown>;
      if (data.event === "onStateChange") {
        const state = Number(data.info);
        if (Number.isFinite(state)) {
          setSongYoutubePlayerState(state);
          if (state === 1 || state === 3) setIsSongVideoPlaying(true);
          if (state === 0 || state === 2 || state === -1 || state === 5) setIsSongVideoPlaying(false);
        }
      }
      const info = data.info;
      if (typeof info === "number") {
        if (Number.isFinite(info)) {
          const state = Number(info);
          setSongYoutubePlayerState(state);
          if (state === 1 || state === 3) setIsSongVideoPlaying(true);
          if (state === 0 || state === 2 || state === -1 || state === 5) setIsSongVideoPlaying(false);
        }
        return;
      }
      if (!info || typeof info !== "object") return;
      const infoObj = info as Record<string, unknown>;
      const currentTime = Number(infoObj.currentTime);
      if (Number.isFinite(currentTime) && currentTime >= 0) {
        setSongYoutubeCurrentSec(currentTime);
      }
      const playerState = Number(infoObj.playerState);
      if (Number.isFinite(playerState)) {
        setSongYoutubePlayerState(playerState);
        if (playerState === 1 || playerState === 3) setIsSongVideoPlaying(true);
        if (playerState === 0 || playerState === 2 || playerState === -1 || playerState === 5) setIsSongVideoPlaying(false);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      iframe.removeEventListener("load", onLoad);
      window.clearInterval(infoTimer);
      window.removeEventListener("message", onMessage);
    };
  }, [songEmbed, selectedSongLink]);

  const toggleFullscreenElement = (target: HTMLElement | null) => {
    if (!target || typeof target.requestFullscreen !== "function") return;
    if (document.fullscreenElement === target) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (document.fullscreenElement) {
      void document
        .exitFullscreen()
        .catch(() => undefined)
        .finally(() => void target.requestFullscreen().catch(() => undefined));
      return;
    }
    void target.requestFullscreen().catch(() => undefined);
  };

  const toggleSongVideoFullscreen = () => {
    toggleFullscreenElement(songVideoHostRef.current);
  };

  const openScoreZoom = () => {
    if (scoreContentTab === "pdf" && songScorePdf) {
      openZoomAsset("pdf", scorePdfSrc, song?.title || "score-pdf");
      return;
    }
    if (selectedScoreImage) {
      openZoomAsset("image", selectedScoreImage, song?.title || "score-image");
      return;
    }
    if (songScoreImages[0]) {
      setSelectedScoreImage(songScoreImages[0]);
      openZoomAsset("image", songScoreImages[0], song?.title || "score-image");
    }
  };

  useEffect(() => {
    if (!zoomAsset) return;
    if (zoomAsset.kind === "image" && selectedScoreImage) {
      if (zoomAsset.url !== selectedScoreImage) {
        setZoomAsset((prev) => (prev ? { ...prev, url: selectedScoreImage } : prev));
      }
      return;
    }
    if (zoomAsset.kind === "pdf" && songScorePdf) {
      const nextUrl = withPdfPage(songScorePdf, scorePdfPage);
      if (zoomAsset.url !== nextUrl) {
        setZoomAsset((prev) => (prev ? { ...prev, url: nextUrl } : prev));
      }
    }
  }, [zoomAsset, selectedScoreImage, songScorePdf, scorePdfPage]);
  const practiceShortcutModalOpen =
    showStopModal || Boolean(pendingSwitchPrompt) || showSwitchTimeEditor || showSwitchTimeUnderMinAlert;
  const hasSongVideoShortcutTarget = practiceType === "song" && Boolean(songDirectVideo || songEmbed);

  useShortcutLayer(
    isActive && !practiceShortcutModalOpen
      ? {
          priority: 300,
          handlers: {
            metronome_toggle: () => {
              void metronome.toggle();
            },
            video_toggle: () => {
              if (!hasSongVideoShortcutTarget) return false;
              toggleSongVideoPlayback();
            },
            video_restart: () => {
              if (!hasSongVideoShortcutTarget) return false;
              resetSongVideoToStart();
            },
            video_fullscreen: () => {
              if (!hasSongVideoShortcutTarget) return false;
              toggleSongVideoFullscreen();
            },
            video_pin_save: () => {
              if (!hasSongVideoShortcutTarget) return false;
              saveSongVideoPinAtCurrent();
            },
            video_pin_jump: () => {
              if (!hasSongVideoShortcutTarget) return false;
              jumpSongVideoToPin();
            },
            video_pin_clear: () => {
              if (!hasSongVideoShortcutTarget || songVideoPinSec === null) return false;
              clearSongVideoPin();
            },
            score_zoom: () => {
              if (practiceType !== "song") return false;
              if (zoomAsset) {
                setZoomAsset(null);
              } else {
                openScoreZoom();
              }
            },
            score_prev: () => {
              if (practiceType !== "song") return false;
              if (zoomAsset?.kind === "image" || (scoreContentTab === "images" && songScoreImages.length)) {
                shiftScoreImage(-1);
                return;
              }
              if (zoomAsset?.kind === "pdf" || (scoreContentTab === "pdf" && songScorePdf)) {
                shiftScorePdfPage(-1);
                return;
              }
              return false;
            },
            score_next: () => {
              if (practiceType !== "song") return false;
              if (zoomAsset?.kind === "image" || (scoreContentTab === "images" && songScoreImages.length)) {
                shiftScoreImage(1);
                return;
              }
              if (zoomAsset?.kind === "pdf" || (scoreContentTab === "pdf" && songScorePdf)) {
                shiftScorePdfPage(1);
                return;
              }
              return false;
            },
          },
        }
      : null
  );

  useShortcutLayer(
    isActive && Boolean(zoomAsset) && !practiceShortcutModalOpen
      ? {
          priority: 340,
          handlers: {
            popup_close: () => {
              setZoomAsset(null);
            },
          },
        }
      : null
  );

  useEffect(() => {
    if (isActive) return;
    const hasSongMedia = practiceType === "song" && (Boolean(songDirectVideo) || Boolean(songEmbed));
    if (!hasSongMedia) return;
    if (tabSwitchPlayback === "pause") {
      pauseSongVideoPlayback();
      return;
    }
    if (tabSwitchPlayback === "continue") return;
    if (pipMode === "none") {
      pauseSongVideoPlayback();
      return;
    }
    if (pipMode === "mini") return;
  }, [
    isActive,
    practiceType,
    songDirectVideo,
    songEmbed,
    tabSwitchPlayback,
    pipMode,
  ]);

  const renderSongVideoPanel = () => {
    const hasVideoSource = Boolean(selectedSongLink);
    const canControlEmbeddedVideo = Boolean(songEmbed || songDirectVideo);
    return (
      <div
        className={`studio-video-surface studio-control-surface ${activePlaybackSurface === "video" ? "active" : ""}`}
        onMouseDownCapture={() => setActivePlaybackSurface("video")}
        onFocusCapture={() => setActivePlaybackSurface("video")}
      >
        {songEmbed ? (
          <div className="studio-video-wrap" ref={songVideoHostRef}>
            <iframe
              id={SONG_VIDEO_IFRAME_ID}
              ref={songVideoIframeRef}
              className="studio-video studio-song-iframe studio-song-iframe-hero"
              src={songEmbed}
              title={song?.title || song?.library_id || "song-video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        ) : songDirectVideo ? (
          <div className="studio-video-wrap" ref={songVideoHostRef}>
            <video
              ref={songVideoElementRef}
              className="studio-video studio-song-iframe studio-song-iframe-hero"
              src={songDirectVideo}
              controls
              playsInline
              onPlay={() => {
                setIsSongVideoPlaying(true);
                setSongYoutubePlayerState(1);
              }}
              onPause={() => {
                setIsSongVideoPlaying(false);
                setSongYoutubePlayerState(2);
              }}
              onTimeUpdate={(event) => setSongYoutubeCurrentSec(Math.max(0, Number(event.currentTarget.currentTime || 0)))}
            />
          </div>
        ) : hasVideoSource ? (
          <div className="row song-video-external-row">
            <small className="muted">
              {lang === "ko" ? "앱 내 임베드가 불가한 링크입니다. 외부에서 열어주세요." : "This source cannot be embedded. Open externally."}
            </small>
            <button
              className="ghost-btn"
              onClick={() => {
                if (!selectedSongLink) return;
                window.open(selectedSongLink, "_blank", "noopener,noreferrer");
              }}
              disabled={!selectedSongLink}
            >
              {lang === "ko" ? "링크 열기" : "Open Link"}
            </button>
          </div>
        ) : (
          <small className="muted">{lang === "ko" ? "영상이 숨겨져 있습니다." : "Video is hidden."}</small>
        )}

        <div className="song-video-controls">
          <div className="song-video-action-row">
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              data-testid="studio-video-toggle"
              onClick={toggleSongVideoPlayback}
              disabled={!canControlEmbeddedVideo}
            >
              {songVideoPlaying
                ? (lang === "ko" ? `일시정지 · ${shortcutText("video_toggle")}` : `Pause · ${shortcutText("video_toggle")}`)
                : (lang === "ko" ? `재생 · ${shortcutText("video_toggle")}` : `Play · ${shortcutText("video_toggle")}`)}
            </button>
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              data-testid="studio-video-restart"
              onClick={resetSongVideoToStart}
              disabled={!canControlEmbeddedVideo}
            >
              {lang === "ko" ? `처음으로 · ${shortcutText("video_restart")}` : `Restart · ${shortcutText("video_restart")}`}
            </button>
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              data-testid="studio-video-fullscreen"
              onClick={toggleSongVideoFullscreen}
              disabled={!canControlEmbeddedVideo}
            >
              {lang === "ko" ? `영상 전체화면 · ${shortcutText("video_fullscreen")}` : `Video Fullscreen · ${shortcutText("video_fullscreen")}`}
            </button>
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              data-testid="studio-video-pin-save"
              onClick={saveSongVideoPinAtCurrent}
              disabled={!canControlEmbeddedVideo}
            >
              {lang === "ko" ? `핀 저장 · ${shortcutText("video_pin_save")}` : `Pin · ${shortcutText("video_pin_save")}`}
            </button>
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              data-testid="studio-video-pin-jump"
              onClick={jumpSongVideoToPin}
              disabled={!canControlEmbeddedVideo}
            >
              {songVideoPinSec === null
                ? (lang === "ko" ? `처음으로 · ${shortcutText("video_pin_jump")}` : `Restart · ${shortcutText("video_pin_jump")}`)
                : (lang === "ko" ? `핀으로 · ${shortcutText("video_pin_jump")}` : `To Pin · ${shortcutText("video_pin_jump")}`)}
            </button>
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              data-testid="studio-video-pin-clear"
              onClick={clearSongVideoPin}
              disabled={songVideoPinSec === null}
            >
              {lang === "ko" ? `핀 해제 · ${shortcutText("video_pin_clear")}` : `Clear Pin · ${shortcutText("video_pin_clear")}`}
            </button>
          </div>
          {songVideoPinSec !== null ? (
            <small className="muted song-video-pin-status">
              {lang === "ko" ? `저장된 핀: ${formatVideoSecond(songVideoPinSec)}` : `Pinned at: ${formatVideoSecond(songVideoPinSec)}`}
            </small>
          ) : null}
          <label className="studio-source-select song-video-source-select">
            {lang === "ko" ? "영상 소스" : "Video Source"}
            <select value={selectedSongLink} onChange={(event) => handleSongVideoSourceChange(event.target.value)}>
              <option value="">{lang === "ko" ? "(영상 숨기기)" : "(Hide video)"}</option>
              {songLinkGroups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.items.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {!songVideoOptions.length ? (
            <small className="muted">{lang === "ko" ? "등록된 영상 링크가 없습니다." : "No video links found."}</small>
          ) : null}
        </div>
      </div>
    );
  };

  const renderSongScorePanel = () => {
    if (!hasSongScore) {
      return <small className="muted">{lang === "ko" ? "등록된 악보가 없습니다." : "No score uploaded."}</small>;
    }
    return (
      <div className="studio-score-panel" data-testid="studio-score-panel">
        <div className="studio-score-tab-row">
          {songScorePdf ? (
            <button
              type="button"
              className={`ghost-btn compact-add-btn ${scoreContentTab === "pdf" ? "active-mini" : ""}`}
              onClick={() => setScoreContentTab("pdf")}
            >
              PDF
            </button>
          ) : null}
          {songScoreImages.length ? (
            <button
              type="button"
              className={`ghost-btn compact-add-btn ${scoreContentTab === "images" ? "active-mini" : ""}`}
              onClick={() => setScoreContentTab("images")}
            >
              {lang === "ko" ? "이미지" : "Images"}
            </button>
          ) : null}
        </div>

        {scoreContentTab === "pdf" && songScorePdf ? (
          <div className="studio-score-pdf-wrap">
            <div className="row studio-score-head-row">
              <small className="muted">{fileNameFromPath(song?.score_pdf_path || "") || "score.pdf"}</small>
              <div className="row studio-score-actions">
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => shiftScorePdfPage(-1)}>
                  {lang === "ko" ? "이전 페이지" : "Prev Page"}
                </button>
                <span className="badge">p.{scorePdfPage}</span>
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => shiftScorePdfPage(1)}>
                  {lang === "ko" ? "다음 페이지" : "Next Page"}
                </button>
                <button
                  type="button"
                  className="ghost-btn compact-add-btn"
                  onClick={() => openZoomAsset("pdf", scorePdfSrc, song?.title || "score-pdf")}
                >
                  {lang === "ko" ? "확대" : "Zoom"}
                </button>
                <button type="button" className="ghost-btn compact-add-btn" onClick={openScoreZoom}>
                  {lang === "ko" ? "악보 확대 (G)" : "Score Zoom (G)"}
                </button>
              </div>
            </div>
            <iframe
              data-testid="studio-score-pdf-frame"
              className="studio-score-pdf-frame"
              src={scorePdfSrc}
              title={`${song?.title || "song"} score pdf`}
            />
          </div>
        ) : null}

        {scoreContentTab === "images" && songScoreImages.length ? (
          <div className="studio-score-images-wrap">
            <div className="row studio-score-head-row">
              <small className="muted">
                {lang === "ko" ? "방향키(←/→)로 이미지 전환" : "Use Left/Right arrows to switch images"}
              </small>
              <div className="row studio-score-actions">
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => shiftScoreImage(-1)}>
                  {lang === "ko" ? "이전 이미지" : "Prev Image"}
                </button>
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => shiftScoreImage(1)}>
                  {lang === "ko" ? "다음 이미지" : "Next Image"}
                </button>
                <button
                  type="button"
                  className="ghost-btn compact-add-btn"
                  disabled={!selectedScoreImage}
                  onClick={() => {
                    if (!selectedScoreImage) return;
                    openZoomAsset("image", selectedScoreImage, song?.title || "score-image");
                  }}
                >
                  {lang === "ko" ? "확대" : "Zoom"}
                </button>
                <button type="button" className="ghost-btn compact-add-btn" onClick={openScoreZoom}>
                  {lang === "ko" ? "악보 확대 (G)" : "Score Zoom (G)"}
                </button>
              </div>
            </div>
            <div className="studio-score-thumb-strip">
              {songScoreImages.map((imgSrc, index) => (
                <button
                  key={`score-thumb-${imgSrc}`}
                  type="button"
                  className={`studio-score-thumb ${selectedScoreImage === imgSrc ? "active" : ""}`}
                  onClick={() => setSelectedScoreImage(imgSrc)}
                  title={fileNameFromPath(songScoreImagePaths[index] || imgSrc)}
                >
                  <img src={imgSrc} alt={`score-thumb-${index + 1}`} />
                </button>
              ))}
            </div>
            <div className="studio-score-layout-row">
              <div className="switch-row">
                <button
                  type="button"
                  className={`ghost-btn compact-add-btn ${scoreImageLayout === "horizontal" ? "active-mini" : ""}`}
                  onClick={() => setScoreImageLayout("horizontal")}
                >
                  {lang === "ko" ? "가로" : "Horizontal"}
                </button>
                <button
                  type="button"
                  className={`ghost-btn compact-add-btn ${scoreImageLayout === "vertical" ? "active-mini" : ""}`}
                  onClick={() => setScoreImageLayout("vertical")}
                >
                  {lang === "ko" ? "세로" : "Vertical"}
                </button>
              </div>
              <label className="studio-score-count-select">
                {lang === "ko" ? "동시 표시" : "Visible"}
                <select value={scoreVisibleCount} onChange={(event) => setScoreVisibleCount(Number(event.target.value) || 1)}>
                  {[1, 2, 3, 4, 5, 6].map((count) => (
                    <option key={`score-visible-${count}`} value={count}>
                      {lang === "ko" ? `${count}장` : `${count} items`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className={`studio-score-multi-grid ${scoreImageLayout}`}
              style={{ ["--score-visible-count" as string]: String(Math.max(1, Math.min(6, scoreVisibleCount))) }}
            >
              {visibleScoreImageItems.map((item) => (
                <button
                  key={`score-multi-${item.src}`}
                  type="button"
                  className={`studio-score-multi-item ${selectedScoreImage === item.src ? "active" : ""}`}
                  onClick={() => {
                    if (selectedScoreImage === item.src) {
                      openZoomAsset("image", item.src, song?.title || "score-image");
                      return;
                    }
                    setSelectedScoreImage(item.src);
                  }}
                  title={fileNameFromPath(songScoreImagePaths[item.index] || item.src)}
                >
                  <img
                    data-testid={selectedScoreImage === item.src ? "studio-score-image-main" : undefined}
                    className="studio-score-main-image"
                    src={item.src}
                    alt={`${song?.title || "score-image"}-${item.index + 1}`}
                  />
                  <span className="studio-score-page-chip">{item.index + 1}</span>
                </button>
              ))}
            </div>
            {selectedScoreImage ? (
              <small className="muted">
                {lang === "ko"
                  ? `선택: ${Math.max(1, selectedScoreIndex + 1)} / ${songScoreImages.length}`
                  : `Selected: ${Math.max(1, selectedScoreIndex + 1)} / ${songScoreImages.length}`}
              </small>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const hasSelectedTarget = (practiceType === "song" && Boolean(songId)) || (practiceType === "drill" && Boolean(drillId));
  const hasActiveSession = Boolean(hud.active_session?.session_id);
  const hasSessionOrTarget = hasActiveSession || hasSelectedTarget;
  const toggleStartPanelFromSurface = (target: EventTarget | null) => {
    if (!hasSessionOrTarget) return;
    if (isPanelToggleBlockedTarget(target)) return;
    setShowStartPanel((prev) => !prev);
    setStartStep(2);
  };
  const activeSessionId = String(hud.active_session?.session_id || "");
  const activeSessionSongId = String(hud.active_session?.song_library_id || "");
  const activeSessionSong = useMemo(
    () => catalogs.song_library.find((item) => item.library_id === activeSessionSongId) ?? null,
    [catalogs.song_library, activeSessionSongId]
  );
  const activeSessionSongVideoSource = useMemo(() => {
    if (!activeSessionSongId) return "";
    if (songId === activeSessionSongId) return String(selectedSongLink || "").trim();
    const candidateLinks = [
      ...splitLinks(activeSessionSong?.original_url || ""),
      ...splitLinks(activeSessionSong?.sub_urls || ""),
      ...splitLinks(activeSessionSong?.best_take_url || ""),
    ];
    return candidateLinks[0] || "";
  }, [activeSessionSong?.best_take_url, activeSessionSong?.original_url, activeSessionSong?.sub_urls, activeSessionSongId, selectedSongLink, songId]);
  const activeSessionSongEmbed = useMemo(
    () => toYoutubeEmbed(activeSessionSongVideoSource),
    [activeSessionSongVideoSource]
  );
  const activeSessionSongDirectVideo = useMemo(
    () => (isPlayableVideoUrl(activeSessionSongVideoSource) ? activeSessionSongVideoSource : ""),
    [activeSessionSongVideoSource]
  );
  const targetLabel =
    practiceType === "song"
      ? song?.title || (lang === "ko" ? "선택 곡 없음" : "No song selected")
      : drill?.name || (lang === "ko" ? "선택 드릴 없음" : "No drill selected");
  const showMiniDock =
    !isActive &&
    Boolean(activeSessionId) &&
    Boolean(activeSessionSongId) &&
    Boolean(activeSessionSongVideoSource) &&
    tabSwitchPlayback !== "pause" &&
    pipMode === "mini";
  const renderSessionControls = () => (
    <div className="practice-session-controls">
      {hasActiveSession ? (
        <strong className="practice-session-elapsed-text" data-testid="studio-session-elapsed">
          {lang === "ko" ? "진행 시간" : "Elapsed"} {fmtSec(elapsedSec)}
        </strong>
      ) : (
        <span className="practice-session-elapsed-spacer" aria-hidden="true" />
      )}
      <div className="practice-session-btns">
        <button
          className="primary-btn"
          data-testid="practice-start-target"
          onClick={() => void startTargetSession()}
          disabled={hasActiveSession}
        >
          {lang === "ko" ? "세션 시작" : "Start Session"}
        </button>
        {hasActiveSession ? (
          <button className="danger-btn" data-testid="studio-stop-session" onClick={() => setShowStopModal(true)}>
            {lang === "ko" ? "세션 종료" : "Stop Session"}
          </button>
        ) : null}
      </div>
    </div>
  );
  const pageStyle: CSSProperties | undefined =
    practiceType === "song" && songCover
      ? ({ ["--practice-song-bg" as string]: `url("${songCover.replace(/"/g, "%22")}")` } as CSSProperties)
      : undefined;
  useEffect(() => {
    if (!onSessionPipVideoChange) return;
    if (!showMiniDock || !activeSessionId || !activeSessionSongId) {
      onSessionPipVideoChange(null);
      return;
    }
    onSessionPipVideoChange({
      sessionId: activeSessionId,
      targetKind: "song",
      targetId: activeSessionSongId,
      title: activeSessionSong?.title || (lang === "ko" ? "선택된 영상" : "Selected video"),
      subtitle: activeSessionSong?.artist || (lang === "ko" ? "연습 영상" : "Practice video"),
      sourceUrl: activeSessionSongVideoSource || undefined,
      embedUrl: activeSessionSongEmbed || undefined,
      videoUrl: activeSessionSongDirectVideo || undefined,
    });
    return () => onSessionPipVideoChange(null);
  }, [
    activeSessionId,
    activeSessionSong?.artist,
    activeSessionSong?.title,
    activeSessionSongDirectVideo,
    activeSessionSongEmbed,
    activeSessionSongId,
    lang,
    onSessionPipVideoChange,
    showMiniDock,
  ]);

  useEffect(() => {
    if (!onSessionPipVideoControlChange) return;
    const isActiveSessionSongReady =
      showMiniDock &&
      Boolean(activeSessionId) &&
      Boolean(activeSessionSongId) &&
      songId === activeSessionSongId &&
      Boolean(songDirectVideo || songEmbed);
    if (!isActiveSessionSongReady) {
      onSessionPipVideoControlChange(null);
      return;
    }
    onSessionPipVideoControlChange({
      sessionId: activeSessionId,
      targetKind: "song",
      targetId: activeSessionSongId,
      canControl: true,
      isPlaying: songVideoPlaying,
      hasPin: songVideoPinSec !== null,
      togglePlayback: toggleSongVideoPlayback,
      savePinAtCurrent: saveSongVideoPinAtCurrent,
      jumpToPin: jumpSongVideoToPin,
      clearPin: clearSongVideoPin,
      restart: resetSongVideoToStart,
    });
    return () => onSessionPipVideoControlChange(null);
  }, [
    activeSessionId,
    activeSessionSongId,
    songVideoPlaying,
    onSessionPipVideoControlChange,
    songVideoPinSec,
    showMiniDock,
    songDirectVideo,
    songEmbed,
    songId,
  ]);

  return (
    <div
      className={`page-grid songs-page-list practice-studio-page ${practiceType === "song" && songCover ? "with-song-background" : ""} ${isActive ? "active" : "inactive"}`}
      style={pageStyle}
    >
      <section className="card">
        <div className="row practice-start-header-row" onClick={(event) => toggleStartPanelFromSurface(event.target)}>
          <h2 className={hasSessionOrTarget ? "practice-start-title-clickable" : ""}>{lang === "ko" ? "연습 시작" : "Start Practice"}</h2>
          <div className="row">
            <button
              className={`song-round-btn ${showFilters ? "active-mini" : ""}`}
              onClick={() => setShowFilters((v) => !v)}
              title={lang === "ko" ? "필터" : "Filter"}
              aria-label={lang === "ko" ? "필터" : "Filter"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 5h18l-7 8v5l-4 1v-6L3 5Z" />
              </svg>
            </button>
            {hasSessionOrTarget ? (
              <button
                className="ghost-btn compact-add-btn"
                onClick={() => {
                  setShowStartPanel((prev) => !prev);
                  setStartStep(2);
                }}
              >
                {showStartPanel ? (lang === "ko" ? "접기" : "Collapse") : (lang === "ko" ? "열기" : "Expand")}
              </button>
            ) : null}
          </div>
        </div>

        {!showStartPanel && hasSessionOrTarget ? (
          <div className="practice-start-collapsed" data-testid="practice-start-collapsed" onClick={(event) => toggleStartPanelFromSurface(event.target)}>
            <strong>
              {practiceType === "song" ? (lang === "ko" ? "선택된 곡" : "Selected Song") : (lang === "ko" ? "선택된 드릴" : "Selected Drill")}
              {" · "}
              {targetLabel}
            </strong>
            {renderSessionControls()}
          </div>
        ) : (
          <>
        <div className="practice-start-stepper" data-testid="tutorial-practice-stepper">
          <div className="switch-row practice-mode-row">
            <button
              className={`ghost-btn ${practiceType === "song" ? "active-mini" : ""}`}
              onClick={() => {
                setPracticeType("song");
                setStartStep(2);
              }}
            >
              {lang === "ko" ? "곡 연습" : "Song Practice"}
            </button>
            <button
              className={`ghost-btn ${practiceType === "drill" ? "active-mini" : ""}`}
              onClick={() => {
                setPracticeType("drill");
                setStartStep(2);
              }}
            >
              {lang === "ko" ? "드릴 연습" : "Drill Practice"}
            </button>
          </div>
          <small className="muted">{lang === "ko" ? `Step ${startStep}/2` : `Step ${startStep}/2`}</small>
        </div>

        {startStep === 1 ? (
          <div className="practice-step-card">
            <strong>{lang === "ko" ? "1단계: 연습 모드 선택" : "Step 1: Choose mode"}</strong>
            <small className="muted">
              {lang === "ko"
                ? "곡 또는 드릴을 선택하면 바로 2단계(대상 선택)로 이동합니다."
                : "Select Song or Drill, then move to target selection."}
            </small>
            <button className="primary-btn" onClick={() => setStartStep(2)}>
              {lang === "ko" ? "다음 단계" : "Next"}
            </button>
          </div>
        ) : null}

        {startStep === 2 ? (
          <>

        {showFilters ? (
          <div className="practice-filter-panel">
            {practiceType === "song" ? (
              <div className="song-form-grid">
                <label>
                  {lang === "ko" ? "상태" : "Status"}
                  <select value={songStatusFilter} onChange={(event) => setSongStatusFilter(event.target.value)}>
                    {songStatusOptions.map((item) => (
                      <option key={item} value={item}>
                        {item === "all" ? (lang === "ko" ? "전체" : "All") : item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {lang === "ko" ? "장르" : "Genre"}
                  <select value={songGenreFilter} onChange={(event) => setSongGenreFilter(event.target.value)}>
                    {songGenreOptions.map((item) => (
                      <option key={item} value={item}>
                        {item === "all" ? (lang === "ko" ? "전체" : "All") : item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="song-form-grid">
                <label>
                  {lang === "ko" ? "영역" : "Area"}
                  <select value={drillAreaFilter} onChange={(event) => setDrillAreaFilter(event.target.value)}>
                    {drillAreaOptions.map((item) => (
                      <option key={item} value={item}>
                        {item === "all" ? (lang === "ko" ? "전체" : "All") : item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {lang === "ko" ? "태그" : "Tag"}
                  <select value={drillTagFilter} onChange={(event) => setDrillTagFilter(event.target.value)}>
                    {drillTagOptions.map((item) => (
                      <option key={item} value={item}>
                        {item === "all" ? (lang === "ko" ? "전체" : "All") : item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        ) : null}

            {practiceType === "song" ? (
          <>
          {quickSongPicks.length ? (
            <div className="quick-pick-grid song">
              {quickSongPicks.map((item) => {
                const cover = coverSource(item);
                const isActive = item.library_id === songId;
                return (
                  <button
                    key={`quick_song_${item.library_id}`}
                    className={`quick-pick-btn ${isActive ? "active" : ""}`}
                    onClick={() =>
                      void (async () => {
                        const nextId = item.library_id || "";
                        if (hud.active_session?.session_id) {
                          await requestTargetSwitch("song", nextId);
                          return;
                        }
                        setSongId(nextId);
                        setShowStartPanel(false);
                      })()
                    }
                    title={item.title || item.library_id}
                  >
                    {cover ? <img src={cover} alt={item.title || item.library_id} /> : <span className="quick-pick-fallback">♪</span>}
                    <small>{item.title || item.library_id}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="song-form-grid">
            <label>
              {lang === "ko" ? "곡 검색" : "Song Search"}
              <input
                value={songQuery}
                onChange={(event) => setSongQuery(event.target.value)}
                placeholder={lang === "ko" ? "제목/ID 검색" : "Search title / id"}
              />
              <select
                value={songId}
                onChange={(event) =>
                  void (async () => {
                    const nextId = event.target.value;
                    if (hud.active_session?.session_id) {
                      await requestTargetSwitch("song", nextId);
                      return;
                    }
                    setSongId(nextId);
                    if (nextId) setShowStartPanel(false);
                  })()
                }
              >
                <option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>
                {songOptionGroups.map((group) => (
                  <optgroup key={group.key} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.library_id} value={item.library_id}>
                        {(isFavorite(item.favorite || "") ? "★ " : "") + (item.title || item.library_id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          </>
        ) : (
          <div className="practice-drill-control">
            {quickDrillPicks.length ? (
              <div className="quick-pick-grid song">
                {quickDrillPicks.map((item) => {
                  const cover = drillImageSources(item)[0] || "";
                  const isActive = item.drill_id === drillId;
                  return (
                    <button
                      key={`quick_drill_${item.drill_id}`}
                      className={`quick-pick-btn ${isActive ? "active" : ""}`}
                      onClick={() =>
                        void (async () => {
                          const nextId = item.drill_id || "";
                          if (hud.active_session?.session_id) {
                            await requestTargetSwitch("drill", nextId);
                            return;
                          }
                          setDrillId(nextId);
                          setShowStartPanel(false);
                        })()
                      }
                      title={item.name || item.drill_id}
                    >
                      {cover ? <img src={cover} alt={item.name || item.drill_id} /> : <span className="quick-pick-fallback">D</span>}
                      <small>{(isFavorite(item.favorite || "") ? "★ " : "") + (item.name || item.drill_id)}</small>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "드릴 검색" : "Drill Search"}
                <input
                  value={drillQuery}
                  onChange={(event) => setDrillQuery(event.target.value)}
                  placeholder={lang === "ko" ? "이름/ID 검색" : "Search name / id"}
                />
                <select
                  value={drillId}
                  onChange={(event) =>
                    void (async () => {
                      const nextId = event.target.value;
                      if (hud.active_session?.session_id) {
                        await requestTargetSwitch("drill", nextId);
                        return;
                      }
                      setDrillId(nextId);
                      if (nextId) setShowStartPanel(false);
                    })()
                  }
                >
                  <option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>
                  {drillOptionGroups.map((group) => (
                    <optgroup key={group.key} label={group.label}>
                      {group.items.map((item) => (
                        <option key={item.drill_id} value={item.drill_id}>
                          {(isFavorite(item.favorite || "") ? "★ " : "") + (item.name || item.drill_id)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
            <small className="muted">
              {lang === "ko"
                ? "드릴을 먼저 고른 뒤, 오른쪽 참고 영역에서 배킹트랙 사용 여부와 트랙을 선택하세요."
                : "Choose a drill first, then select backing usage and track in the reference panel."}
            </small>
          </div>
        )}

        {renderSessionControls()}
          </>
        ) : null}
          </>
        )}
      </section>

      <section
        className={`card studio-control-surface studio-metronome-surface ${activePlaybackSurface === "metronome" ? "active" : ""}`}
        onMouseDownCapture={() => setActivePlaybackSurface("metronome")}
        onFocusCapture={() => setActivePlaybackSurface("metronome")}
      >
        <div className="row">
          <h2>{lang === "ko" ? "메트로놈" : "Metronome"}</h2>
          <small className="muted">{lang === "ko" ? "탭 이동 시 PiP로 유지됩니다." : "Stays active as PiP across tabs."}</small>
        </div>
        <GlobalMetronomeDock embedded />
      </section>

      <section className="card">
        <div className="row">
          <h2>{lang === "ko" ? "연습 참고" : "Practice Reference"}</h2>
          <button className="ghost-btn" onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? (lang === "ko" ? "연습 기록 닫기" : "Hide Logs") : (lang === "ko" ? "연습 기록 보기" : "Show Logs")}
          </button>
        </div>

        {practiceType === "song" ? (
          song ? (
            <div className="studio-reference-main song-reference-clean">
              <div className="song-reference-stack">
                <header className="song-reference-top">
                  <div className="song-reference-cover-wrap">
                    {songCover ? (
                      <img className="song-cover-panel clean" src={songCover} alt={song.title || song.library_id || "song-cover"} />
                    ) : (
                      <div className="song-cover-panel empty" />
                    )}
                  </div>
                  <div className="song-reference-meta">
                    <strong>{song.title || "-"}</strong>
                    <small className="muted">{song.artist || "-"} · {song.genre || "-"}</small>
                    {song.notes ? <small className="muted song-reference-notes">{song.notes}</small> : null}
                  </div>
                </header>

                <section className="song-reference-right">
                  {hasSongVideo && hasSongScore ? (
                    <>
                      <div className="song-reference-view-controls">
                        <small className="muted">{lang === "ko" ? "분할 보기" : "Split view"}</small>
                        <div className="switch-row">
                          <button
                            type="button"
                            className={`ghost-btn compact-add-btn ${songSplitDirection === "horizontal" ? "active-mini" : ""}`}
                            onClick={() => setSongSplitDirection("horizontal")}
                          >
                            {lang === "ko" ? "좌우" : "Left/Right"}
                          </button>
                          <button
                            type="button"
                            className={`ghost-btn compact-add-btn ${songSplitDirection === "vertical" ? "active-mini" : ""}`}
                            onClick={() => setSongSplitDirection("vertical")}
                          >
                            {lang === "ko" ? "상하" : "Top/Bottom"}
                          </button>
                        </div>
                      </div>
                      <div
                        ref={songSplitContainerRef}
                        className={`song-reference-dual ${songSplitDirection} ${isSongSplitResizing ? "resizing" : ""}`}
                        data-testid="studio-song-dual-pane"
                      >
                        <div
                          className="song-reference-pane"
                          style={{ flexBasis: `${Math.round(songSplitRatio * 1000) / 10}%` }}
                        >
                          {renderSongVideoPanel()}
                        </div>
                        <div
                          className={`song-reference-splitter ${songSplitDirection}`}
                          role="separator"
                          aria-label={lang === "ko" ? "분할 비율 조절" : "Adjust split ratio"}
                          onMouseDown={beginSongSplitResize}
                          onDoubleClick={() => setSongSplitRatio(0.56)}
                        >
                          <span className="song-reference-splitter-knob" />
                        </div>
                        <div
                          className="song-reference-pane"
                          style={{ flexBasis: `${Math.round((1 - songSplitRatio) * 1000) / 10}%` }}
                        >
                          {renderSongScorePanel()}
                        </div>
                      </div>
                    </>
                  ) : hasSongVideo ? (
                    renderSongVideoPanel()
                  ) : hasSongScore ? (
                    renderSongScorePanel()
                  ) : (
                    <small className="muted">{lang === "ko" ? "등록된 참고 자료가 없습니다." : "No references uploaded."}</small>
                  )}
                </section>
              </div>
            </div>
          ) : (
            <p className="muted">{lang === "ko" ? "연습할 곡을 선택해주세요." : "Select a song to practice."}</p>
          )
        ) : drill ? (
          <div className="studio-reference-main">
            <strong>{drill.name || "-"}</strong>
            <small className="muted">{drill.area || "-"} · {drill.description || ""}</small>
            <div className="drill-reference-split">
              <div className="drill-reference-image-wrap">
                {selectedDrillImage ? (
                  <>
                    <img
                      className="studio-drill-image-main interactive"
                      src={selectedDrillImage}
                      alt={drill.name || "drill"}
                      onClick={() => openZoomAsset("image", selectedDrillImage, drill.name || "drill-image")}
                      onDoubleClick={(event) =>
                        openImageFullscreen(event.currentTarget, () => openZoomAsset("image", selectedDrillImage, drill.name || "drill-image"))
                      }
                    />
                    {drillImages.length > 1 ? (
                      <div className="studio-drill-thumb-row">
                        {drillImages.map((src, index) => (
                          <button
                            key={`${src}_${index}`}
                            type="button"
                            className={`studio-drill-thumb-btn ${src === selectedDrillImage ? "active" : ""}`}
                            onClick={() => setSelectedDrillImage(src)}
                          >
                            <img src={src} alt={`${drill.name || "drill"}-${index + 1}`} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <small className="muted">{lang === "ko" ? "등록된 드릴 이미지가 없습니다." : "No image"}</small>
                )}
              </div>

              <div className="studio-backing-card">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={useBackingTrack}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setUseBackingTrack(next);
                      if (!next) return;
                      if (!backingId && backingCandidates[0]?.backing_id) {
                        setBackingId(backingCandidates[0].backing_id);
                      }
                    }}
                  />
                  <span>{lang === "ko" ? "배킹트랙 사용" : "Use backing track"}</span>
                </label>

                {useBackingTrack ? (
                  <>
                    <div className="row">
                      <label className="studio-source-select">
                        {lang === "ko" ? "배킹트랙 선택" : "Backing Track"}
                        <select value={backingId} onChange={(event) => setBackingId(event.target.value)}>
                          <option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>
                          {backingOptionGroups.map((group) => (
                            <optgroup key={group.key} label={group.label}>
                              {group.items.map((item) => (
                                <option key={item.backing_id} value={item.backing_id}>
                                  {item.title || item.backing_id}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <button
                        className={`song-round-btn ${showBackingFilters ? "active-mini" : ""}`}
                        onClick={() => setShowBackingFilters((v) => !v)}
                        title={lang === "ko" ? "필터" : "Filter"}
                        aria-label={lang === "ko" ? "필터" : "Filter"}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 5h18l-7 8v5l-4 1v-6L3 5Z" />
                        </svg>
                      </button>
                    </div>

                    {showBackingFilters ? (
                      <div className="song-form-grid">
                        <label>
                          {lang === "ko" ? "장르" : "Genre"}
                          <select value={backingGenreFilter} onChange={(event) => setBackingGenreFilter(event.target.value)}>
                            {backingGenreOptions.map((genre) => (
                              <option key={genre} value={genre}>
                                {genre === "all" ? (lang === "ko" ? "전체" : "All") : genre}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          BPM Min
                          <input value={backingBpmMin} onChange={(event) => setBackingBpmMin(event.target.value)} placeholder="e.g. 90" />
                        </label>
                        <label>
                          BPM Max
                          <input value={backingBpmMax} onChange={(event) => setBackingBpmMax(event.target.value)} placeholder="e.g. 130" />
                        </label>
                        <label>
                          {lang === "ko" ? "검색" : "Search"}
                          <input
                            value={backingQuery}
                            onChange={(event) => setBackingQuery(event.target.value)}
                            placeholder={lang === "ko" ? "제목/장르/코드/태그" : "title/genre/chords/tag"}
                          />
                        </label>
                      </div>
                    ) : null}

                    {selectedBacking ? (
                      <>
                        <small className="muted">{selectedBacking.genre || "-"} · {selectedBacking.chords || "-"} · {selectedBacking.bpm || "-"} bpm</small>
                        <div className="studio-backing-gallery">
                          {backingCandidates.slice(0, 12).map((item) => {
                            const thumb = toYoutubeThumb(item.youtube_url || "");
                            const active = item.backing_id === backingId;
                            return (
                              <button
                                key={`studio-backing-thumb-${item.backing_id}`}
                                type="button"
                                className={`studio-backing-thumb ${active ? "active" : ""}`}
                                onClick={() => setBackingId(item.backing_id || "")}
                                title={item.title || item.backing_id}
                              >
                                {thumb ? <img src={thumb} alt={item.title || item.backing_id || "backing"} /> : <span>YT</span>}
                                <small>{item.title || item.backing_id || "-"}</small>
                              </button>
                            );
                          })}
                        </div>
                        {backingEmbed ? (
                          <iframe
                            className="studio-backing-iframe"
                            src={backingEmbed}
                            title={selectedBacking.title || selectedBacking.backing_id || "backing-track"}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerPolicy="strict-origin-when-cross-origin"
                            allowFullScreen
                          />
                        ) : (
                          <button
                            className="ghost-btn"
                            onClick={() => {
                              if (!selectedBacking.youtube_url) return;
                              window.open(selectedBacking.youtube_url, "_blank", "noopener,noreferrer");
                            }}
                            disabled={!selectedBacking.youtube_url}
                          >
                            {lang === "ko" ? "배킹트랙 열기" : "Open Backing Track"}
                          </button>
                        )}
                      </>
                    ) : (
                      <small className="muted">{lang === "ko" ? "선택된 배킹트랙이 없습니다." : "No backing track selected."}</small>
                    )}
                  </>
                ) : (
                  <small className="muted">
                    {lang === "ko" ? "이미지 기준으로 먼저 연습한 뒤 필요하면 배킹트랙을 켜세요." : "Start with the image, then enable backing if needed."}
                  </small>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">{lang === "ko" ? "연습할 드릴을 선택해주세요." : "Select a drill to practice."}</p>
        )}

        {showLogs ? (
          <div className="studio-log-toggle">
            <div className="stat-grid">
              <div>
                <span>{lang === "ko" ? "연습 횟수" : "Sessions"}</span>
                <strong>{targetSummary.totalSessions}</strong>
              </div>
              <div>
                <span>{lang === "ko" ? "총 연습 시간(분)" : "Minutes"}</span>
                <strong>{targetSummary.totalMinutes}</strong>
              </div>
              <div>
                <span>XP</span>
                <strong>{formatDisplayXp(targetSummary.totalXp, xpDisplayScale)}</strong>
              </div>
              <div>
                <span>{lang === "ko" ? "시작" : "First"}</span>
                <strong>{targetSummary.firstAt ? targetSummary.firstAt.slice(0, 10) : "-"}</strong>
              </div>
              <div>
                <span>{lang === "ko" ? "최근" : "Latest"}</span>
                <strong>{targetSummary.lastAt ? targetSummary.lastAt.slice(0, 10) : "-"}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="session-table compact-notes-table">
                <thead>
                  <tr>
                    <th>{lang === "ko" ? "시작" : "Start"}</th>
                    <th>{lang === "ko" ? "세부" : "Sub"}</th>
                    <th>{lang === "ko" ? "시간/BPM" : "Time/BPM"}</th>
                    <th className="note-col">{lang === "ko" ? "노트" : "Notes"}</th>
                  </tr>
                </thead>
                <tbody>
                  {targetLogs.map((item) => {
                    const start = renderStartAt(item.start_at);
                    return (
                      <tr key={item.event_id}>
                        <td className="date-break">
                          {start.date}
                          <br />
                          {start.time}
                        </td>
                        <td>{item.sub_activity || "-"}</td>
                        <td>{shortPaceText(item)}</td>
                        <td className="note-cell">{item.notes || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {zoomAsset ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setZoomAsset(null);
          }}
        >
          <div
            className="modal image-zoom-modal"
            data-testid="studio-score-zoom-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="row">
              <h3>{zoomAsset.title || (zoomAsset.kind === "pdf" ? "Score PDF" : "Zoomed Image")}</h3>
              <div className="row">
                {zoomAsset.kind === "image" ? (
                  <>
                    <button className="ghost-btn" onClick={() => shiftScoreImage(-1)}>
                      {lang === "ko" ? "이전(←)" : "Prev (←)"}
                    </button>
                    <button className="ghost-btn" onClick={() => shiftScoreImage(1)}>
                      {lang === "ko" ? "다음(→)" : "Next (→)"}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="ghost-btn" onClick={() => shiftScorePdfPage(-1)}>
                      {lang === "ko" ? "이전 페이지(←)" : "Prev Page (←)"}
                    </button>
                    <button className="ghost-btn" onClick={() => shiftScorePdfPage(1)}>
                      {lang === "ko" ? "다음 페이지(→)" : "Next Page (→)"}
                    </button>
                  </>
                )}
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setZoomAsset(null);
                  }}
                >
                  {lang === "ko" ? "닫기" : "Close"}
                </button>
              </div>
            </div>
            <div className="zoom-modal-content">
              {zoomAsset.kind === "pdf" ? (
                <iframe className="zoomed-score-pdf" src={zoomAsset.url} title={zoomAsset.title || "score-pdf"} />
              ) : (
                <img src={zoomAsset.url} alt={zoomAsset.title || "zoomed-image"} className="zoomed-drill-image" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pendingSwitchPrompt && !showSwitchTimeEditor ? (
        <div className="modal-backdrop" onClick={closePendingSwitchPrompt}>
          <div className="modal session-switch-gate-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{lang === "ko" ? "세션 전환" : "Switch Session"}</h3>
            {pendingSwitchPrompt.underMin ? (
              <p>{lang === "ko" ? "10분 미만의 세션은 저장되지 않습니다. 종료하시겠습니까?" : "Sessions under 10 minutes are not saved. End this segment?"}</p>
            ) : (
              <p>
                {lang === "ko" ? "곡 바꾸시겠습니까? 세션이 재시작됩니다" : "Switch target? Session will restart."}
                <br />
                {lang === "ko" ? "이전 세션은 자동으로 저장됩니다" : "The previous segment is auto-saved."}
              </p>
            )}
            <div className="modal-actions">
              {pendingSwitchPrompt.underMin ? (
                <>
                  <button
                    type="button"
                    className="primary-btn"
                    data-testid="studio-switch-under10-discard"
                    onClick={() => void confirmPendingSwitch()}
                  >
                    {lang === "ko" ? "저장하지 않고 종료" : "End Without Save"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    data-testid="studio-switch-under10-time"
                    onClick={openSwitchTimeEditor}
                  >
                    {lang === "ko" ? "시간 지정" : "Set Time"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    data-testid="studio-switch-under10-close"
                    onClick={closePendingSwitchPrompt}
                  >
                    {lang === "ko" ? "닫기" : "Close"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="primary-btn" data-testid="studio-switch-confirm" onClick={() => void confirmPendingSwitch()}>
                    {lang === "ko" ? "전환" : "Switch"}
                  </button>
                  <button type="button" className="ghost-btn" data-testid="studio-switch-cancel" onClick={closePendingSwitchPrompt}>
                    {lang === "ko" ? "취소" : "Cancel"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showSwitchTimeEditor ? (
        <div className="modal-backdrop" onClick={() => (!switchTimeBusy ? closeSwitchTimeEditor() : undefined)}>
          <div className="modal session-switch-time-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{lang === "ko" ? "시간 지정 후 전환" : "Set Time Then Switch"}</h3>
            <small className="muted">
              {lang === "ko"
                ? "종료 시간을 10분 이상으로 설정하면 저장 후 다음 곡/드릴로 전환됩니다."
                : "Set 10+ minutes to save this segment before switching."}
            </small>
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "시작 시각" : "Start Time"}
                <input
                  type="datetime-local"
                  value={switchTimeStartAtInput}
                  onChange={(event) => {
                    setSwitchTimeStartAtInput(event.target.value);
                    setShowSwitchTimeUnderMinAlert(false);
                  }}
                  disabled={switchTimeBusy}
                />
              </label>
              <label>
                {lang === "ko" ? "종료 시각" : "End Time"}
                <input
                  type="datetime-local"
                  value={switchTimeEndAtInput}
                  onChange={(event) => {
                    setSwitchTimeEndAtInput(event.target.value);
                    setShowSwitchTimeUnderMinAlert(false);
                  }}
                  disabled={switchTimeBusy}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="primary-btn" data-testid="studio-switch-time-save" disabled={switchTimeBusy} onClick={() => void saveSwitchTimeAndSwitch()}>
                {lang === "ko" ? "저장 후 전환" : "Save & Switch"}
              </button>
              <button type="button" className="ghost-btn" data-testid="studio-switch-time-close" disabled={switchTimeBusy} onClick={closeSwitchTimeEditor}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSwitchTimeUnderMinAlert ? (
        <div className="modal-backdrop mini-alert-backdrop" onClick={() => setShowSwitchTimeUnderMinAlert(false)}>
          <div className="modal mini-alert-modal" onClick={(event) => event.stopPropagation()}>
            <p>{lang === "ko" ? "10분 미만의 세션은 저장되지 않습니다." : "Sessions under 10 minutes are not saved."}</p>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setShowSwitchTimeUnderMinAlert(false)}>
                {lang === "ko" ? "확인" : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SessionStopModal
        open={showStopModal}
        lang={lang}
        xpDisplayScale={xpDisplayScale}
        songs={catalogs.song_library}
        drills={drillPool}
        activeSession={hud.active_session}
        testIdPrefix="studio"
        notify={notify}
        onClose={() => setShowStopModal(false)}
        onSaved={async (result) => {
          onSessionCompleted?.(result);
          await onRefresh();
        }}
        onDiscarded={async () => {
          await onRefresh();
        }}
      />
    </div>
  );
}










