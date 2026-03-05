import { useEffect, useMemo, useRef, useState } from "react";
import { createSong, deleteSong, getSessions, updateSong, uploadAnyMediaFile } from "../api";
import {
  buildGenreGroups,
  collectGenrePool,
  collectMoodPool,
  normalizeGenre,
  parseGenreTokens,
  parseMoodTokens,
} from "../genreCatalog";
import type { Lang } from "../i18n";
import type { SessionItem, Settings } from "../types/models";

type Props = {
  lang: Lang;
  items: Array<Record<string, string>>;
  ladder: Array<Record<string, string>>;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onRefresh: () => Promise<void>;
  setMessage: (message: string) => void;
};

type ViewMode = "gallery" | "list";
type SortMode = "recent" | "title" | "practice" | "favorite";
type GroupMode = "none" | "status" | "genre";
type StatusGroupFilter = "all" | "before" | "progress" | "done" | "other";
type ToolbarPanel = "view" | "filter" | "group" | "sort";

type SongForm = {
  title: string;
  artist: string;
  genre: string;
  mood: string;
  difficulty: string;
  status: string;
  purpose: string;
  original_url: string;
  sub_urls: string;
  cover_path: string;
  score_pdf_path: string;
  score_image_paths: string[];
  notes: string;
  favorite: boolean;
};

type SongRow = {
  library_id: string;
  title: string;
  artist: string;
  genre: string;
  mood: string;
  difficulty: string;
  status: string;
  purpose: string;
  original_url: string;
  sub_urls: string;
  cover_path: string;
  score_pdf_path: string;
  score_image_paths: string;
  cover_url: string;
  notes: string;
  created_at: string;
  last_practiced_at: string;
  favorite: string;
  favoriteBool: boolean;
};

const STATUS_OPTIONS = ["목표", "예정", "카피중", "시작", "루프 연습", "연습 중", "마무리", "공연완료", "보류"];
const PURPOSE_OPTIONS = ["체력 향상", "합주/공연", "좋아하는 곡", "카피 연습", "기타"];
const STATUS_GROUP_ORDER: Array<Exclude<StatusGroupFilter, "all">> = ["before", "progress", "done", "other"];
const DEFAULT_DIFFICULTY_OPTIONS = ["Lv.1", "Lv.2", "Lv.3", "Lv.4", "Lv.5"];
const DIFFICULTY_UNSPECIFIED = "__unspecified__";

const EMPTY_FORM: SongForm = {
  title: "",
  artist: "",
  genre: "",
  mood: "",
  difficulty: "",
  status: "예정",
  purpose: PURPOSE_OPTIONS[0],
  original_url: "",
  sub_urls: "",
  cover_path: "",
  score_pdf_path: "",
  score_image_paths: [],
  notes: "",
  favorite: false,
};

function asFavorite(value: string): boolean {
  const raw = String(value || "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function splitPathList(raw: string): string[] {
  return String(raw || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinPathList(values: string[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  values.forEach((item) => {
    const token = String(item || "").trim();
    if (!token || seen.has(token)) return;
    seen.add(token);
    ordered.push(token);
  });
  return ordered.join(";");
}

function mediaPathSrc(path: string): string {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) return raw;
  return `/media/${raw}`;
}

function fileLabel(path: string): string {
  const raw = String(path || "").trim();
  if (!raw) return "";
  const chunks = raw.split("/");
  return chunks[chunks.length - 1] || raw;
}

function coverSrc(item: { cover_url?: string; cover_path?: string }): string {
  if (item.cover_url) return item.cover_url;
  if (item.cover_path) return mediaPathSrc(item.cover_path);
  return "";
}

function fmtDate(value: string): string {
  if (!value) return "-";
  return value.replace("T", " ").slice(0, 16);
}

function normalizeDifficulty(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const compact = value.replace(/\s+/g, "");
  const lvMatch = compact.match(/^lv\.?([0-9]+)$/i);
  if (lvMatch) return `Lv.${lvMatch[1]}`;
  const numMatch = compact.match(/^([0-9]+)$/);
  if (numMatch) return `Lv.${numMatch[1]}`;
  return value;
}

function difficultySort(a: string, b: string): number {
  const aMatch = normalizeDifficulty(a).match(/^Lv\.([0-9]+)$/);
  const bMatch = normalizeDifficulty(b).match(/^Lv\.([0-9]+)$/);
  const aNum = aMatch ? Number(aMatch[1]) : 999;
  const bNum = bMatch ? Number(bMatch[1]) : 999;
  if (aNum !== bNum) return aNum - bNum;
  return a.localeCompare(b);
}

function statusGroupOf(status: string): Exclude<StatusGroupFilter, "all"> {
  const value = String(status || "").trim();
  if (["목표", "예정", "카피중"].includes(value)) return "before";
  if (["시작", "루프 연습", "연습 중"].includes(value)) return "progress";
  if (["마무리", "공연완료", "종료"].includes(value)) return "done";
  return "other";
}

function statusGroupLabel(group: Exclude<StatusGroupFilter, "all">, lang: Lang): string {
  if (group === "before") return lang === "ko" ? "시작 전" : "Before Start";
  if (group === "progress") return lang === "ko" ? "진행 중" : "In Progress";
  if (group === "done") return lang === "ko" ? "완료" : "Done";
  return lang === "ko" ? "기타" : "Others";
}

function primaryGenre(raw: string): string {
  const genres = parseGenreTokens(raw || "");
  return genres[0] || "";
}

function sortStatusForGrouping(a: string, b: string): number {
  const groupRank = (status: string) => {
    const idx = STATUS_GROUP_ORDER.indexOf(statusGroupOf(status));
    return idx === -1 ? 99 : idx;
  };
  const rankDiff = groupRank(a) - groupRank(b);
  if (rankDiff !== 0) return rankDiff;
  return a.localeCompare(b);
}

async function readClipboardImage(): Promise<File | null> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return new File([blob], `clipboard_${Date.now()}.png`, { type: imageType });
    }
  } catch {
    return null;
  }
  return null;
}

