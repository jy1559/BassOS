import { Fragment, useEffect, useMemo, useState } from "react";
import {
  createBackingTrack,
  createDrill,
  deleteBackingTrack,
  deleteDrill,
  getSessions,
  updateBackingTrack,
  updateDrill,
  uploadAnyMediaFile,
} from "../api";
import type { Lang } from "../i18n";
import type { SessionItem } from "../types/models";

type Props = {
  lang: Lang;
  items: Array<Record<string, string>>;
  backingTracks: Array<Record<string, string>>;
  onRefresh: () => Promise<void>;
  setMessage: (message: string) => void;
};

const AREAS = ["기본기", "톤/그루브", "이론/리딩", "슬랩", "퍼포먼스", "기타"];

const BACKING_GENRES = ["K-POP", "Pop", "Ballad", "Rock", "Funk", "Jazz", "Fusion", "R&B", "Hip-hop", "Metal"];

const DRILL_TAG_GROUPS: Array<{ name: string; tags: string[] }> = [
  { name: "포커스", tags: ["박자", "포지션", "지구력", "스피드", "클린", "다이내믹", "리딩"] },
  { name: "주법", tags: ["핑거", "피크", "슬랩", "고스트", "레가토"] },
  { name: "음형", tags: ["크로매틱", "스케일", "코드톤", "인터벌", "진행"] },
  { name: "리듬", tags: ["8분음표", "16분음표", "트리플렛", "싱코페이션"] },
  { name: "라인 타입", tags: ["그루브", "워킹", "컴핑"] },
];

const DRILL_TAG_SET = new Set(DRILL_TAG_GROUPS.flatMap((group) => group.tags));

const DRILL_TAG_ALIASES: Array<[string, string]> = [
  ["기본기", "박자"],
  ["core", "박자"],
  ["metronome24", "박자"],
  ["메트로놈2&4", "박자"],
  ["메트로놈2and4", "박자"],
  ["한마디한클릭", "박자"],
  ["metroonebar", "박자"],
  ["클린뮤트", "클린"],
  ["cleanmute", "클린"],
  ["muting", "클린"],
  ["다이내믹", "다이내믹"],
  ["dynamics", "다이내믹"],
  ["포지션", "포지션"],
  ["fretboard", "포지션"],
  ["reading", "리딩"],
  ["리듬읽기", "리딩"],
  ["slap", "슬랩"],
  ["썸", "슬랩"],
  ["thumb", "슬랩"],
  ["팝", "슬랩"],
  ["pop", "슬랩"],
  ["ghost", "고스트"],
  ["고스트", "고스트"],
  ["legato", "레가토"],
  ["finger", "핑거"],
  ["pick", "피크"],
  ["크로매틱", "크로매틱"],
  ["chromatic", "크로매틱"],
  ["스케일", "스케일"],
  ["scale", "스케일"],
  ["코드톤", "코드톤"],
  ["chordtones", "코드톤"],
  ["도수", "인터벌"],
  ["인터벌", "인터벌"],
  ["ii-v", "진행"],
  ["iiv", "진행"],
  ["진행", "진행"],
  ["walking", "워킹"],
  ["워킹", "워킹"],
  ["comping", "컴핑"],
  ["컴핑", "컴핑"],
  ["groove", "그루브"],
  ["그루브", "그루브"],
  ["8th", "8분음표"],
  ["8분", "8분음표"],
  ["8분음표", "8분음표"],
  ["16th", "16분음표"],
  ["16비트", "16분음표"],
  ["16분음표", "16분음표"],
  ["triplet", "트리플렛"],
  ["트리플렛", "트리플렛"],
  ["syncopation", "싱코페이션"],
  ["싱코페이션", "싱코페이션"],
  ["warmup", "지구력"],
  ["지구력", "지구력"],
  ["speed", "스피드"],
  ["스피드", "스피드"],
];

function normalizeTagKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "")
    .replace(/&/g, "and");
}

const DRILL_TAG_ALIAS_MAP = new Map<string, string>(DRILL_TAG_ALIASES.map(([from, to]) => [normalizeTagKey(from), to]));

function normalizeDrillTag(raw: string): string {
  const token = String(raw || "").trim();
  if (!token) return "";
  if (DRILL_TAG_SET.has(token)) return token;
  const mapped = DRILL_TAG_ALIAS_MAP.get(normalizeTagKey(token));
  if (mapped && DRILL_TAG_SET.has(mapped)) return mapped;
  return "";
}

const emptyDrill = {
  name: "",
  description: "",
  area: AREAS[0],
  favorite: "false",
  bpm_min: "",
  bpm_max: "",
  bpm_step: "5",
  default_backing_id: "",
  resource: "",
  tags: "",
  notes: "",
  image_url: "",
  image_path: "",
  image_paths: "",
};

const emptyBacking = {
  title: "",
  description: "",
  genre: BACKING_GENRES[0],
  favorite: "false",
  chords: "",
  bpm: "",
  youtube_url: "",
  drill_id: "",
  tags: "",
  notes: "",
};

const splitTags = (raw: string) =>
  Array.from(new Set((raw || "").split(/[;,|]/g).map((v) => normalizeDrillTag(v)).filter(Boolean)));

const splitPathList = (raw: string) =>
  String(raw || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

const joinPathList = (values: string[]) => Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean))).join(";");

const mediaPathSrc = (path: string) => {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) return raw;
  return `/media/${raw}`;
};

const toYoutubeThumb = (url: string) => {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    let id = "";
    if (parsed.hostname.includes("youtu.be")) {
      id = parsed.pathname.replace("/", "").trim();
    } else if (parsed.hostname.includes("youtube.com")) {
      id = parsed.searchParams.get("v") || "";
      if (!id && parsed.pathname.startsWith("/embed/")) id = parsed.pathname.replace("/embed/", "").trim();
      if (!id && parsed.pathname.startsWith("/shorts/")) id = parsed.pathname.replace("/shorts/", "").trim();
    }
    if (!id) return "";
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } catch {
    return "";
  }
};

const drillImageSources = (row: Record<string, string>) => {
  const out: string[] = [];
  const push = (value: string, asMedia = false) => {
    const token = String(value || "").trim();
    if (!token) return;
    const src = asMedia ? mediaPathSrc(token) : token;
    if (!out.includes(src)) out.push(src);
  };
  splitPathList(row.image_paths || "").forEach((path) => push(path, true));
  push(row.image_path || "", true);
  if (row.image_url) push(row.image_url, false);
  return out;
};
const toggleTagCsv = (raw: string, tag: string) => {
  const next = new Set(splitTags(raw));
  const normalized = normalizeDrillTag(tag);
  if (!normalized) return Array.from(next).join(";");
  if (next.has(normalized)) next.delete(normalized);
  else next.add(normalized);
  return Array.from(next).join(";");
};
const fmt = (v: string) => (v || "").replace("T", " ").slice(0, 16) || "-";
const n = (v: string) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
};