export function SongsPage({ lang, items, ladder, settings, onSettingsChange, onRefresh, setMessage }: Props) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [activePanel, setActivePanel] = useState<ToolbarPanel | "">("");
  const [view, setView] = useState<ViewMode>("gallery");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [statusGroupFilter, setStatusGroupFilter] = useState<StatusGroupFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [genreGroupFilter, setGenreGroupFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [moodFilter, setMoodFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortMode>("recent");
  const [groupBy, setGroupBy] = useState<GroupMode>("none");
  const [createForm, setCreateForm] = useState<SongForm>(EMPTY_FORM);
  const [editSongId, setEditSongId] = useState("");
  const [editForm, setEditForm] = useState<SongForm>(EMPTY_FORM);

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const createModalRef = useRef<HTMLDivElement | null>(null);
  const editModalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void getSessions(1200).then(setSessions).catch(() => undefined);
  }, [items]);

  useEffect(() => {
    if (!activePanel) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!toolbarRef.current?.contains(target)) {
        setActivePanel("");
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [activePanel]);

  useEffect(() => {
    if (!showCreate && !editSongId && !activePanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const activeElement = document.activeElement as HTMLElement | null;
      const inputFocused =
        !!activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.tagName === "SELECT" ||
          activeElement.isContentEditable);
      const insideModal =
        !!activeElement &&
        ((!!createModalRef.current && createModalRef.current.contains(activeElement)) ||
          (!!editModalRef.current && editModalRef.current.contains(activeElement)));

      if (inputFocused && insideModal) {
        activeElement.blur();
        return;
      }

      event.preventDefault();
      if (activePanel) {
        setActivePanel("");
        return;
      }
      if (editSongId) {
        setEditSongId("");
        return;
      }
      if (showCreate) {
        setShowCreate(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCreate, editSongId, activePanel]);

  const rows = useMemo<SongRow[]>(
    () =>
      items.map((item) => ({
        library_id: String(item.library_id || ""),
        title: String(item.title || ""),
        artist: String(item.artist || ""),
        genre: String(item.genre || ""),
        mood: String(item.mood || ""),
        difficulty: normalizeDifficulty(String(item.difficulty || "")),
        status: String(item.status || "예정"),
        purpose: String(item.purpose || PURPOSE_OPTIONS[0]),
        original_url: String(item.original_url || ""),
        sub_urls: String(item.sub_urls || ""),
        cover_path: String(item.cover_path || ""),
        score_pdf_path: String(item.score_pdf_path || ""),
        score_image_paths: String(item.score_image_paths || ""),
        cover_url: String(item.cover_url || ""),
        notes: String(item.notes || ""),
        created_at: String(item.created_at || ""),
        last_practiced_at: String(item.last_practiced_at || ""),
        favorite: String(item.favorite || ""),
        favoriteBool: asFavorite(item.favorite || ""),
      })),
    [items]
  );

  const sessionCount = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((item) => {
      const key = item.song_library_id || "";
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [sessions]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>(STATUS_OPTIONS);
    rows.forEach((row) => {
      const status = String(row.status || "").trim();
      if (status) set.add(status);
    });
    return Array.from(set);
  }, [rows]);

  const recommendationGenrePool = useMemo(() => {
    const ladderGenres = ladder.map((row) => String(row.genre || row["장르"] || ""));
    return collectGenrePool(ladderGenres);
  }, [ladder]);

  const genreOptions = useMemo(() => recommendationGenrePool.map((genre) => normalizeGenre(genre)), [recommendationGenrePool]);
  const genreGroups = useMemo(() => buildGenreGroups(genreOptions), [genreOptions]);
  const genreGroupNames = useMemo(() => genreGroups.map((group) => group.name), [genreGroups]);

  const difficultyOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_DIFFICULTY_OPTIONS);
    ladder.forEach((row) => {
      const value = normalizeDifficulty(String(row.difficulty || row["difficulty"] || row["난이도"] || row["예상 난이도"] || ""));
      if (value) set.add(value);
    });
    rows.forEach((row) => {
      const value = normalizeDifficulty(row.difficulty || "");
      if (value) set.add(value);
    });
    return Array.from(set).sort(difficultySort);
  }, [ladder, rows]);

  const moodOptions = useMemo(() => {
    const ladderMoods = ladder.map((row) =>
      String(
        row.mood ||
          row["분위기 유형"] ||
          row["분위기유형"] ||
          row["분위기"] ||
          row.mood_tags ||
          row["mood_tags"] ||
          ""
      )
    );
    const libraryMoods = rows.map((row) => String(row.mood || ""));
    return collectMoodPool([...ladderMoods, ...libraryMoods]);
  }, [ladder, rows]);

  const statusOptionsForFilter = useMemo(() => {
    if (statusGroupFilter === "all") return statusOptions;
    return statusOptions.filter((item) => statusGroupOf(item) === statusGroupFilter);
  }, [statusGroupFilter, statusOptions]);

  const genreOptionsForFilter = useMemo(() => {
    if (genreGroupFilter === "all") return genreOptions;
    const selected = genreGroups.find((group) => group.name === genreGroupFilter);
    return selected ? selected.values : [];
  }, [genreGroupFilter, genreGroups, genreOptions]);

  useEffect(() => {
    if (statusFilter !== "all" && !statusOptionsForFilter.includes(statusFilter)) {
      setStatusFilter("all");
    }
  }, [statusFilter, statusOptionsForFilter]);

  useEffect(() => {
    if (genreFilter !== "all" && !genreOptionsForFilter.includes(genreFilter)) {
      setGenreFilter("all");
    }
  }, [genreFilter, genreOptionsForFilter]);

  useEffect(() => {
    if (
      difficultyFilter !== "all" &&
      difficultyFilter !== DIFFICULTY_UNSPECIFIED &&
      !difficultyOptions.includes(difficultyFilter)
    ) {
      setDifficultyFilter("all");
    }
  }, [difficultyFilter, difficultyOptions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => (favoritesOnly ? row.favoriteBool : true))
      .filter((row) => (statusGroupFilter !== "all" ? statusGroupOf(row.status || "") === statusGroupFilter : true))
      .filter((row) => (statusFilter !== "all" ? row.status === statusFilter : true))
      .filter((row) => (genreFilter !== "all" ? parseGenreTokens(row.genre || "").includes(genreFilter) : true))
      .filter((row) => (moodFilter !== "all" ? parseMoodTokens(row.mood || "").includes(moodFilter) : true))
      .filter((row) => {
        if (difficultyFilter === "all") return true;
        if (difficultyFilter === DIFFICULTY_UNSPECIFIED) {
          return !normalizeDifficulty(row.difficulty || "");
        }
        return normalizeDifficulty(row.difficulty || "") === difficultyFilter;
      })
      .filter((row) => {
        if (!q) return true;
        const text = `${row.title} ${row.artist} ${row.genre} ${row.mood} ${row.difficulty} ${row.status} ${row.library_id}`.toLowerCase();
        return text.includes(q);
      })
      .sort((a, b) => {
        const aPractice = sessionCount.get(a.library_id) || 0;
        const bPractice = sessionCount.get(b.library_id) || 0;
        const aRecent = a.last_practiced_at || a.created_at || "";
        const bRecent = b.last_practiced_at || b.created_at || "";

        if (sortBy === "favorite") {
          const favoriteDiff = Number(b.favoriteBool) - Number(a.favoriteBool);
          if (favoriteDiff !== 0) return favoriteDiff;
          if (bPractice !== aPractice) return bPractice - aPractice;
          return bRecent.localeCompare(aRecent);
        }
        if (sortBy === "practice") {
          if (bPractice !== aPractice) return bPractice - aPractice;
          return bRecent.localeCompare(aRecent);
        }
        if (sortBy === "title") {
          const title = (a.title || a.library_id).localeCompare(b.title || b.library_id);
          if (title !== 0) return title;
          return bRecent.localeCompare(aRecent);
        }
        return bRecent.localeCompare(aRecent);
      });
  }, [
    rows,
    favoritesOnly,
    statusGroupFilter,
    statusFilter,
    genreFilter,
    moodFilter,
    difficultyFilter,
    query,
    sortBy,
    sessionCount,
  ]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", title: "", rows: filtered }];
    const map = new Map<string, SongRow[]>();
    const push = (key: string, row: SongRow) => {
      const safe = key || (lang === "ko" ? "미분류" : "Uncategorized");
      if (!map.has(safe)) map.set(safe, []);
      map.get(safe)!.push(row);
    };

    filtered.forEach((row) => {
      if (groupBy === "status") {
        push(row.status || "", row);
      } else {
        push(primaryGenre(row.genre || ""), row);
      }
    });

    const entries = Array.from(map.entries());
    if (groupBy === "status") {
      entries.sort((a, b) => sortStatusForGrouping(a[0], b[0]));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }

    return entries.map(([key, bucket]) => ({ key, title: `${key} (${bucket.length})`, rows: bucket }));
  }, [filtered, groupBy, lang]);

  const progressSummary = useMemo(() => {
    let before = 0;
    let progress = 0;
    let done = 0;
    rows.forEach((row) => {
      const group = statusGroupOf(row.status || "");
      if (group === "before") before += 1;
      else if (group === "progress") progress += 1;
      else if (group === "done") done += 1;
    });
    return { before, progress, done };
  }, [rows]);

  const totalSongs = rows.length;
  const favoriteSongs = useMemo(() => rows.filter((row) => row.favoriteBool).length, [rows]);
  const practicedSongs = useMemo(() => rows.filter((row) => (sessionCount.get(row.library_id) || 0) > 0).length, [rows, sessionCount]);
  const totalSessions = useMemo(
    () => rows.reduce((sum, row) => sum + (sessionCount.get(row.library_id) || 0), 0),
    [rows, sessionCount]
  );
  const completionRate = totalSongs ? Math.round((progressSummary.done / totalSongs) * 100) : 0;
  const avgSessions = totalSongs ? Math.round((totalSessions / totalSongs) * 10) / 10 : 0;

  const progressTiles = useMemo(() => {
    const base = totalSongs || 1;
    return [
      {
        key: "before",
        label: lang === "ko" ? "진행 예정" : "Planned",
        count: progressSummary.before,
        ratio: progressSummary.before / base,
      },
      {
        key: "progress",
        label: lang === "ko" ? "진행중" : "In Progress",
        count: progressSummary.progress,
        ratio: progressSummary.progress / base,
      },
      {
        key: "done",
        label: lang === "ko" ? "완료" : "Done",
        count: progressSummary.done,
        ratio: progressSummary.done / base,
      },
    ] as const;
  }, [progressSummary, totalSongs, lang]);

  const genreRanked = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      parseGenreTokens(row.genre || "").forEach((genre) => {
        map.set(genre, (map.get(genre) || 0) + 1);
      });
    });
    return Array.from(map.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([label, count]) => ({
        label,
        count,
        ratio: totalSongs ? count / totalSongs : 0,
      }));
  }, [rows, totalSongs]);

  const genreGroupStats = useMemo(() => {
    const genreToGroup = new Map<string, string>();
    genreGroups.forEach((group) => {
      group.values.forEach((value) => genreToGroup.set(value, group.name));
    });

    const map = new Map<string, number>();
    const fallback = lang === "ko" ? "미분류" : "Uncategorized";
    const other = lang === "ko" ? "기타" : "Other";

    rows.forEach((row) => {
      const leadGenre = primaryGenre(row.genre || "");
      const key = leadGenre ? genreToGroup.get(leadGenre) || other : fallback;
      map.set(key, (map.get(key) || 0) + 1);
    });

    const palette = ["#2f7dff", "#20a39e", "#f59f00", "#e64980", "#2b8a3e", "#6f42c1", "#495057"];
    return Array.from(map.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([label, count], index) => ({
        label,
        count,
        ratio: totalSongs ? count / totalSongs : 0,
        color: palette[index % palette.length],
      }));
  }, [genreGroups, rows, lang, totalSongs]);

  const genrePieBackground = useMemo(() => {
    if (!genreGroupStats.length) {
      return "conic-gradient(color-mix(in srgb, var(--border) 78%, transparent) 0deg 360deg)";
    }

    let cursor = 0;
    const segments = genreGroupStats.map((item) => {
      const start = cursor;
      const end = start + item.ratio * 360;
      cursor = end;
      return `${item.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    });
    if (cursor < 360) {
      segments.push(`color-mix(in srgb, var(--border) 76%, transparent) ${cursor.toFixed(2)}deg 360deg`);
    }
    return `conic-gradient(${segments.join(", ")})`;
  }, [genreGroupStats]);

  const updateTargetForm = (target: "create" | "edit", updater: (prev: SongForm) => SongForm) => {
    if (target === "create") {
      setCreateForm((prev) => updater(prev));
    } else {
      setEditForm((prev) => updater(prev));
    }
  };

  const uploadCover = async (file: File | null, target: "create" | "edit") => {
    if (!file) return;
    const uploaded = await uploadAnyMediaFile(file, "image");
    updateTargetForm(target, (prev) => ({ ...prev, cover_path: uploaded.path }));
  };

  const uploadScorePdf = async (file: File | null, target: "create" | "edit") => {
    if (!file) return;
    const isPdf = String(file.name || "").toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setMessage(lang === "ko" ? "PDF 파일만 업로드할 수 있습니다." : "Only PDF file can be uploaded.");
      return;
    }
    const uploaded = await uploadAnyMediaFile(file, "image");
    updateTargetForm(target, (prev) => ({ ...prev, score_pdf_path: uploaded.path }));
  };

  const uploadScoreImages = async (files: FileList | File[] | null, target: "create" | "edit") => {
    if (!files || files.length === 0) return;
    const uploadedPaths: string[] = [];
    for (const file of Array.from(files)) {
      if (!String(file.type || "").toLowerCase().startsWith("image/")) continue;
      const uploaded = await uploadAnyMediaFile(file, "image");
      uploadedPaths.push(uploaded.path);
    }
    if (!uploadedPaths.length) return;
    updateTargetForm(target, (prev) => ({
      ...prev,
      score_image_paths: [...prev.score_image_paths, ...uploadedPaths],
    }));
  };

  const removeScoreImage = (target: "create" | "edit", imagePath: string) => {
    updateTargetForm(target, (prev) => ({
      ...prev,
      score_image_paths: prev.score_image_paths.filter((item) => item !== imagePath),
    }));
  };

  const pasteScoreImageTo = async (target: "create" | "edit") => {
    const clipped = await readClipboardImage();
    if (!clipped) {
      setMessage(lang === "ko" ? "클립보드에 이미지가 없습니다." : "No image in clipboard.");
      return;
    }
    await uploadScoreImages([clipped], target);
  };

  const pasteCoverImageTo = async (target: "create" | "edit") => {
    const clipped = await readClipboardImage();
    if (!clipped) {
      setMessage(lang === "ko" ? "클립보드에 이미지가 없습니다." : "No image in clipboard.");
      return;
    }
    await uploadCover(clipped, target);
  };

  const saveSong = async (mode: "create" | "edit") => {
    const form = mode === "create" ? createForm : editForm;
    if (!form.title.trim()) {
      setMessage(lang === "ko" ? "곡 제목은 필수입니다." : "Title is required.");
      return;
    }

    const payload: Record<string, string> = {
      title: form.title.trim(),
      artist: form.artist.trim(),
      genre: parseGenreTokens(form.genre.trim()).join(";"),
      mood: form.mood.trim(),
      difficulty: normalizeDifficulty(form.difficulty.trim()),
      status: form.status,
      purpose: form.purpose,
      original_url: form.original_url.trim(),
      sub_urls: form.sub_urls.trim(),
      cover_path: form.cover_path,
      score_pdf_path: form.score_pdf_path,
      score_image_paths: joinPathList(form.score_image_paths),
      notes: form.notes.trim(),
      favorite: form.favorite ? "true" : "false",
    };

    if (mode === "create") {
      await createSong(payload);
      setCreateForm(EMPTY_FORM);
      setShowCreate(false);
    } else {
      if (!editSongId) return;
      await updateSong(editSongId, payload);
      setEditSongId("");
    }

    await onRefresh();
  };

  const openEdit = (item: SongRow) => {
    setActivePanel("");
    setEditSongId(item.library_id);
    setEditForm({
      title: item.title,
      artist: item.artist,
      genre: parseGenreTokens(item.genre || "").join(";"),
      mood: item.mood || "",
      difficulty: normalizeDifficulty(item.difficulty || ""),
      status: item.status || "예정",
      purpose: PURPOSE_OPTIONS.includes(item.purpose || "") ? item.purpose : PURPOSE_OPTIONS[0],
      original_url: item.original_url,
      sub_urls: item.sub_urls,
      cover_path: item.cover_path,
      score_pdf_path: item.score_pdf_path,
      score_image_paths: splitPathList(item.score_image_paths),
      notes: item.notes,
      favorite: item.favoriteBool,
    });
  };

  const openCreate = () => {
    setActivePanel("");
    setShowCreate(true);
  };

  const toggleFavorite = async (item: SongRow) => {
    await updateSong(item.library_id, { favorite: item.favoriteBool ? "false" : "true" });
    await onRefresh();
  };

  const togglePanel = (panel: ToolbarPanel) => {
    setActivePanel((prev) => (prev === panel ? "" : panel));
  };

  void settings;
  void onSettingsChange;

  return (
    <div className="page-grid songs-page-list">
      <section className="card">
        <div className="row compact-toolbar song-toolbar">
          <h2>{lang === "ko" ? "곡 라이브러리" : "Song Library"}</h2>
          <div className="compact-toolbar-actions song-toolbar-actions" ref={toolbarRef}>
            <input
              className="song-query-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={lang === "ko" ? "제목/아티스트/장르/난이도/분위기 검색" : "Search title/artist/genre/level/mood"}
            />

            <button
              className={`ghost-btn compact-add-btn song-favorite-toggle ${favoritesOnly ? "active-mini" : ""}`}
              onClick={() => setFavoritesOnly((prev) => !prev)}
            >
              {lang === "ko" ? "즐겨찾기만" : "Favorites only"}
            </button>

            <div className="song-round-controls">
              <button
                className={`song-round-btn ${activePanel === "view" ? "active-mini" : ""}`}
                onClick={() => togglePanel("view")}
                title={lang === "ko" ? "보기" : "View"}
                aria-label={lang === "ko" ? "보기" : "View"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${activePanel === "filter" ? "active-mini" : ""}`}
                onClick={() => togglePanel("filter")}
                title={lang === "ko" ? "필터" : "Filter"}
                aria-label={lang === "ko" ? "필터" : "Filter"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h18l-7 8v5l-4 1v-6L3 5Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${activePanel === "group" ? "active-mini" : ""}`}
                onClick={() => togglePanel("group")}
                title={lang === "ko" ? "그룹" : "Group"}
                aria-label={lang === "ko" ? "그룹" : "Group"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
                </svg>
              </button>
              <button
                className={`song-round-btn ${activePanel === "sort" ? "active-mini" : ""}`}
                onClick={() => togglePanel("sort")}
                title={lang === "ko" ? "정렬" : "Sort"}
                aria-label={lang === "ko" ? "정렬" : "Sort"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 4h10v2H7V4Zm-3 7h13v2H4v-2Zm4 7h9v2H8v-2Z" />
                </svg>
              </button>
            </div>

            <button
              className="primary-btn compact-add-btn song-create-btn"
              data-testid="tutorial-songs-add-btn"
              onClick={openCreate}
            >
              {lang === "ko" ? "곡 추가" : "Add Song"}
            </button>

            {activePanel ? (
              <div className="song-toolbar-popover">
                {activePanel === "view" ? (
                  <div className="song-popover-block">
                    <strong>{lang === "ko" ? "보기" : "View"}</strong>
                    <div className="song-popover-btn-row">
                      <button
                        className={`ghost-btn compact-add-btn ${view === "gallery" ? "active-mini" : ""}`}
                        onClick={() => setView("gallery")}
                      >
                        {lang === "ko" ? "갤러리" : "Gallery"}
                      </button>
                      <button
                        className={`ghost-btn compact-add-btn ${view === "list" ? "active-mini" : ""}`}
                        onClick={() => setView("list")}
                      >
                        {lang === "ko" ? "리스트" : "List"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {activePanel === "filter" ? (
                  <div className="song-popover-grid">
                    <label>
                      {lang === "ko" ? "상태 그룹" : "Status Group"}
                      <select value={statusGroupFilter} onChange={(event) => setStatusGroupFilter(event.target.value as StatusGroupFilter)}>
                        <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                        {STATUS_GROUP_ORDER.map((item) => (
                          <option key={item} value={item}>
                            {statusGroupLabel(item, lang)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      {lang === "ko" ? "상태" : "Status"}
                      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                        <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                        {statusOptionsForFilter.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      {lang === "ko" ? "장르 그룹" : "Genre Group"}
                      <select value={genreGroupFilter} onChange={(event) => setGenreGroupFilter(event.target.value)}>
                        <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                        {genreGroupNames.map((groupName) => (
                          <option key={groupName} value={groupName}>
                            {groupName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {lang === "ko" ? "장르" : "Genre"}
                      <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)}>
                        <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                        {genreOptionsForFilter.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      {lang === "ko" ? "난이도" : "Difficulty"}
                      <select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)}>
                        <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                        <option value={DIFFICULTY_UNSPECIFIED}>{lang === "ko" ? "미지정" : "Unspecified"}</option>
                        {difficultyOptions.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      {lang === "ko" ? "분위기" : "Mood"}
                      <select value={moodFilter} onChange={(event) => setMoodFilter(event.target.value)}>
                        <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                        {moodOptions.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                {activePanel === "group" ? (
                  <div className="song-popover-block">
                    <strong>{lang === "ko" ? "그룹" : "Group"}</strong>
                    <label>
                      {lang === "ko" ? "그룹 방식" : "Group By"}
                      <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupMode)}>
                        <option value="none">{lang === "ko" ? "사용 안함" : "None"}</option>
                        <option value="status">{lang === "ko" ? "상태" : "Status"}</option>
                        <option value="genre">{lang === "ko" ? "장르" : "Genre"}</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                {activePanel === "sort" ? (
                  <div className="song-popover-block">
                    <strong>{lang === "ko" ? "정렬" : "Sort"}</strong>
                    <label>
                      {lang === "ko" ? "정렬 기준" : "Sort by"}
                      <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)}>
                        <option value="recent">{lang === "ko" ? "최신 연습순" : "Recent practice"}</option>
                        <option value="practice">{lang === "ko" ? "연습 횟수순" : "Most practiced"}</option>
                        <option value="favorite">{lang === "ko" ? "즐겨찾기 우선" : "Favorites first"}</option>
                        <option value="title">{lang === "ko" ? "제목순" : "Title"}</option>
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="song-stats-grid" data-testid="tutorial-songs-stats">
          <article className="song-stat-card song-stat-overview">
            <small>{lang === "ko" ? "라이브러리 요약" : "Library Snapshot"}</small>
            <div className="song-kpi-grid">
              <div className="song-kpi-item">
                <span>{lang === "ko" ? "전체 곡" : "Total"}</span>
                <strong>{totalSongs}</strong>
              </div>
              <div className="song-kpi-item">
                <span>{lang === "ko" ? "즐겨찾기" : "Favorites"}</span>
                <strong>{favoriteSongs}</strong>
              </div>
              <div className="song-kpi-item">
                <span>{lang === "ko" ? "연습한 곡" : "Practiced"}</span>
                <strong>{practicedSongs}</strong>
              </div>
              <div className="song-kpi-item">
                <span>{lang === "ko" ? "총 세션" : "Sessions"}</span>
                <strong>{totalSessions}</strong>
              </div>
            </div>
            <small className="muted">
              {lang === "ko" ? `완료율 ${completionRate}% · 평균 세션 ${avgSessions}` : `Completion ${completionRate}% · Avg sessions ${avgSessions}`}
            </small>
          </article>

          <article className="song-stat-card song-stat-insight">
            <small>{lang === "ko" ? "진행/장르 인사이트" : "Progress & Genre Insight"}</small>
            <div className="song-progress-inline">
              {progressTiles.map((item) => (
                <div key={item.key} className={`song-progress-tile ${item.key}`}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                  <div className="song-progress-bar">
                    <i style={{ width: `${Math.round(item.ratio * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="song-insight-main">
              <div className="song-status-pie-wrap">
                <div className="song-status-pie" style={{ background: genrePieBackground }} />
                <small className="muted">{lang === "ko" ? "장르 그룹 비중" : "Genre Group Mix"}</small>
              </div>
              <div className="song-genre-insight">
                <div className="song-status-legend">
                  {(genreGroupStats.length
                    ? genreGroupStats
                    : [{ label: lang === "ko" ? "데이터 없음" : "No data", count: 0, ratio: 0, color: "color-mix(in srgb, var(--border) 75%, transparent)" }])
                    .slice(0, 4)
                    .map((item) => (
                      <span key={`genre_group_${item.label}`}>
                        <i style={{ background: item.color }} />
                        {item.label}
                        <strong>{item.count}</strong>
                      </span>
                    ))}
                </div>
                <div className="song-top-genre-row">
                  {(genreRanked.length ? genreRanked : [{ label: lang === "ko" ? "장르 없음" : "No genre", count: 0, ratio: 0 }])
                    .slice(0, 5)
                    .map((item) => (
                      <span key={`genre_rank_${item.label}`} className="achievement-chip song-genre-rank-chip">
                        {item.label}
                        <b>{item.count}</b>
                      </span>
                    ))}
                </div>
              </div>
            </div>
          </article>
        </div>

        {view === "gallery" ? (
          groupBy === "none" ? (
            <div className="song-gallery-grid">
              {filtered.map((item) => (
                <SongGalleryCard
                  key={item.library_id}
                  item={item}
                  lang={lang}
                  sessionCount={sessionCount.get(item.library_id) || 0}
                  onToggleFavorite={() => void toggleFavorite(item)}
                  onEdit={() => openEdit(item)}
                  onDelete={async () => {
                    if (!window.confirm(lang === "ko" ? "이 곡을 삭제할까요?" : "Delete this song?")) return;
                    await deleteSong(item.library_id);
                    await onRefresh();
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="song-group-wrap">
              {groupedRows.map((group) => (
                <section key={`gallery_group_${group.key}`} className="song-group-section">
                  <h3 className="song-group-title">{group.title}</h3>
                  <div className="song-gallery-grid">
                    {group.rows.map((item) => (
                      <SongGalleryCard
                        key={item.library_id}
                        item={item}
                        lang={lang}
                        sessionCount={sessionCount.get(item.library_id) || 0}
                        onToggleFavorite={() => void toggleFavorite(item)}
                        onEdit={() => openEdit(item)}
                        onDelete={async () => {
                          if (!window.confirm(lang === "ko" ? "이 곡을 삭제할까요?" : "Delete this song?")) return;
                          await deleteSong(item.library_id);
                          await onRefresh();
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <div className="table-wrap">
            <table className="session-table clean-wrap song-list-table">
              <colgroup>
                <col />
                <col />
                <col />
                <col />
                <col />
                <col className="song-col-note" />
                <col className="song-col-session" />
                <col />
                <col className="song-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{lang === "ko" ? "곡" : "Song"}</th>
                  <th>{lang === "ko" ? "장르" : "Genre"}</th>
                  <th>{lang === "ko" ? "난이도" : "Difficulty"}</th>
                  <th>{lang === "ko" ? "상태" : "Status"}</th>
                  <th>{lang === "ko" ? "분위기" : "Mood"}</th>
                  <th>{lang === "ko" ? "노트" : "Notes"}</th>
                  <th>{lang === "ko" ? "연습 수" : "Sessions"}</th>
                  <th>{lang === "ko" ? "최근" : "Recent"}</th>
                  <th>{lang === "ko" ? "관리" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((group) => (
                  <SongListGroupRows
                    key={`rows_${group.key}`}
                    group={group}
                    showHeader={groupBy !== "none"}
                    lang={lang}
                    sessionCountMap={sessionCount}
                    onToggleFavorite={(item) => void toggleFavorite(item)}
                    onEdit={openEdit}
                    onDelete={async (item) => {
                      if (!window.confirm(lang === "ko" ? "이 곡을 삭제할까요?" : "Delete this song?")) return;
                      await deleteSong(item.library_id);
                      await onRefresh();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {showCreate ? (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal song-editor-modal" ref={createModalRef} data-testid="tutorial-songs-create-form" onClick={(event) => event.stopPropagation()}>
            <div className="row song-editor-head">
              <h3>{lang === "ko" ? "곡 추가" : "Add Song"}</h3>
              <div className="song-editor-head-actions">
                <button type="button" className="primary-btn compact-add-btn" onClick={() => void saveSong("create")}>
                  {lang === "ko" ? "저장" : "Save"}
                </button>
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => setShowCreate(false)}>
                  {lang === "ko" ? "닫기" : "Close"}
                </button>
              </div>
            </div>
            <SongFormEditor
              lang={lang}
              form={createForm}
              setForm={setCreateForm}
              moodOptions={moodOptions}
              genreOptions={genreOptions}
              genreGroups={genreGroups}
              difficultyOptions={difficultyOptions}
              onCoverUpload={(file) => void uploadCover(file, "create")}
              onPasteCoverImage={() => void pasteCoverImageTo("create")}
              onScorePdfUpload={(file) => void uploadScorePdf(file, "create")}
              onScoreImagesUpload={(files) => void uploadScoreImages(files, "create")}
              onPasteScoreImage={() => void pasteScoreImageTo("create")}
              onRemoveScorePdf={() => updateTargetForm("create", (prev) => ({ ...prev, score_pdf_path: "" }))}
              onRemoveScoreImage={(imagePath) => removeScoreImage("create", imagePath)}
            />
            <div className="modal-actions">
              <button className="primary-btn" onClick={() => void saveSong("create")}>
                {lang === "ko" ? "저장" : "Save"}
              </button>
              <button className="ghost-btn" onClick={() => setShowCreate(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editSongId ? (
        <div className="modal-backdrop" onClick={() => setEditSongId("")}>
          <div className="modal song-editor-modal" ref={editModalRef} onClick={(event) => event.stopPropagation()}>
            <div className="row song-editor-head">
              <h3>{lang === "ko" ? "곡 정보 수정" : "Edit Song"}</h3>
              <div className="song-editor-head-actions">
                <button type="button" className="primary-btn compact-add-btn" onClick={() => void saveSong("edit")}>
                  {lang === "ko" ? "저장" : "Save"}
                </button>
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => setEditSongId("")}>
                  {lang === "ko" ? "닫기" : "Close"}
                </button>
              </div>
            </div>
            <SongFormEditor
              lang={lang}
              form={editForm}
              setForm={setEditForm}
              moodOptions={moodOptions}
              genreOptions={genreOptions}
              genreGroups={genreGroups}
              difficultyOptions={difficultyOptions}
              onCoverUpload={(file) => void uploadCover(file, "edit")}
              onPasteCoverImage={() => void pasteCoverImageTo("edit")}
              onScorePdfUpload={(file) => void uploadScorePdf(file, "edit")}
              onScoreImagesUpload={(files) => void uploadScoreImages(files, "edit")}
              onPasteScoreImage={() => void pasteScoreImageTo("edit")}
              onRemoveScorePdf={() => updateTargetForm("edit", (prev) => ({ ...prev, score_pdf_path: "" }))}
              onRemoveScoreImage={(imagePath) => removeScoreImage("edit", imagePath)}
            />
            <div className="modal-actions">
              <button className="primary-btn" onClick={() => void saveSong("edit")}>
                {lang === "ko" ? "저장" : "Save"}
              </button>
              <button className="ghost-btn" onClick={() => setEditSongId("")}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SongGalleryCardProps = {
  item: SongRow;
  lang: Lang;
  sessionCount: number;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function SongGalleryCard({ item, lang, sessionCount, onToggleFavorite, onEdit, onDelete }: SongGalleryCardProps) {
  return (
    <article className="song-gallery-card">
      <div className="song-gallery-cover-wrap">
        {coverSrc(item) ? (
          <img className="song-gallery-cover" src={coverSrc(item)} alt={item.title || item.library_id} />
        ) : (
          <div className="song-gallery-cover empty" />
        )}
        <button className={`favorite-star song-gallery-star ${item.favoriteBool ? "on" : ""}`} onClick={onToggleFavorite}>
          {item.favoriteBool ? "★" : "☆"}
        </button>
      </div>
      <div className="song-gallery-body">
        <strong>{item.title || item.library_id}</strong>
        <small className="muted">{item.artist || "-"}</small>
        <div className="song-genre-chips">
          {parseGenreTokens(item.genre || "").length ? (
            parseGenreTokens(item.genre || "").slice(0, 3).map((genre) => (
              <span key={`${item.library_id}_${genre}`} className="achievement-chip">
                {genre}
              </span>
            ))
          ) : (
            <span className="achievement-chip">{lang === "ko" ? "장르 없음" : "No genre"}</span>
          )}
          <span className="achievement-chip">{item.difficulty || (lang === "ko" ? "난이도 미지정" : "No level")}</span>
          <span className="achievement-chip">{item.status || "-"}</span>
          {item.mood ? <span className="achievement-chip">{item.mood}</span> : null}
        </div>
        <small className="muted">
          {lang === "ko" ? "연습 세션" : "Practice sessions"}: {sessionCount}
        </small>
        <div className="row">
          <button className="ghost-btn compact-add-btn" onClick={onEdit}>
            {lang === "ko" ? "수정" : "Edit"}
          </button>
          <button className="ghost-btn danger-border compact-add-btn" onClick={onDelete}>
            {lang === "ko" ? "삭제" : "Delete"}
          </button>
        </div>
      </div>
    </article>
  );
}

type SongListGroupRowsProps = {
  group: { key: string; title: string; rows: SongRow[] };
  showHeader: boolean;
  lang: Lang;
  sessionCountMap: Map<string, number>;
  onToggleFavorite: (item: SongRow) => void;
  onEdit: (item: SongRow) => void;
  onDelete: (item: SongRow) => void;
};

function SongListGroupRows({
  group,
  showHeader,
  lang,
  sessionCountMap,
  onToggleFavorite,
  onEdit,
  onDelete,
}: SongListGroupRowsProps) {
  return (
    <>
      {showHeader ? (
        <tr className="group-row">
          <td colSpan={9}>
            <strong>{group.title}</strong>
          </td>
        </tr>
      ) : null}
      {group.rows.map((item) => (
        <tr key={`${item.library_id}_row`}>
          <td>
            <div className="song-row-main">
              <button className={`favorite-star inline-star ${item.favoriteBool ? "on" : ""}`} onClick={() => onToggleFavorite(item)}>
                {item.favoriteBool ? "★" : "☆"}
              </button>
              {coverSrc(item) ? (
                <img className="song-cover-thumb" src={coverSrc(item)} alt={item.title || item.library_id} />
              ) : (
                <span className="song-cover-thumb empty" />
              )}
              <div>
                <strong>{item.title || item.library_id}</strong>
                <span className="muted">{item.artist || "-"}</span>
              </div>
            </div>
          </td>
          <td>
            {parseGenreTokens(item.genre || "").join(", ") || "-"}
          </td>
          <td>{item.difficulty || (lang === "ko" ? "미지정" : "Unspecified")}</td>
          <td>{item.status || "-"}</td>
          <td>{item.mood || "-"}</td>
          <td className="song-list-note-cell">{item.notes || "-"}</td>
          <td className="song-list-session-cell">{sessionCountMap.get(item.library_id) || 0}</td>
          <td>{fmtDate(item.last_practiced_at || item.created_at)}</td>
          <td className="song-list-actions-cell">
            <div className="row">
              <button className="ghost-btn compact-add-btn" onClick={() => onEdit(item)}>
                {lang === "ko" ? "수정" : "Edit"}
              </button>
              <button className="ghost-btn danger-border compact-add-btn" onClick={() => onDelete(item)}>
                {lang === "ko" ? "삭제" : "Delete"}
              </button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

type SongFormEditorProps = {
  lang: Lang;
  form: SongForm;
  setForm: (next: SongForm) => void;
  moodOptions: string[];
  genreOptions: string[];
  genreGroups: Array<{ name: string; values: string[] }>;
  difficultyOptions: string[];
  onCoverUpload: (file: File | null) => void;
  onPasteCoverImage: () => void;
  onScorePdfUpload: (file: File | null) => void;
  onScoreImagesUpload: (files: FileList | File[] | null) => void;
  onPasteScoreImage: () => void;
  onRemoveScorePdf: () => void;
  onRemoveScoreImage: (imagePath: string) => void;
};

function SongFormEditor({
  lang,
  form,
  setForm,
  moodOptions,
  genreOptions,
  genreGroups,
  difficultyOptions,
  onCoverUpload,
  onPasteCoverImage,
  onScorePdfUpload,
  onScoreImagesUpload,
  onPasteScoreImage,
  onRemoveScorePdf,
  onRemoveScoreImage,
}: SongFormEditorProps) {
  const selectedGenres = useMemo(() => parseGenreTokens(form.genre || ""), [form.genre]);

  const updateGenres = (next: string[]) => {
    const ordered = [...next].sort((a, b) => {
      const ai = genreOptions.indexOf(a);
      const bi = genreOptions.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    setForm({ ...form, genre: ordered.join(";") });
  };

  const toggleGenre = (value: string) => {
    const normalized = normalizeGenre(value);
    const set = new Set(selectedGenres);
    if (set.has(normalized)) set.delete(normalized);
    else set.add(normalized);
    updateGenres(Array.from(set));
  };

  return (
    <div className="song-editor-layout">
      <div className="song-editor-main">
        <div className="song-form-grid">
          <label>
            {lang === "ko" ? "곡 제목" : "Title"}
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            {lang === "ko" ? "아티스트" : "Artist"}
            <input value={form.artist} onChange={(event) => setForm({ ...form, artist: event.target.value })} />
          </label>
          <label>
            {lang === "ko" ? "분위기" : "Mood"}
            <select value={form.mood} onChange={(event) => setForm({ ...form, mood: event.target.value })}>
              <option value="">{lang === "ko" ? "선택 없음" : "None"}</option>
              {moodOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            {lang === "ko" ? "난이도" : "Difficulty"}
            <select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}>
              <option value="">{lang === "ko" ? "미지정" : "Unspecified"}</option>
              {difficultyOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            {lang === "ko" ? "상태" : "Status"}
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            {lang === "ko" ? "목적" : "Purpose"}
            <select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })}>
              {PURPOSE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            {lang === "ko" ? "메인 URL" : "Main URL"}
            <input value={form.original_url} onChange={(event) => setForm({ ...form, original_url: event.target.value })} />
          </label>
          <label>
            {lang === "ko" ? "서브 URL (줄바꿈)" : "Sub URLs (newline)"}
            <textarea
              rows={1}
              className="song-sub-urls"
              value={form.sub_urls}
              onChange={(event) => setForm({ ...form, sub_urls: event.target.value })}
              placeholder={"https://..."}
            />
          </label>
          <label>
            {lang === "ko" ? "커버 파일" : "Cover File"}
            <input type="file" accept="image/*" onChange={(event) => onCoverUpload(event.target.files?.[0] ?? null)} />
            <div className="row">
              <button type="button" className="ghost-btn compact-add-btn" onClick={onPasteCoverImage}>
                {lang === "ko" ? "커버 클립보드 붙여넣기" : "Paste Cover from Clipboard"}
              </button>
              {form.cover_path ? (
                <img className="song-cover-inline" src={coverSrc({ cover_path: form.cover_path })} alt="cover-preview" />
              ) : null}
            </div>
          </label>
        </div>

        <div className="song-score-editor">
          <strong>{lang === "ko" ? "악보" : "Sheet Music"}</strong>
          <div className="song-score-grid">
            <div className="song-score-block">
              <label>
                {lang === "ko" ? "PDF (1개)" : "PDF (single)"}
                <input
                  data-testid="song-score-pdf-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => onScorePdfUpload(event.target.files?.[0] ?? null)}
                />
              </label>
              {form.score_pdf_path ? (
                <div className="song-score-item">
                  <a href={mediaPathSrc(form.score_pdf_path)} target="_blank" rel="noreferrer">
                    {fileLabel(form.score_pdf_path)}
                  </a>
                  <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={onRemoveScorePdf}>
                    {lang === "ko" ? "삭제" : "Remove"}
                  </button>
                </div>
              ) : (
                <small className="muted">{lang === "ko" ? "등록된 PDF 없음" : "No PDF uploaded"}</small>
              )}
            </div>

            <div className="song-score-block">
              <label>
                {lang === "ko" ? "이미지 (다중)" : "Images (multiple)"}
                <input
                  data-testid="song-score-image-input"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => onScoreImagesUpload(event.target.files)}
                />
              </label>
              <div className="row">
                <button
                  type="button"
                  className="ghost-btn compact-add-btn"
                  data-testid="song-score-paste-btn"
                  onClick={onPasteScoreImage}
                >
                  {lang === "ko" ? "클립보드 붙여넣기" : "Paste from Clipboard"}
                </button>
              </div>
              {form.score_image_paths.length ? (
                <div className="song-score-image-list">
                  {form.score_image_paths.map((path) => (
                    <div key={`score-img-${path}`} className="song-score-thumb-item">
                      <img src={mediaPathSrc(path)} alt={fileLabel(path) || "score-image"} />
                      <button
                        type="button"
                        className="ghost-btn compact-add-btn danger-border"
                        onClick={() => onRemoveScoreImage(path)}
                      >
                        {lang === "ko" ? "삭제" : "Remove"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <small className="muted">{lang === "ko" ? "등록된 이미지 없음" : "No images uploaded"}</small>
              )}
            </div>
          </div>
        </div>

        <div className="genre-group-list">
          <div className="row">
            <strong>{lang === "ko" ? "장르 (다중 선택)" : "Genres (multi-select)"}</strong>
            <button className="ghost-btn compact-add-btn" type="button" onClick={() => setForm({ ...form, genre: "" })}>
              {lang === "ko" ? "초기화" : "Clear"}
            </button>
          </div>
          {genreGroups.map((group) => (
            <details key={group.name} className="genre-group" open={group.values.some((value) => selectedGenres.includes(value))}>
              <summary>{group.name}</summary>
              <div className="chip-toggle-grid">
                {group.values.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`chip-toggle ${selectedGenres.includes(item) ? "selected" : ""}`}
                    onClick={() => toggleGenre(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </details>
          ))}
          <div className="song-genre-selected">
            {selectedGenres.length ? (
              selectedGenres.map((genre) => (
                <span key={`selected_${genre}`} className="achievement-chip">
                  {genre}
                </span>
              ))
            ) : (
              <small className="muted">{lang === "ko" ? "선택된 장르 없음" : "No genres selected"}</small>
            )}
          </div>
        </div>

        <div className="row song-editor-footer">
          <label className="inline">
            <input
              type="checkbox"
              checked={form.favorite}
              onChange={(event) => setForm({ ...form, favorite: event.target.checked })}
            />
            <span>{lang === "ko" ? "즐겨찾기" : "Favorite"}</span>
          </label>
        </div>
      </div>

      <div className="song-editor-notes">
        <label className="song-notes-label">
          {lang === "ko" ? "노트" : "Notes"}
          <textarea className="song-notes-textarea" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </div>
    </div>
  );
}