const isFavorite = (value: string) => {
  const raw = String(value || "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
};

function renderTag(tag: string): string {
  return normalizeDrillTag(tag);
}

async function readClipboardImage(): Promise<File | null> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return new File([blob], `clipboard_${Date.now()}.png`, { type: imageType });
    }
  } catch {
    return null;
  }
  return null;
}

export function DrillLibraryPage({ lang, items, backingTracks, onRefresh, setMessage }: Props) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  const [showDrillList, setShowDrillList] = useState(true);
  const [showDrillCreate, setShowDrillCreate] = useState(false);
  const [showDrillFilters, setShowDrillFilters] = useState(false);
  const [showDrillGroup, setShowDrillGroup] = useState(false);
  const [drillViewMode, setDrillViewMode] = useState<"list" | "gallery">("list");

  const [showBackingLib, setShowBackingLib] = useState(false);
  const [showBackingCreate, setShowBackingCreate] = useState(false);
  const [showBackingFilters, setShowBackingFilters] = useState(false);
  const [showBackingGroup, setShowBackingGroup] = useState(false);
  const [backingViewMode, setBackingViewMode] = useState<"list" | "gallery">("list");

  const [drillQ, setDrillQ] = useState("");
  const [drillArea, setDrillArea] = useState("all");
  const [drillTag, setDrillTag] = useState("all");
  const [drillFavoritesOnly, setDrillFavoritesOnly] = useState(false);
  const [drillGroupBy, setDrillGroupBy] = useState<"none" | "area" | "tag">("area");

  const [backQ, setBackQ] = useState("");
  const [backGenre, setBackGenre] = useState("all");
  const [backTag, setBackTag] = useState("all");
  const [backMin, setBackMin] = useState("");
  const [backMax, setBackMax] = useState("");
  const [backFavoritesOnly, setBackFavoritesOnly] = useState(false);
  const [backGroupBy, setBackGroupBy] = useState<"none" | "genre" | "tag">("tag");

  const [drillForm, setDrillForm] = useState<Record<string, string>>(emptyDrill);
  const [backForm, setBackForm] = useState<Record<string, string>>(emptyBacking);

  const [expanded, setExpanded] = useState("");

  const [editDrillId, setEditDrillId] = useState("");
  const [editDrill, setEditDrill] = useState<Record<string, string>>(emptyDrill);

  const [editBackId, setEditBackId] = useState("");
  const [editBack, setEditBack] = useState<Record<string, string>>(emptyBacking);

  useEffect(() => {
    void getSessions(1200).then(setSessions).catch(() => undefined);
  }, [items, backingTracks]);

  const drillFormTags = useMemo(() => splitTags(drillForm.tags || ""), [drillForm.tags]);
  const editDrillTags = useMemo(() => splitTags(editDrill.tags || ""), [editDrill.tags]);

  const drills = useMemo(
    () =>
      [...items].sort((a, b) => {
        const favDiff = Number(isFavorite(b.favorite || "")) - Number(isFavorite(a.favorite || ""));
        if (favDiff !== 0) return favDiff;
        return (a.name || "").localeCompare(b.name || "");
      }),
    [items]
  );
  const areaOptions = useMemo(() => ["all", ...Array.from(new Set(drills.map((r) => r.area || "").filter(Boolean))).sort()], [drills]);
  const drillTagOptions = useMemo(() => {
    const fixed = DRILL_TAG_GROUPS.flatMap((group) => group.tags);
    const values = Array.from(new Set([...fixed, ...drills.flatMap((r) => splitTags(r.tags || ""))]));
    values.sort((a, b) => {
      const ai = fixed.indexOf(a);
      const bi = fixed.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return ["all", ...values];
  }, [drills]);
  const backGenres = useMemo(() => {
    const fromData = backingTracks.map((r) => String(r.genre || "").trim()).filter(Boolean);
    const values = Array.from(new Set([...BACKING_GENRES, ...fromData]));
    values.sort((a, b) => {
      const ai = BACKING_GENRES.indexOf(a);
      const bi = BACKING_GENRES.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return ["all", ...values];
  }, [backingTracks]);
  const backTags = useMemo(() => ["all", ...Array.from(new Set(backingTracks.flatMap((r) => splitTags(r.tags || "")))).sort()], [backingTracks]);

  const drillStats = useMemo(() => {
    const m = new Map<string, { c: number; min: number; xp: number; first: string; last: string; logs: SessionItem[] }>();
    for (const s of sessions) {
      if (!s.drill_id) continue;
      const t = m.get(s.drill_id) || { c: 0, min: 0, xp: 0, first: "", last: "", logs: [] };
      t.c += 1;
      t.min += s.duration_min || 0;
      t.xp += s.xp || 0;
      if (!t.first || s.start_at < t.first) t.first = s.start_at;
      if (!t.last || s.start_at > t.last) t.last = s.start_at;
      t.logs.push(s);
      m.set(s.drill_id, t);
    }
    for (const [, t] of m) t.logs = t.logs.sort((a, b) => (b.start_at || "").localeCompare(a.start_at || "")).slice(0, 10);
    return m;
  }, [sessions]);

  const filteredDrills = useMemo(() => {
    const q = drillQ.trim().toLowerCase();
    return drills.filter((r) => {
      if (drillArea !== "all" && (r.area || "") !== drillArea) return false;
      if (drillTag !== "all" && !splitTags(r.tags || "").includes(drillTag)) return false;
      if (drillFavoritesOnly && !isFavorite(r.favorite || "")) return false;
      if (!q) return true;
      return `${r.drill_id || ""} ${r.name || ""} ${r.description || ""} ${r.tags || ""}`.toLowerCase().includes(q);
    });
  }, [drills, drillQ, drillArea, drillTag, drillFavoritesOnly]);

  const groupedDrills = useMemo(() => {
    if (drillGroupBy === "none") return [{ key: "all", title: "", rows: filteredDrills }];
    const map = new Map<string, Array<Record<string, string>>>();
    const push = (key: string, row: Record<string, string>) => {
      const safe = key || (lang === "ko" ? "(미분류)" : "(Uncategorized)");
      if (!map.has(safe)) map.set(safe, []);
      map.get(safe)!.push(row);
    };
    filteredDrills.forEach((row) => {
      if (drillGroupBy === "area") {
        push(row.area || "", row);
      } else {
        const tags = splitTags(row.tags || "");
        (tags.length ? tags : [""]).forEach((tag) => push(renderTag(tag), row));
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => ({ key, title: key, rows }));
  }, [filteredDrills, drillGroupBy, lang]);

  const filteredBack = useMemo(() => {
    const q = backQ.trim().toLowerCase();
    const min = n(backMin);
    const max = n(backMax);
    return [...backingTracks]
      .filter((r) => {
        if (backGenre !== "all" && (r.genre || "") !== backGenre) return false;
        if (backTag !== "all" && !splitTags(r.tags || "").includes(backTag)) return false;
        if (backFavoritesOnly && !isFavorite(r.favorite || "")) return false;
        const bpm = n(r.bpm || "");
        if (min !== null && bpm !== null && bpm < min) return false;
        if (max !== null && bpm !== null && bpm > max) return false;
        if (!q) return true;
        return `${r.backing_id || ""} ${r.title || ""} ${r.genre || ""} ${r.chords || ""} ${r.tags || ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const favDiff = Number(isFavorite(b.favorite || "")) - Number(isFavorite(a.favorite || ""));
        if (favDiff !== 0) return favDiff;
        return (a.title || a.backing_id || "").localeCompare(b.title || b.backing_id || "");
      });
  }, [backingTracks, backQ, backGenre, backTag, backMin, backMax, backFavoritesOnly]);

  const groupedBack = useMemo(() => {
    if (backGroupBy === "none") return [{ key: "all", title: "", rows: filteredBack }];
    const map = new Map<string, Array<Record<string, string>>>();
    const push = (key: string, row: Record<string, string>) => {
      const safe = key || (lang === "ko" ? "(미분류)" : "(Uncategorized)");
      if (!map.has(safe)) map.set(safe, []);
      map.get(safe)!.push(row);
    };
    filteredBack.forEach((row) => {
      if (backGroupBy === "genre") {
        push(row.genre || "", row);
      } else {
        const tags = splitTags(row.tags || "");
        (tags.length ? tags : [""]).forEach((tag) => push(renderTag(tag), row));
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => ({ key, title: key, rows }));
  }, [filteredBack, backGroupBy, lang]);

  const createDrillImages = useMemo(() => splitPathList(drillForm.image_paths || ""), [drillForm.image_paths]);
  const editDrillImages = useMemo(() => splitPathList(editDrill.image_paths || ""), [editDrill.image_paths]);

  const appendDrillImages = async (files: FileList | File[] | null, target: "create" | "edit") => {
    if (!files || files.length === 0) return;
    const uploadedPaths: string[] = [];
    for (const file of Array.from(files)) {
      if (!String(file.type || "").toLowerCase().startsWith("image/")) continue;
      const uploaded = await uploadAnyMediaFile(file, "image");
      uploadedPaths.push(uploaded.path);
    }
    if (!uploadedPaths.length) return;
    if (target === "create") {
      setDrillForm((prev) => {
        const merged = joinPathList([...splitPathList(prev.image_paths || ""), ...uploadedPaths]);
        const first = splitPathList(merged)[0] || prev.image_path || "";
        return { ...prev, image_paths: merged, image_path: first, image_url: "" };
      });
    } else {
      setEditDrill((prev) => {
        const merged = joinPathList([...splitPathList(prev.image_paths || ""), ...uploadedPaths]);
        const first = splitPathList(merged)[0] || prev.image_path || "";
        return { ...prev, image_paths: merged, image_path: first, image_url: "" };
      });
    }
  };

  const removeDrillImage = (target: "create" | "edit", path: string) => {
    if (target === "create") {
      setDrillForm((prev) => {
        const nextList = splitPathList(prev.image_paths || "").filter((item) => item !== path);
        const joined = joinPathList(nextList);
        const first = nextList[0] || "";
        return { ...prev, image_paths: joined, image_path: first };
      });
      return;
    }
    setEditDrill((prev) => {
      const nextList = splitPathList(prev.image_paths || "").filter((item) => item !== path);
      const joined = joinPathList(nextList);
      const first = nextList[0] || "";
      return { ...prev, image_paths: joined, image_path: first };
    });
  };

  const pasteCreateDrillImage = async () => {
    const clipped = await readClipboardImage();
    if (!clipped) {
      setMessage(lang === "ko" ? "클립보드 이미지가 없습니다." : "No image found in clipboard.");
      return;
    }
    await appendDrillImages([clipped], "create");
    setMessage(lang === "ko" ? "클립보드 이미지를 드릴에 붙였습니다." : "Pasted image to drill form.");
  };

  const pasteEditDrillImage = async () => {
    const clipped = await readClipboardImage();
    if (!clipped) {
      setMessage(lang === "ko" ? "클립보드 이미지가 없습니다." : "No image found in clipboard.");
      return;
    }
    await appendDrillImages([clipped], "edit");
    setMessage(lang === "ko" ? "클립보드 이미지를 드릴 수정폼에 붙였습니다." : "Pasted image to edit form.");
  };

  const toggleDrillFavorite = async (row: Record<string, string>) => {
    await updateDrill(row.drill_id || "", { favorite: isFavorite(row.favorite || "") ? "false" : "true" });
    await onRefresh();
  };

  const toggleBackingFavorite = async (row: Record<string, string>) => {
    await updateBackingTrack(row.backing_id || "", { favorite: isFavorite(row.favorite || "") ? "false" : "true" });
    await onRefresh();
  };

  return (
    <div className="page-grid songs-page-list">
      <section className="card" data-testid="tutorial-drills-main">
        <div className="row compact-toolbar">
          <h2>{lang === "ko" ? "드릴 리스트" : "Drill List"}</h2>
          <div className="compact-toolbar-actions">
            <div className="song-round-controls">
              <button
                className={`song-round-btn ${showDrillFilters ? "active-mini" : ""}`}
                title={lang === "ko" ? "필터" : "Filter"}
                aria-label={lang === "ko" ? "필터" : "Filter"}
                onClick={() => setShowDrillFilters((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h18l-7 8v5l-4 1v-6L3 5Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${showDrillGroup ? "active-mini" : ""}`}
                title={lang === "ko" ? "그룹" : "Group"}
                aria-label={lang === "ko" ? "그룹" : "Group"}
                onClick={() => setShowDrillGroup((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${drillViewMode === "list" ? "active-mini" : ""}`}
                title={lang === "ko" ? "리스트" : "List"}
                aria-label={lang === "ko" ? "리스트" : "List"}
                onClick={() => setDrillViewMode("list")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${drillViewMode === "gallery" ? "active-mini" : ""}`}
                title={lang === "ko" ? "갤러리" : "Gallery"}
                aria-label={lang === "ko" ? "갤러리" : "Gallery"}
                onClick={() => setDrillViewMode("gallery")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 4h8v7H3V4Zm10 0h8v7h-8V4ZM3 13h8v7H3v-7Zm10 0h8v7h-8v-7Z" />
                </svg>
              </button>
            </div>
            <button className="ghost-btn compact-add-btn" onClick={() => setShowDrillCreate((v) => !v)}>
              {showDrillCreate ? (lang === "ko" ? "닫기" : "Close") : (lang === "ko" ? "드릴 추가" : "Add Drill")}
            </button>
            <button className="ghost-btn compact-add-btn" onClick={() => setShowDrillList((v) => !v)}>
              {showDrillList ? (lang === "ko" ? "접기" : "Collapse") : (lang === "ko" ? "열기" : "Expand")}
            </button>
          </div>
        </div>

        {showDrillList ? (
          <>
            <div className="row compact-toolbar-search">
              <input value={drillQ} onChange={(e) => setDrillQ(e.target.value)} placeholder={lang === "ko" ? "드릴 검색" : "Search drills"} />
              <small className="muted">{filteredDrills.length}</small>
            </div>

            {showDrillFilters ? (
              <div className="filter-panel-inline">
                <label>
                  {lang === "ko" ? "영역" : "Area"}
                  <select value={drillArea} onChange={(e) => setDrillArea(e.target.value)}>
                    {areaOptions.map((o) => (
                      <option key={o} value={o}>{o === "all" ? (lang === "ko" ? "전체" : "All") : o}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {lang === "ko" ? "태그" : "Tag"}
                  <select value={drillTag} onChange={(e) => setDrillTag(e.target.value)}>
                    {drillTagOptions.map((o) => (
                      <option key={o} value={o}>{o === "all" ? (lang === "ko" ? "전체" : "All") : renderTag(o)}</option>
                    ))}
                  </select>
                </label>
                <label className="inline">
                  <input type="checkbox" checked={drillFavoritesOnly} onChange={(e) => setDrillFavoritesOnly(e.target.checked)} />
                  <span>{lang === "ko" ? "즐겨찾기만" : "Favorites only"}</span>
                </label>
              </div>
            ) : null}

            {showDrillGroup ? (
              <div className="filter-panel-inline">
                <label>
                  {lang === "ko" ? "그룹 보기" : "Group By"}
                  <select value={drillGroupBy} onChange={(e) => setDrillGroupBy(e.target.value as "none" | "area" | "tag")}>
                    <option value="none">{lang === "ko" ? "사용 안함" : "None"}</option>
                    <option value="area">{lang === "ko" ? "영역" : "Area"}</option>
                    <option value="tag">{lang === "ko" ? "태그" : "Tag"}</option>
                  </select>
                </label>
              </div>
            ) : null}

            {showDrillCreate ? (
              <div className="compact-create-panel">
                <div className="song-form-grid">
                  <label>{lang === "ko" ? "이름" : "Name"}<input value={drillForm.name} onChange={(e) => setDrillForm((p) => ({ ...p, name: e.target.value }))} /></label>
                  <label>{lang === "ko" ? "영역" : "Area"}<select value={drillForm.area} onChange={(e) => setDrillForm((p) => ({ ...p, area: e.target.value }))}>{AREAS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
                  <label>BPM Min<input value={drillForm.bpm_min} onChange={(e) => setDrillForm((p) => ({ ...p, bpm_min: e.target.value }))} /></label>
                  <label>BPM Max<input value={drillForm.bpm_max} onChange={(e) => setDrillForm((p) => ({ ...p, bpm_max: e.target.value }))} /></label>
                  <label>{lang === "ko" ? "기본 배킹" : "Default Backing"}<select value={drillForm.default_backing_id} onChange={(e) => setDrillForm((p) => ({ ...p, default_backing_id: e.target.value }))}><option value="">{lang === "ko" ? "(없음)" : "(None)"}</option>{backingTracks.map((b) => <option key={b.backing_id} value={b.backing_id}>{b.title || b.backing_id}</option>)}</select></label>
                  <label>Resource URL<input value={drillForm.resource} onChange={(e) => setDrillForm((p) => ({ ...p, resource: e.target.value }))} /></label>
                  <label>Image URL<input value={drillForm.image_url} onChange={(e) => setDrillForm((p) => ({ ...p, image_url: e.target.value }))} /></label>
                  <label>{lang === "ko" ? "이미지 파일(다중)" : "Image Files (multi)"}<input type="file" accept="image/*" multiple onChange={(e) => void appendDrillImages(e.target.files, "create")} /></label>
                </div>
                <div className="row">
                  <button className="ghost-btn compact-add-btn" onClick={() => void pasteCreateDrillImage()}>
                    {lang === "ko" ? "클립보드 이미지 붙여넣기" : "Paste Image"}
                  </button>
                </div>
                {createDrillImages.length ? (
                  <div className="song-score-image-list">
                    {createDrillImages.map((path) => (
                      <div key={`create-drill-image-${path}`} className="song-score-thumb-item">
                        <img src={mediaPathSrc(path)} alt={path} />
                        <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={() => removeDrillImage("create", path)}>
                          {lang === "ko" ? "삭제" : "Remove"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="quest-catalog-panel">
                  <strong>{lang === "ko" ? "드릴 태그" : "Drill Tags"}</strong>
                  <div className="drill-tag-group-stack">
                    {DRILL_TAG_GROUPS.map((group) => (
                      <section key={`create-tag-group-${group.name}`} className="drill-tag-group">
                        <h5>{group.name}</h5>
                        <div className="chip-toggle-grid">
                          {group.tags.map((tag) => (
                            <button
                              key={`create-tag-${tag}`}
                              type="button"
                              className={`chip-toggle ${drillFormTags.includes(tag) ? "selected" : ""}`}
                              onClick={() => setDrillForm((prev) => ({ ...prev, tags: toggleTagCsv(prev.tags || "", tag) }))}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                  <small className="muted">
                    {lang === "ko" ? "선택됨" : "Selected"}: {drillFormTags.length ? drillFormTags.join(", ") : "—"}
                  </small>
                </div>
                <label className="inline"><input type="checkbox" checked={isFavorite(drillForm.favorite || "")} onChange={(e) => setDrillForm((p) => ({ ...p, favorite: e.target.checked ? "true" : "false" }))} /><span>{lang === "ko" ? "즐겨찾기" : "Favorite"}</span></label>
                <label>{lang === "ko" ? "설명" : "Description"}<textarea value={drillForm.description} onChange={(e) => setDrillForm((p) => ({ ...p, description: e.target.value }))} /></label>
                <label>Notes<input value={drillForm.notes} onChange={(e) => setDrillForm((p) => ({ ...p, notes: e.target.value }))} /></label>
                <div className="row"><button className="primary-btn compact-add-btn" onClick={async () => {
                  if (!drillForm.name.trim()) { setMessage(lang === "ko" ? "드릴 이름을 입력해주세요." : "Drill name is required."); return; }
                  const imagePaths = splitPathList(drillForm.image_paths || "");
                  const imagePath = imagePaths[0] || drillForm.image_path || "";
                  await createDrill({
                    ...drillForm,
                    tags: splitTags(drillForm.tags || "").join(";"),
                    image_path: imagePath,
                    image_paths: joinPathList(imagePaths),
                  });
                  setDrillForm(emptyDrill);
                  await onRefresh();
                }}>{lang === "ko" ? "저장" : "Save"}</button></div>
              </div>
            ) : null}

            {drillViewMode === "list" ? (
              <div className="table-wrap">
                <table className="session-table drill-backing-table">
                  <colgroup>
                    <col style={{ width: "34%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "15%" }} />
                    <col style={{ width: "14%" }} />
                  </colgroup>
                  <thead><tr><th>{lang === "ko" ? "드릴" : "Drill"}</th><th>{lang === "ko" ? "영역" : "Area"}</th><th>BPM</th><th>{lang === "ko" ? "기본 배킹" : "Default"}</th><th>{lang === "ko" ? "태그" : "Tags"}</th><th>{lang === "ko" ? "관리" : "Actions"}</th></tr></thead>
                  <tbody>
                    {groupedDrills.map((group) => (
                      <Fragment key={`group_${group.key}`}>
                        {drillGroupBy !== "none" ? (
                          <tr className="group-row"><td colSpan={6}><strong>{group.title}</strong></td></tr>
                        ) : null}
                        {group.rows.map((r) => {
                          const st = drillStats.get(r.drill_id || "");
                          const open = expanded === r.drill_id;
                          return (
                            <Fragment key={r.drill_id}>
                              <tr>
                                <td>
                                  <div className="entity-main-cell">
                                    <div className="entity-main-left">
                                      <button className={`favorite-star inline-star ${isFavorite(r.favorite || "") ? "on" : ""}`} onClick={() => void toggleDrillFavorite(r)}>{isFavorite(r.favorite || "") ? "★" : "☆"}</button>
                                      <strong>{r.name || r.drill_id}</strong>
                                    </div>
                                    <small className="muted entity-main-desc">{r.description || "-"}</small>
                                  </div>
                                </td>
                                <td>{r.area || "-"}</td>
                                <td>{`${r.bpm_min || "-"} ~ ${r.bpm_max || "-"}`}</td>
                                <td>{backingTracks.find((b) => b.backing_id === (r.default_backing_id || ""))?.title || r.default_backing_id || "-"}</td>
                                <td><div className="song-genre-chips">{splitTags(r.tags || "").slice(0, 3).map((tag) => <span key={`${r.drill_id}-${tag}`} className="achievement-chip">{renderTag(tag)}</span>)}</div></td>
                                <td><div className="row"><button className="ghost-btn" onClick={() => setExpanded((v) => (v === r.drill_id ? "" : r.drill_id || ""))}>{open ? (lang === "ko" ? "닫기" : "Hide") : (lang === "ko" ? "상세" : "Details")}</button><button className="ghost-btn" onClick={() => { const next = { ...emptyDrill, ...r }; if (!next.image_paths && next.image_path) next.image_paths = next.image_path; setEditDrillId(r.drill_id || ""); setEditDrill(next); }}>{lang === "ko" ? "수정" : "Edit"}</button><button className="ghost-btn danger-border" onClick={async () => { if (!window.confirm(lang === "ko" ? "삭제할까요?" : "Delete?")) return; await deleteDrill(r.drill_id || ""); await onRefresh(); }}>{lang === "ko" ? "삭제" : "Delete"}</button></div></td>
                              </tr>
                              {open ? <tr><td colSpan={6}><div className="library-detail-panel"><div className="stat-grid"><div><span>{lang === "ko" ? "횟수" : "Sessions"}</span><strong>{st?.c || 0}</strong></div><div><span>{lang === "ko" ? "시간(분)" : "Minutes"}</span><strong>{st?.min || 0}</strong></div><div><span>XP</span><strong>{st?.xp || 0}</strong></div><div><span>{lang === "ko" ? "처음" : "First"}</span><strong>{st?.first ? fmt(st.first) : "-"}</strong></div><div><span>{lang === "ko" ? "최근" : "Latest"}</span><strong>{st?.last ? fmt(st.last) : "-"}</strong></div></div></div></td></tr> : null}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="drill-gallery-grid">
                {groupedDrills.map((group) => (
                  <section key={`drill-gallery-${group.key}`} className="drill-gallery-group">
                    {drillGroupBy !== "none" ? <h4>{group.title}</h4> : null}
                    <div className="drill-gallery-cards">
                      {group.rows.map((r) => {
                        const st = drillStats.get(r.drill_id || "");
                        const imageSrc = drillImageSources(r)[0] || "";
                        return (
                          <article key={`drill-card-${r.drill_id}`} className="drill-gallery-card">
                            <div className="drill-gallery-media">
                              {imageSrc ? <img src={imageSrc} alt={r.name || r.drill_id} /> : <span>DRILL</span>}
                            </div>
                            <div className="drill-gallery-body">
                              <div className="entity-main-left">
                                <button className={`favorite-star inline-star ${isFavorite(r.favorite || "") ? "on" : ""}`} onClick={() => void toggleDrillFavorite(r)}>{isFavorite(r.favorite || "") ? "★" : "☆"}</button>
                                <strong>{r.name || r.drill_id}</strong>
                              </div>
                              <small className="muted">{`${r.area || "-"} · ${r.bpm_min || "-"}~${r.bpm_max || "-"} bpm`}</small>
                              <div className="song-genre-chips">{splitTags(r.tags || "").slice(0, 4).map((tag) => <span key={`${r.drill_id}-g-${tag}`} className="achievement-chip">{renderTag(tag)}</span>)}</div>
                              <small className="muted entity-main-desc">{r.description || "-"}</small>
                              <small className="muted">{`S ${st?.c || 0} · M ${st?.min || 0} · XP ${st?.xp || 0}`}</small>
                              <div className="row">
                                <button className="ghost-btn compact-add-btn" onClick={() => { const next = { ...emptyDrill, ...r }; if (!next.image_paths && next.image_path) next.image_paths = next.image_path; setEditDrillId(r.drill_id || ""); setEditDrill(next); }}>{lang === "ko" ? "수정" : "Edit"}</button>
                                <button className="ghost-btn compact-add-btn danger-border" onClick={async () => { if (!window.confirm(lang === "ko" ? "삭제할까요?" : "Delete?")) return; await deleteDrill(r.drill_id || ""); await onRefresh(); }}>{lang === "ko" ? "삭제" : "Delete"}</button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="row compact-toolbar">
          <h2>{lang === "ko" ? "배킹트랙 라이브러리" : "Backing Track Library"}</h2>
          <div className="compact-toolbar-actions">
            <div className="song-round-controls">
              <button
                className={`song-round-btn ${showBackingFilters ? "active-mini" : ""}`}
                title={lang === "ko" ? "필터" : "Filter"}
                aria-label={lang === "ko" ? "필터" : "Filter"}
                onClick={() => setShowBackingFilters((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h18l-7 8v5l-4 1v-6L3 5Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${showBackingGroup ? "active-mini" : ""}`}
                title={lang === "ko" ? "그룹" : "Group"}
                aria-label={lang === "ko" ? "그룹" : "Group"}
                onClick={() => setShowBackingGroup((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${backingViewMode === "list" ? "active-mini" : ""}`}
                title={lang === "ko" ? "리스트" : "List"}
                aria-label={lang === "ko" ? "리스트" : "List"}
                onClick={() => setBackingViewMode("list")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${backingViewMode === "gallery" ? "active-mini" : ""}`}
                title={lang === "ko" ? "갤러리" : "Gallery"}
                aria-label={lang === "ko" ? "갤러리" : "Gallery"}
                onClick={() => setBackingViewMode("gallery")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 4h8v7H3V4Zm10 0h8v7h-8V4ZM3 13h8v7H3v-7Zm10 0h8v7h-8v-7Z" />
                </svg>
              </button>
            </div>
            <button className="ghost-btn compact-add-btn" onClick={() => setShowBackingCreate((v) => !v)}>{showBackingCreate ? (lang === "ko" ? "닫기" : "Close") : (lang === "ko" ? "배킹 추가" : "Add Backing")}</button>
            <button className="ghost-btn compact-add-btn" onClick={() => setShowBackingLib((v) => !v)}>{showBackingLib ? (lang === "ko" ? "접기" : "Collapse") : (lang === "ko" ? "열기" : "Expand")}</button>
          </div>
        </div>

        {showBackingLib ? (
          <>
            <div className="row compact-toolbar-search"><input value={backQ} onChange={(e) => setBackQ(e.target.value)} placeholder={lang === "ko" ? "배킹 검색" : "Search backing"} /><small className="muted">{filteredBack.length}</small></div>
            {showBackingFilters ? (
              <div className="filter-panel-inline">
                <label>{lang === "ko" ? "장르" : "Genre"}<select value={backGenre} onChange={(e) => setBackGenre(e.target.value)}>{backGenres.map((o) => <option key={o} value={o}>{o === "all" ? (lang === "ko" ? "전체" : "All") : o}</option>)}</select></label>
                <label>{lang === "ko" ? "태그" : "Tag"}<select value={backTag} onChange={(e) => setBackTag(e.target.value)}>{backTags.map((o) => <option key={o} value={o}>{o === "all" ? (lang === "ko" ? "전체" : "All") : renderTag(o)}</option>)}</select></label>
                <label>BPM Min<input value={backMin} onChange={(e) => setBackMin(e.target.value)} /></label>
                <label>BPM Max<input value={backMax} onChange={(e) => setBackMax(e.target.value)} /></label>
                <label className="inline"><input type="checkbox" checked={backFavoritesOnly} onChange={(e) => setBackFavoritesOnly(e.target.checked)} /><span>{lang === "ko" ? "즐겨찾기만" : "Favorites only"}</span></label>
              </div>
            ) : null}

            {showBackingGroup ? (
              <div className="filter-panel-inline">
                <label>{lang === "ko" ? "그룹 보기" : "Group By"}<select value={backGroupBy} onChange={(e) => setBackGroupBy(e.target.value as "none" | "genre" | "tag")}><option value="none">{lang === "ko" ? "사용 안함" : "None"}</option><option value="genre">{lang === "ko" ? "장르" : "Genre"}</option><option value="tag">{lang === "ko" ? "태그" : "Tag"}</option></select></label>
              </div>
            ) : null}

            {showBackingCreate ? (
              <div className="compact-create-panel">
                <div className="song-form-grid">
                  <label>{lang === "ko" ? "제목" : "Title"}<input value={backForm.title} onChange={(e) => setBackForm((p) => ({ ...p, title: e.target.value }))} /></label>
                  <label>
                    {lang === "ko" ? "장르" : "Genre"}
                    <select value={backForm.genre} onChange={(e) => setBackForm((p) => ({ ...p, genre: e.target.value }))}>
                      {backGenres.filter((item) => item !== "all").map((item) => (
                        <option key={`create-genre-${item}`} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>{lang === "ko" ? "코드" : "Chords"}<input value={backForm.chords} onChange={(e) => setBackForm((p) => ({ ...p, chords: e.target.value }))} /></label>
                  <label>BPM<input value={backForm.bpm} onChange={(e) => setBackForm((p) => ({ ...p, bpm: e.target.value }))} /></label>
                  <label>YouTube URL<input value={backForm.youtube_url} onChange={(e) => setBackForm((p) => ({ ...p, youtube_url: e.target.value }))} /></label>
                  <label>{lang === "ko" ? "연결 드릴" : "Linked Drill"}<select value={backForm.drill_id} onChange={(e) => setBackForm((p) => ({ ...p, drill_id: e.target.value }))}><option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>{drills.map((d) => <option key={d.drill_id} value={d.drill_id}>{d.name || d.drill_id}</option>)}</select></label>
                </div>
                <label>{lang === "ko" ? "태그" : "Tags"}<input value={backForm.tags} onChange={(e) => setBackForm((p) => ({ ...p, tags: e.target.value }))} /></label>
                <label className="inline"><input type="checkbox" checked={isFavorite(backForm.favorite || "")} onChange={(e) => setBackForm((p) => ({ ...p, favorite: e.target.checked ? "true" : "false" }))} /><span>{lang === "ko" ? "즐겨찾기" : "Favorite"}</span></label>
                <label>{lang === "ko" ? "설명" : "Description"}<input value={backForm.description} onChange={(e) => setBackForm((p) => ({ ...p, description: e.target.value }))} /></label>
                <label>Notes<input value={backForm.notes} onChange={(e) => setBackForm((p) => ({ ...p, notes: e.target.value }))} /></label>
                <div className="row"><button className="primary-btn compact-add-btn" onClick={async () => { if (!backForm.title.trim()) { setMessage(lang === "ko" ? "제목을 입력해주세요." : "Title is required."); return; } await createBackingTrack({ ...backForm, genre: backForm.genre || BACKING_GENRES[0] }); setBackForm(emptyBacking); await onRefresh(); }}>{lang === "ko" ? "저장" : "Save"}</button></div>
              </div>
            ) : null}

            {backingViewMode === "list" ? (
              <div className="table-wrap">
                <table className="session-table drill-backing-table">
                  <colgroup>
                    <col style={{ width: "38%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "16%" }} />
                  </colgroup>
                  <thead><tr><th>{lang === "ko" ? "제목" : "Title"}</th><th>{lang === "ko" ? "장르/코드/BPM" : "Genre / Chords / BPM"}</th><th>{lang === "ko" ? "연결 드릴" : "Linked Drill"}</th><th>{lang === "ko" ? "태그" : "Tags"}</th><th>{lang === "ko" ? "관리" : "Actions"}</th></tr></thead>
                  <tbody>{groupedBack.map((group) => (
                    <Fragment key={`bg_${group.key}`}>
                      {backGroupBy !== "none" ? <tr className="group-row"><td colSpan={5}><strong>{group.title}</strong></td></tr> : null}
                      {group.rows.map((r) => (
                        <tr key={r.backing_id}>
                          <td>
                            <div className="entity-main-cell">
                              <div className="entity-main-left">
                                <button className={`favorite-star inline-star ${isFavorite(r.favorite || "") ? "on" : ""}`} onClick={() => void toggleBackingFavorite(r)}>{isFavorite(r.favorite || "") ? "★" : "☆"}</button>
                                <strong>{r.title || r.backing_id}</strong>
                              </div>
                              <small className="muted entity-main-desc">{r.description || "-"}</small>
                            </div>
                          </td>
                          <td>{`${r.genre || "-"} / ${r.chords || "-"} / ${r.bpm || "-"}`}</td>
                          <td>{drills.find((d) => d.drill_id === (r.drill_id || ""))?.name || r.drill_id || "-"}</td>
                          <td><div className="song-genre-chips">{splitTags(r.tags || "").slice(0, 2).map((t) => <span key={`${r.backing_id}-${t}`} className="achievement-chip">{renderTag(t)}</span>)}</div></td>
                          <td><div className="row"><button className="ghost-btn" onClick={() => { setEditBackId(r.backing_id || ""); setEditBack({ ...emptyBacking, ...r }); }}>{lang === "ko" ? "수정" : "Edit"}</button><button className="ghost-btn danger-border" onClick={async () => { if (!window.confirm(lang === "ko" ? "삭제할까요?" : "Delete?")) return; await deleteBackingTrack(r.backing_id || ""); await onRefresh(); }}>{lang === "ko" ? "삭제" : "Delete"}</button></div></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="drill-gallery-grid">
                {groupedBack.map((group) => (
                  <section key={`back-gallery-${group.key}`} className="drill-gallery-group">
                    {backGroupBy !== "none" ? <h4>{group.title}</h4> : null}
                    <div className="drill-gallery-cards">
                      {group.rows.map((r) => {
                        const thumb = toYoutubeThumb(r.youtube_url || "");
                        return (
                          <article key={`back-card-${r.backing_id}`} className="drill-gallery-card backing">
                            <div className="drill-gallery-media">
                              {thumb ? <img src={thumb} alt={r.title || r.backing_id} /> : <span>BACKING</span>}
                            </div>
                            <div className="drill-gallery-body">
                              <div className="entity-main-left">
                                <button className={`favorite-star inline-star ${isFavorite(r.favorite || "") ? "on" : ""}`} onClick={() => void toggleBackingFavorite(r)}>{isFavorite(r.favorite || "") ? "★" : "☆"}</button>
                                <strong>{r.title || r.backing_id}</strong>
                              </div>
                              <small className="muted">{`${r.genre || "-"} · ${r.chords || "-"} · ${r.bpm || "-"} bpm`}</small>
                              <small className="muted">{drills.find((d) => d.drill_id === (r.drill_id || ""))?.name || r.drill_id || "-"}</small>
                              <div className="song-genre-chips">{splitTags(r.tags || "").slice(0, 4).map((t) => <span key={`${r.backing_id}-g-${t}`} className="achievement-chip">{renderTag(t)}</span>)}</div>
                              <small className="muted entity-main-desc">{r.description || "-"}</small>
                              <div className="row">
                                <button className="ghost-btn compact-add-btn" onClick={() => { setEditBackId(r.backing_id || ""); setEditBack({ ...emptyBacking, ...r }); }}>{lang === "ko" ? "수정" : "Edit"}</button>
                                <button className="ghost-btn compact-add-btn danger-border" onClick={async () => { if (!window.confirm(lang === "ko" ? "삭제할까요?" : "Delete?")) return; await deleteBackingTrack(r.backing_id || ""); await onRefresh(); }}>{lang === "ko" ? "삭제" : "Delete"}</button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>

      {editDrillId ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{lang === "ko" ? "드릴 수정" : "Edit Drill"}</h3>
            <div className="song-form-grid">
              <label>{lang === "ko" ? "이름" : "Name"}<input value={editDrill.name} onChange={(e) => setEditDrill((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>{lang === "ko" ? "영역" : "Area"}<select value={editDrill.area} onChange={(e) => setEditDrill((p) => ({ ...p, area: e.target.value }))}>{AREAS.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
              <label>BPM Min<input value={editDrill.bpm_min} onChange={(e) => setEditDrill((p) => ({ ...p, bpm_min: e.target.value }))} /></label>
              <label>BPM Max<input value={editDrill.bpm_max} onChange={(e) => setEditDrill((p) => ({ ...p, bpm_max: e.target.value }))} /></label>
              <label>{lang === "ko" ? "기본 배킹" : "Default Backing"}<select value={editDrill.default_backing_id} onChange={(e) => setEditDrill((p) => ({ ...p, default_backing_id: e.target.value }))}><option value="">{lang === "ko" ? "(없음)" : "(None)"}</option>{backingTracks.map((b) => <option key={b.backing_id} value={b.backing_id}>{b.title || b.backing_id}</option>)}</select></label>
              <label>{lang === "ko" ? "리소스" : "Resource"}<input value={editDrill.resource} onChange={(e) => setEditDrill((p) => ({ ...p, resource: e.target.value }))} /></label>
              <label>{lang === "ko" ? "이미지 URL" : "Image URL"}<input value={editDrill.image_url} onChange={(e) => setEditDrill((p) => ({ ...p, image_url: e.target.value }))} /></label>
              <label>{lang === "ko" ? "이미지 파일(다중)" : "Image Files (multi)"}<input type="file" accept="image/*" multiple onChange={(e) => void appendDrillImages(e.target.files, "edit")} /></label>
            </div>
            <div className="row">
              <button className="ghost-btn compact-add-btn" onClick={() => void pasteEditDrillImage()}>{lang === "ko" ? "클립보드 이미지 붙여넣기" : "Paste Image"}</button>
            </div>
            {editDrillImages.length ? (
              <div className="song-score-image-list">
                {editDrillImages.map((path) => (
                  <div key={`edit-drill-image-${path}`} className="song-score-thumb-item">
                    <img src={mediaPathSrc(path)} alt={path} />
                    <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={() => removeDrillImage("edit", path)}>
                      {lang === "ko" ? "삭제" : "Remove"}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="quest-catalog-panel">
              <strong>{lang === "ko" ? "드릴 태그" : "Drill Tags"}</strong>
              <div className="drill-tag-group-stack">
                {DRILL_TAG_GROUPS.map((group) => (
                  <section key={`edit-tag-group-${group.name}`} className="drill-tag-group">
                    <h5>{group.name}</h5>
                    <div className="chip-toggle-grid">
                      {group.tags.map((tag) => (
                        <button
                          key={`edit-tag-${tag}`}
                          type="button"
                          className={`chip-toggle ${editDrillTags.includes(tag) ? "selected" : ""}`}
                          onClick={() => setEditDrill((prev) => ({ ...prev, tags: toggleTagCsv(prev.tags || "", tag) }))}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <small className="muted">
                {lang === "ko" ? "선택됨" : "Selected"}: {editDrillTags.length ? editDrillTags.join(", ") : "—"}
              </small>
            </div>
            <label className="inline"><input type="checkbox" checked={isFavorite(editDrill.favorite || "")} onChange={(e) => setEditDrill((p) => ({ ...p, favorite: e.target.checked ? "true" : "false" }))} /><span>{lang === "ko" ? "즐겨찾기" : "Favorite"}</span></label>
            <label>{lang === "ko" ? "설명" : "Description"}<textarea value={editDrill.description} onChange={(e) => setEditDrill((p) => ({ ...p, description: e.target.value }))} /></label>
            <label>Notes<input value={editDrill.notes} onChange={(e) => setEditDrill((p) => ({ ...p, notes: e.target.value }))} /></label>
            <div className="modal-actions"><button className="primary-btn" onClick={async () => { const imagePaths = splitPathList(editDrill.image_paths || ""); const imagePath = imagePaths[0] || editDrill.image_path || ""; await updateDrill(editDrillId, { ...editDrill, tags: splitTags(editDrill.tags || "").join(";"), image_path: imagePath, image_paths: joinPathList(imagePaths) }); setEditDrillId(""); await onRefresh(); }}>{lang === "ko" ? "저장" : "Save"}</button><button className="ghost-btn" onClick={() => setEditDrillId("")}>{lang === "ko" ? "취소" : "Cancel"}</button></div>
          </div>
        </div>
      ) : null}

      {editBackId ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{lang === "ko" ? "배킹 수정" : "Edit Backing"}</h3>
            <div className="song-form-grid">
              <label>{lang === "ko" ? "제목" : "Title"}<input value={editBack.title} onChange={(e) => setEditBack((p) => ({ ...p, title: e.target.value }))} /></label>
              <label>
                {lang === "ko" ? "장르" : "Genre"}
                <select value={editBack.genre} onChange={(e) => setEditBack((p) => ({ ...p, genre: e.target.value }))}>
                  {backGenres.filter((item) => item !== "all").map((item) => (
                    <option key={`edit-genre-${item}`} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>{lang === "ko" ? "코드" : "Chords"}<input value={editBack.chords} onChange={(e) => setEditBack((p) => ({ ...p, chords: e.target.value }))} /></label>
              <label>BPM<input value={editBack.bpm} onChange={(e) => setEditBack((p) => ({ ...p, bpm: e.target.value }))} /></label>
              <label>YouTube URL<input value={editBack.youtube_url} onChange={(e) => setEditBack((p) => ({ ...p, youtube_url: e.target.value }))} /></label>
              <label>{lang === "ko" ? "연결 드릴" : "Linked Drill"}<select value={editBack.drill_id} onChange={(e) => setEditBack((p) => ({ ...p, drill_id: e.target.value }))}><option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>{drills.map((d) => <option key={d.drill_id} value={d.drill_id}>{d.name || d.drill_id}</option>)}</select></label>
              <label>{lang === "ko" ? "태그" : "Tags"}<input value={editBack.tags} onChange={(e) => setEditBack((p) => ({ ...p, tags: e.target.value }))} /></label>
            </div>
            <label className="inline"><input type="checkbox" checked={isFavorite(editBack.favorite || "")} onChange={(e) => setEditBack((p) => ({ ...p, favorite: e.target.checked ? "true" : "false" }))} /><span>{lang === "ko" ? "즐겨찾기" : "Favorite"}</span></label>
            <label>{lang === "ko" ? "설명" : "Description"}<input value={editBack.description} onChange={(e) => setEditBack((p) => ({ ...p, description: e.target.value }))} /></label>
            <label>Notes<input value={editBack.notes} onChange={(e) => setEditBack((p) => ({ ...p, notes: e.target.value }))} /></label>
            <div className="modal-actions"><button className="primary-btn" onClick={async () => { await updateBackingTrack(editBackId, { ...editBack, genre: editBack.genre || BACKING_GENRES[0], tags: splitTags(editBack.tags || "").join(";") }); setEditBackId(""); await onRefresh(); }}>{lang === "ko" ? "저장" : "Save"}</button><button className="ghost-btn" onClick={() => setEditBackId("")}>{lang === "ko" ? "취소" : "Cancel"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
