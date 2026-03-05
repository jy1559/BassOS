import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  claimQuest,
  createCustomQuest,
  failQuest,
  getCatalogs,
  getQuests,
  getSettings,
  getStatsOverview,
  refreshAutoQuests,
  updateQuest,
} from "../api";
import { buildGenreGroups, collectGenrePool, parseGenreTokens } from "../genreCatalog";
import type { Lang } from "../i18n";
import type { Quest, Settings, StatsOverview } from "../types/models";

type Props = {
  lang: Lang;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onRefresh: () => Promise<void>;
  onQuestClaimed?: (quest: Quest) => void;
};

type QuestRange = "7d" | "30d" | "6m" | "all";
type PeriodClass = "short" | "mid" | "long";
type Difficulty = "low" | "mid" | "high";
type Priority = "low" | "normal" | "urgent";
type RuleType = "count_events" | "sum_duration" | "manual";
type DoneStatus = "all" | "Claimed" | "Failed" | "Expired";
type DoneSort = "resolved_desc" | "resolved_asc" | "due_asc" | "due_desc" | "xp_desc";
type DoneGroup = "none" | "status" | "period" | "priority";
type QuestSort = "due_soon" | "default" | "due_late" | "xp_high" | "progress_high" | "title";
type LaneSortOption = "global" | QuestSort;

const PERIOD_ORDER: PeriodClass[] = ["short", "mid", "long"];
const PRIORITY_ORDER: Priority[] = ["urgent", "normal", "low"];

const XP_MATRIX: Record<PeriodClass, Record<Difficulty, number>> = {
  short: { low: 80, mid: 110, high: 140 },
  mid: { low: 150, mid: 210, high: 280 },
  long: { low: 260, mid: 360, high: 480 },
};

const QUEST_EMOJI_CATALOG: Array<{ emoji: string; label: string; tags: string[] }> = [
  { emoji: "\u{1F3B8}", label: "Bass", tags: ["bass", "instrument", "groove"] },
  { emoji: "\u{1F3B5}", label: "Note", tags: ["music", "note", "song"] },
  { emoji: "\u{1F3AF}", label: "Target", tags: ["goal", "target", "focus"] },
  { emoji: "\u{1F525}", label: "Fire", tags: ["hot", "urgent", "hard"] },
  { emoji: "\u{26A1}", label: "Lightning", tags: ["speed", "power", "quick"] },
  { emoji: "\u{1F3C1}", label: "Finish", tags: ["finish", "end", "complete"] },
  { emoji: "\u{2705}", label: "Check", tags: ["done", "manual", "check"] },
  { emoji: "\u{1F9E0}", label: "Mind", tags: ["theory", "mind", "practice"] },
  { emoji: "\u{1F552}", label: "Clock", tags: ["time", "duration", "timer"] },
  { emoji: "\u{23F1}\u{FE0F}", label: "Stopwatch", tags: ["session", "minutes", "time"] },
  { emoji: "\u{1F4AA}", label: "Power", tags: ["strength", "training", "drill"] },
  { emoji: "\u{1F3BC}", label: "Score", tags: ["score", "sheet", "music"] },
  { emoji: "\u{1F941}", label: "Rhythm", tags: ["rhythm", "beat", "groove"] },
  { emoji: "\u{1F3A7}", label: "Listen", tags: ["listen", "ear", "audio"] },
  { emoji: "\u{1F3A4}", label: "Performance", tags: ["stage", "performance", "live"] },
  { emoji: "\u{1F3AC}", label: "Recording", tags: ["record", "video", "capture"] },
  { emoji: "\u{1F4C8}", label: "Progress", tags: ["progress", "growth", "xp"] },
  { emoji: "\u{1F3C6}", label: "Trophy", tags: ["reward", "achievement", "win"] },
  { emoji: "\u{1F319}", label: "Night", tags: ["night", "focus", "late"] },
  { emoji: "\u{2600}\u{FE0F}", label: "Day", tags: ["day", "routine", "daily"] },
  { emoji: "\u{1F9E9}", label: "Puzzle", tags: ["problem", "challenge", "skill"] },
  { emoji: "\u{1F680}", label: "Launch", tags: ["start", "boost", "fast"] },
  { emoji: "\u{1F4CC}", label: "Pin", tags: ["priority", "important", "pin"] },
  { emoji: "\u{1F4DA}", label: "Study", tags: ["study", "theory", "learning"] },
  { emoji: "\u{1F9EA}", label: "Experiment", tags: ["test", "try", "experiment"] },
  { emoji: "\u{1F9ED}", label: "Direction", tags: ["direction", "plan", "path"] },
  { emoji: "\u{1F3B2}", label: "Random", tags: ["random", "fun", "auto"] },
  { emoji: "\u{1F9F1}", label: "Block", tags: ["foundation", "basic", "core"] },
  { emoji: "\u{1FA9C}", label: "Step", tags: ["step", "ladder", "level"] },
  { emoji: "\u{1FA84}", label: "Magic", tags: ["special", "surprise", "creative"] },
];

const periodKo: Record<PeriodClass, string> = { short: "단기", mid: "중기", long: "장기" };
const diffKo: Record<Difficulty, string> = { low: "下", mid: "中", high: "上" };
const priorityKo: Record<Priority, string> = { low: "느긋", normal: "보통", urgent: "우선" };

function periodLabel(period: PeriodClass, lang: Lang): string {
  if (lang === "ko") return periodKo[period];
  if (period === "short") return "Short";
  if (period === "mid") return "Mid";
  return "Long";
}

function diffLabel(diff: Difficulty, lang: Lang): string {
  if (lang === "ko") return diffKo[diff];
  if (diff === "low") return "Low (下)";
  if (diff === "mid") return "Mid (中)";
  return "High (上)";
}

function priorityLabel(priority: Priority, lang: Lang): string {
  if (lang === "ko") return priorityKo[priority];
  if (priority === "urgent") return "Top";
  if (priority === "normal") return "Normal";
  return "Relax";
}

function statusLabel(status: string, lang: Lang): string {
  if (lang !== "ko") return status;
  if (status === "Claimed") return "완료";
  if (status === "Failed") return "실패";
  if (status === "Expired") return "만료";
  return status;
}

function ruleLabel(rule: RuleType, lang: Lang): string {
  if (lang === "ko") {
    if (rule === "count_events") return "세션 수";
    if (rule === "sum_duration") return "시간";
    return "수동";
  }
  if (rule === "count_events") return "Session Count";
  if (rule === "sum_duration") return "Duration";
  return "Manual";
}

function computeQuestXp(period: PeriodClass, diff: Difficulty, rule: RuleType): number {
  const base = XP_MATRIX[period][diff];
  return rule === "manual" ? Math.max(1, Math.round(base / 5)) : base;
}

function remainDays(dueDate: string): number {
  const due = new Date(`${String(dueDate || "").slice(0, 10)}T00:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.ceil((due - today) / (24 * 60 * 60 * 1000));
}

function remainText(days: number, lang: Lang): string {
  if (lang === "ko") {
    if (days > 0) return `${days}일 남음`;
    if (days === 0) return "오늘 마감";
    return `${Math.abs(days)}일 지남`;
  }
  if (days > 0) return `${days}d left`;
  if (days === 0) return "Due today";
  return `${Math.abs(days)}d overdue`;
}

function defaultEmoji(quest: Quest): string {
  if (quest.rule_type === "manual") return "✅";
  if (quest.rule_type === "sum_duration") return "⏱️";
  if (quest.auto_generated) return "♻️";
  return "🎯";
}

function addDaysToDate(dateText: string, days: number): string {
  const base = new Date(`${String(dateText || "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return String(dateText || "").slice(0, 10);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function progressRatio(quest: Quest): number {
  return Math.max(0, Math.min(1, Number(quest.progress || 0) / Math.max(1, Number(quest.target || 1))));
}

function compareQuestDefault(a: Quest, b: Quest): number {
  const pa = PRIORITY_ORDER.indexOf(a.priority);
  const pb = PRIORITY_ORDER.indexOf(b.priority);
  if (pa !== pb) return pa - pb;
  const dueCmp = String(a.due_date || "").localeCompare(String(b.due_date || ""));
  if (dueCmp !== 0) return dueCmp;
  return String(a.quest_id || "").localeCompare(String(b.quest_id || ""));
}

function compareQuestBySort(a: Quest, b: Quest, mode: QuestSort, lang: Lang): number {
  if (mode === "default") return compareQuestDefault(a, b);
  if (mode === "due_soon") {
    const dueCmp = String(a.due_date || "").localeCompare(String(b.due_date || ""));
    if (dueCmp !== 0) return dueCmp;
    return compareQuestDefault(a, b);
  }
  if (mode === "due_late") {
    const dueCmp = String(b.due_date || "").localeCompare(String(a.due_date || ""));
    if (dueCmp !== 0) return dueCmp;
    return compareQuestDefault(a, b);
  }
  if (mode === "xp_high") {
    if (b.xp_reward !== a.xp_reward) return b.xp_reward - a.xp_reward;
    return compareQuestDefault(a, b);
  }
  if (mode === "progress_high") {
    const progressCmp = progressRatio(b) - progressRatio(a);
    if (Math.abs(progressCmp) > 0.0001) return progressCmp > 0 ? 1 : -1;
    return compareQuestDefault(a, b);
  }
  const titleCmp = String(a.title || "").localeCompare(String(b.title || ""), lang === "ko" ? "ko" : "en");
  if (titleCmp !== 0) return titleCmp;
  return compareQuestDefault(a, b);
}

function sortLabel(mode: QuestSort | "global", lang: Lang): string {
  if (mode === "global") return lang === "ko" ? "전체 정렬 따름" : "Follow global sort";
  if (mode === "due_soon") return lang === "ko" ? "마감 임박순" : "Due soon";
  if (mode === "default") return lang === "ko" ? "기본(중요도→마감)" : "Default";
  if (mode === "due_late") return lang === "ko" ? "마감 늦은순" : "Due late";
  if (mode === "xp_high") return lang === "ko" ? "XP 높은순" : "XP high";
  if (mode === "progress_high") return lang === "ko" ? "진행률 높은순" : "Progress high";
  return lang === "ko" ? "제목순" : "Title";
}

export function QuestsPage({ lang, notify, onRefresh, onQuestClaimed }: Props) {
  const [range, setRange] = useState<QuestRange>("all");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [songs, setSongs] = useState<Array<Record<string, string>>>([]);
  const [songLadder, setSongLadder] = useState<Array<Record<string, string>>>([]);
  const [drills, setDrills] = useState<Array<Record<string, string>>>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  const [emoji, setEmoji] = useState("");
  const [emojiQuery, setEmojiQuery] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [periodClass, setPeriodClass] = useState<PeriodClass>("short");
  const [difficulty, setDifficulty] = useState<Difficulty>("low");
  const [priority, setPriority] = useState<Priority>("normal");
  const [ruleType, setRuleType] = useState<RuleType>("count_events");
  const [target, setTarget] = useState(3);
  const [dueDate, setDueDate] = useState("");
  const [useGenres, setUseGenres] = useState(false);
  const [useSongs, setUseSongs] = useState(false);
  const [useDrills, setUseDrills] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedSongs, setSelectedSongs] = useState<string[]>([]);
  const [selectedDrills, setSelectedDrills] = useState<string[]>([]);

  const [doneFilter, setDoneFilter] = useState<DoneStatus>("all");
  const [donePeriodFilter, setDonePeriodFilter] = useState<"all" | PeriodClass>("all");
  const [donePriorityFilter, setDonePriorityFilter] = useState<"all" | Priority>("all");
  const [doneSort, setDoneSort] = useState<DoneSort>("resolved_desc");
  const [doneGroup, setDoneGroup] = useState<DoneGroup>("status");
  const [viewPeriodFilter, setViewPeriodFilter] = useState<"all" | PeriodClass>("all");
  const [viewPriorityFilter, setViewPriorityFilter] = useState<"all" | Priority>("all");
  const [viewGroupBy, setViewGroupBy] = useState<"priority" | "none">("priority");
  const [globalSort, setGlobalSort] = useState<QuestSort>("due_soon");
  const [laneSort, setLaneSort] = useState<Record<PeriodClass, LaneSortOption>>({
    short: "global",
    mid: "global",
    long: "global",
  });
  const [cardMenuQuestId, setCardMenuQuestId] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editQuestId, setEditQuestId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("normal");
  const [editDifficulty, setEditDifficulty] = useState<Difficulty>("mid");
  const [editTarget, setEditTarget] = useState(1);
  const [editDueDate, setEditDueDate] = useState("");

  const load = async (nextRange: QuestRange = range) => {
    const [q, s, c, st] = await Promise.all([getQuests(), getStatsOverview(nextRange), getCatalogs(), getSettings()]);
    setQuests(q);
    setStats(s);
    setSongs(c.song_library || []);
    setSongLadder(c.song_ladder || []);
    setDrills(c.drill_library || []);
    setSettings(st);
  };

  useEffect(() => {
    void load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!createOpen && !doneOpen && !viewOpen && !editOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (cardMenuQuestId) {
        setCardMenuQuestId("");
        return;
      }
      if (editOpen) {
        setEditOpen(false);
        return;
      }
      if (createOpen) {
        setCreateOpen(false);
        return;
      }
      if (doneOpen) {
        setDoneOpen(false);
        return;
      }
      if (viewOpen) setViewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cardMenuQuestId, createOpen, doneOpen, editOpen, viewOpen]);

  const genres = useMemo(() => {
    const userGenres = Array.isArray(settings?.ui?.song_genres) ? settings.ui.song_genres.map((item) => String(item || "")) : [];
    const ladderGenres = songLadder.map((item) => String(item.genre || item["장르"] || item.style_tags || ""));
    const libraryGenres = songs.map((item) => String(item.genre || ""));
    return collectGenrePool([...userGenres, ...ladderGenres, ...libraryGenres]);
  }, [settings?.ui?.song_genres, songLadder, songs]);
  const genreGroups = useMemo(() => buildGenreGroups(genres), [genres]);

  const groupedSongs = useMemo(() => {
    const map = new Map<string, Array<Record<string, string>>>();
    for (const song of songs) {
      const key = parseGenreTokens(String(song.genre || ""))[0] || "기타";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(song);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [songs]);

  const groupedDrills = useMemo(() => {
    const map = new Map<string, Array<Record<string, string>>>();
    for (const drill of drills) {
      const key = String(drill.area || "기타");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(drill);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [drills]);

  const active = useMemo(() => quests.filter((q) => q.status === "Active"), [quests]);
  const done = useMemo(() => {
    const rows = quests.filter((q) => {
      if (!["Claimed", "Failed", "Expired"].includes(q.status)) return false;
      if (doneFilter !== "all" && q.status !== doneFilter) return false;
      if (donePeriodFilter !== "all" && q.period_class !== donePeriodFilter) return false;
      if (donePriorityFilter !== "all" && q.priority !== donePriorityFilter) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (doneSort === "resolved_desc") return String(b.resolved_at || "").localeCompare(String(a.resolved_at || ""));
      if (doneSort === "resolved_asc") return String(a.resolved_at || "").localeCompare(String(b.resolved_at || ""));
      if (doneSort === "due_asc") return String(a.due_date || "").localeCompare(String(b.due_date || ""));
      if (doneSort === "due_desc") return String(b.due_date || "").localeCompare(String(a.due_date || ""));
      return b.xp_reward - a.xp_reward;
    });
    return rows;
  }, [doneFilter, donePeriodFilter, donePriorityFilter, doneSort, quests]);

  const doneGroups = useMemo(() => {
    const map = new Map<string, Quest[]>();
    if (doneGroup === "none") {
      map.set(lang === "ko" ? "전체" : "All", done);
      return map;
    }
    for (const item of done) {
      const key = doneGroup === "status" ? item.status : doneGroup === "period" ? item.period_class : item.priority;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [done, doneGroup, lang]);

  const filteredActive = useMemo(
    () =>
      active.filter((q) => {
        if (viewPeriodFilter !== "all" && q.period_class !== viewPeriodFilter) return false;
        if (viewPriorityFilter !== "all" && q.priority !== viewPriorityFilter) return false;
        return true;
      }),
    [active, viewPeriodFilter, viewPriorityFilter]
  );

  const lanes = useMemo(() => {
    const byPeriod: Record<PeriodClass, Record<Priority, Quest[]>> = {
      short: { urgent: [], normal: [], low: [] },
      mid: { urgent: [], normal: [], low: [] },
      long: { urgent: [], normal: [], low: [] },
    };
    for (const quest of filteredActive) {
      const bucket = viewGroupBy === "priority" ? quest.priority : "normal";
      byPeriod[quest.period_class][bucket].push(quest);
    }
    for (const period of PERIOD_ORDER) {
      const periodSort = laneSort[period] === "global" ? globalSort : laneSort[period];
      for (const p of PRIORITY_ORDER) {
        byPeriod[period][p].sort((a, b) => compareQuestBySort(a, b, periodSort, lang));
      }
    }
    return byPeriod;
  }, [filteredActive, globalSort, laneSort, lang, viewGroupBy]);

  const periodDays = settings?.profile?.quest_settings?.period_days || { short: 7, mid: 30, long: 90 };
  const questStyle = settings?.profile?.quest_settings?.ui_style || {};
  const questStyleVars = useMemo(
    () =>
      ({
        "--quest-period-short-border": String(questStyle.period_border?.short || "var(--quest-period-short-border-base)"),
        "--quest-period-mid-border": String(questStyle.period_border?.mid || "var(--quest-period-mid-border-base)"),
        "--quest-period-long-border": String(questStyle.period_border?.long || "var(--quest-period-long-border-base)"),
        "--quest-period-short-fill": String(questStyle.period_fill?.short || "var(--quest-period-short-fill-base)"),
        "--quest-period-mid-fill": String(questStyle.period_fill?.mid || "var(--quest-period-mid-fill-base)"),
        "--quest-period-long-fill": String(questStyle.period_fill?.long || "var(--quest-period-long-fill-base)"),
        "--quest-priority-urgent-border": String(questStyle.priority_border?.urgent || "var(--quest-priority-urgent-border-base)"),
        "--quest-priority-normal-border": String(questStyle.priority_border?.normal || "var(--quest-priority-normal-border-base)"),
        "--quest-priority-low-border": String(questStyle.priority_border?.low || "var(--quest-priority-low-border-base)"),
        "--quest-difficulty-low-fill": String(questStyle.difficulty_fill?.low || "var(--quest-difficulty-low-fill-base)"),
        "--quest-difficulty-mid-fill": String(questStyle.difficulty_fill?.mid || "var(--quest-difficulty-mid-fill-base)"),
        "--quest-difficulty-high-fill": String(questStyle.difficulty_fill?.high || "var(--quest-difficulty-high-fill-base)"),
      }) as CSSProperties,
    [questStyle]
  );
  const filteredEmojiCatalog = useMemo(() => {
    const token = emojiQuery.trim().toLowerCase();
    if (!token) return QUEST_EMOJI_CATALOG;
    return QUEST_EMOJI_CATALOG.filter(
      (item) =>
        item.emoji.includes(token) ||
        item.label.toLowerCase().includes(token) ||
        item.tags.some((tag) => tag.toLowerCase().includes(token))
    );
  }, [emojiQuery]);
  const visiblePeriods: PeriodClass[] = viewPeriodFilter === "all" ? PERIOD_ORDER : [viewPeriodFilter];
  const xpPreview = useMemo(() => computeQuestXp(periodClass, difficulty, ruleType), [periodClass, difficulty, ruleType]);

  const toggle = (value: string, list: string[], setter: (next: string[]) => void) => {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const resetCreateForm = () => {
    setEmoji("");
    setEmojiQuery("");
    setTitle("");
    setDescription("");
    setPeriodClass("short");
    setDifficulty("low");
    setPriority("normal");
    setRuleType("count_events");
    setTarget(3);
    setDueDate("");
    setUseGenres(false);
    setUseSongs(false);
    setUseDrills(false);
    setSelectedGenres([]);
    setSelectedSongs([]);
    setSelectedDrills([]);
  };

  const submitCreate = async () => {
    if (!title.trim()) {
      notify(lang === "ko" ? "제목을 입력해 주세요." : "Title is required.", "error");
      return;
    }
    try {
      setBusy(true);
      await createCustomQuest({
        title: title.trim(),
        emoji: emoji.trim() || undefined,
        description: description.trim(),
        period_class: periodClass,
        difficulty,
        priority,
        rule_type: ruleType,
        target: Math.max(1, target),
        due_date: dueDate || undefined,
        genre_tags: useGenres ? selectedGenres : [],
        linked_song_ids: useSongs ? selectedSongs : [],
        linked_drill_ids: useDrills ? selectedDrills : [],
      });
      setCreateOpen(false);
      resetCreateForm();
      notify(lang === "ko" ? "퀘스트를 추가했습니다." : "Quest created.", "success");
      await load(range);
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to create quest", "error");
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (quest: Quest) => {
    setCardMenuQuestId("");
    setEditQuestId(quest.quest_id);
    setEditTitle(quest.title || "");
    setEditEmoji(quest.emoji || "");
    setEditDescription(quest.description || "");
    setEditPriority(quest.priority);
    setEditDifficulty(quest.difficulty);
    setEditTarget(Math.max(1, Number(quest.target || 1)));
    setEditDueDate(String(quest.due_date || "").slice(0, 10));
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editQuestId) return;
    if (!editTitle.trim()) {
      notify(lang === "ko" ? "제목을 입력해 주세요." : "Title is required.", "error");
      return;
    }
    if (!editDueDate) {
      notify(lang === "ko" ? "마감일을 입력해 주세요." : "Due date is required.", "error");
      return;
    }
    try {
      setBusy(true);
      await updateQuest(editQuestId, {
        title: editTitle.trim(),
        emoji: editEmoji.trim(),
        description: editDescription.trim(),
        priority: editPriority,
        difficulty: editDifficulty,
        target: Math.max(1, editTarget),
        due_date: editDueDate,
      });
      setEditOpen(false);
      setEditQuestId("");
      notify(lang === "ko" ? "퀘스트를 수정했습니다." : "Quest updated.", "success");
      await load(range);
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to update quest", "error");
    } finally {
      setBusy(false);
    }
  };

  const extendQuestDueDate = async (quest: Quest, days: number) => {
    try {
      setBusy(true);
      await updateQuest(quest.quest_id, { due_date: addDaysToDate(quest.due_date, days) });
      setCardMenuQuestId("");
      notify(lang === "ko" ? `마감일을 ${days}일 연장했습니다.` : `Due date extended by ${days} days.`, "success");
      await load(range);
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to extend due date", "error");
    } finally {
      setBusy(false);
    }
  };

  const refreshAutoQuestNow = async (period?: PeriodClass) => {
    try {
      setBusy(true);
      if (period) {
        await refreshAutoQuests({ period_class: period, force: true });
      } else {
        await refreshAutoQuests({ force: true });
      }
      await load(range);
      await onRefresh();
      notify(
        period
          ? lang === "ko"
            ? `${periodLabel(period, lang)} 자동퀘를 재생성했습니다.`
            : `${periodLabel(period, lang)} auto quests regenerated.`
          : lang === "ko"
          ? "전체 자동퀘를 재생성했습니다."
          : "All auto quests regenerated.",
        "success"
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to regenerate auto quests", "error");
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    const activeRows = quests.filter((q) => q.status === "Active");
    const urgentRows = activeRows.filter((q) => remainDays(q.due_date) >= 0 && remainDays(q.due_date) <= 3);
    const dueTodayRows = activeRows.filter((q) => remainDays(q.due_date) === 0);
    const nearestDue = activeRows
      .map((q) => ({ due: remainDays(q.due_date), dueDate: String(q.due_date || "").slice(0, 10) }))
      .filter((item) => item.due >= 0 && item.dueDate)
      .sort((a, b) => a.due - b.due || a.dueDate.localeCompare(b.dueDate))[0];
    const expectedXp = activeRows
      .filter((q) => (q.rule_type === "manual" ? true : q.claimable))
      .reduce((acc, q) => acc + Math.max(0, Number(q.xp_reward || 0)), 0);
    return {
      activeCount: activeRows.length,
      urgentCount: urgentRows.length,
      dueTodayCount: dueTodayRows.length,
      completedCount: stats?.quest_breakdown?.claimed_total ?? 0,
      nearestDueDate: nearestDue?.dueDate || "-",
      nearestDueRemain: nearestDue ? remainText(nearestDue.due, lang) : lang === "ko" ? "활성 퀘스트 없음" : "No active quests",
      expectedXp,
    };
  }, [quests, stats?.quest_breakdown?.claimed_total, lang]);

  return (
    <div className="quests-ux" style={questStyleVars}>
      <section className="card quests-topbar-card">
        <div className="row quests-top-actions">
          <div className="quest-top-title">
            <h2>{lang === "ko" ? "퀘스트" : "Quests"}</h2>
            <small className="muted">
              {lang === "ko"
                ? "기간별 목표를 한 화면에서 보고, 오늘 처리할 항목을 빠르게 정리하세요."
                : "Track period goals in one place and quickly process what to do today."}
            </small>
          </div>
          <div className="row">
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setDoneOpen(false);
                setViewOpen(false);
                setEditOpen(false);
                setCreateOpen(true);
              }}
            >
              {lang === "ko" ? "퀘스트 추가" : "Add Quest"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setCreateOpen(false);
                setDoneOpen(false);
                setEditOpen(false);
                setViewOpen(true);
              }}
            >
              {lang === "ko" ? "필터/그룹" : "Filter/Group"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setCreateOpen(false);
                setViewOpen(false);
                setEditOpen(false);
                setDoneOpen(true);
              }}
            >
              {lang === "ko" ? "완료 퀘스트" : "Completed"}
            </button>
          </div>
        </div>

        <div className="row quest-range-row">
          <div className="row">
            {(["7d", "30d", "6m", "all"] as QuestRange[]).map((r) => (
              <button
                type="button"
                key={r}
                className={`ghost-btn compact-add-btn ${range === r ? "active-mini" : ""}`}
                onClick={() => setRange(r)}
              >
                {r === "6m" ? "90d" : r}
              </button>
            ))}
          </div>
          <label className="quest-sort-wrap">
            <span>{lang === "ko" ? "정렬" : "Sort"}</span>
            <select value={globalSort} onChange={(event) => setGlobalSort(event.target.value as QuestSort)}>
              <option value="due_soon">{sortLabel("due_soon", lang)}</option>
              <option value="default">{sortLabel("default", lang)}</option>
              <option value="due_late">{sortLabel("due_late", lang)}</option>
              <option value="xp_high">{sortLabel("xp_high", lang)}</option>
              <option value="progress_high">{sortLabel("progress_high", lang)}</option>
              <option value="title">{sortLabel("title", lang)}</option>
            </select>
          </label>
        </div>

        <div className="quest-auto-refresh-row">
          <strong>{lang === "ko" ? "자동퀘 즉시 재생성" : "Auto Quest Regenerate"}</strong>
          <div className="row">
            {(["short", "mid", "long"] as PeriodClass[]).map((period) => (
              <button
                key={`top-regen-${period}`}
                type="button"
                className="ghost-btn compact-add-btn"
                disabled={busy}
                onClick={() => void refreshAutoQuestNow(period)}
              >
                {periodLabel(period, lang)}
              </button>
            ))}
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              disabled={busy}
              onClick={() => void refreshAutoQuestNow()}
            >
              {lang === "ko" ? "전체" : "All"}
            </button>
          </div>
        </div>

        <div className="quest-summary-grid">
          <div className="quest-summary-box">
            <span>{lang === "ko" ? "진행 중" : "Active"}</span>
            <strong>{summary.activeCount}</strong>
            <small>{lang === "ko" ? "현재 활성 퀘스트" : "active quests now"}</small>
          </div>
          <div className="quest-summary-box">
            <span>{lang === "ko" ? "마감 임박" : "Due Soon"}</span>
            <strong>{summary.urgentCount}</strong>
            <small>{lang === "ko" ? "D-3 이내" : "within D-3"}</small>
          </div>
          <div className="quest-summary-box">
            <span>{lang === "ko" ? "오늘 마감" : "Due Today"}</span>
            <strong>{summary.dueTodayCount}</strong>
            <small>{lang === "ko" ? "오늘 처리 필요" : "needs action today"}</small>
          </div>
          <div className="quest-summary-box">
            <span>{lang === "ko" ? "완료 퀘스트" : "Completed"}</span>
            <strong>{summary.completedCount}</strong>
            <small>{lang === "ko" ? "현재 범위 기준" : "in selected range"}</small>
          </div>
          <div className="quest-summary-box">
            <span>{lang === "ko" ? "가장 가까운 마감" : "Nearest Due"}</span>
            <strong>{summary.nearestDueDate}</strong>
            <small>{summary.nearestDueRemain}</small>
          </div>
          <div className="quest-summary-box">
            <span>{lang === "ko" ? "예상 수령 XP" : "Expected XP"}</span>
            <strong>+{summary.expectedXp}</strong>
            <small>{lang === "ko" ? "즉시 수령 가능 합계" : "claimable total"}</small>
          </div>
        </div>
      </section>

      <section className={`quests-lanes-wrap lanes-${visiblePeriods.length}`}>
        {visiblePeriods.map((period) => {
          const laneOrder: Priority[] = viewGroupBy === "priority" ? PRIORITY_ORDER : ["normal"];
          const groups = laneOrder.map((p) => ({ priority: p, items: lanes[period][p] })).filter((g) => g.items.length > 0);
          return (
            <article key={period} className={`card quest-period-lane quest-period-${period}`}>
              <div className="row quest-lane-header">
                <div>
                  <h3>
                    {periodLabel(period, lang)} ({Number(periodDays?.[period] || 0)}d)
                  </h3>
                  <small className="muted">{groups.reduce((acc, group) => acc + group.items.length, 0)}</small>
                </div>
                <label className="quest-lane-sort-wrap">
                  <span>{lang === "ko" ? "칼럼 정렬" : "Lane Sort"}</span>
                  <select
                    value={laneSort[period]}
                    onChange={(event) =>
                      setLaneSort((prev) => ({
                        ...prev,
                        [period]: event.target.value as LaneSortOption,
                      }))
                    }
                  >
                    <option value="global">{sortLabel("global", lang)}</option>
                    <option value="due_soon">{sortLabel("due_soon", lang)}</option>
                    <option value="default">{sortLabel("default", lang)}</option>
                    <option value="due_late">{sortLabel("due_late", lang)}</option>
                    <option value="xp_high">{sortLabel("xp_high", lang)}</option>
                    <option value="progress_high">{sortLabel("progress_high", lang)}</option>
                    <option value="title">{sortLabel("title", lang)}</option>
                  </select>
                </label>
              </div>

              <div className="quest-lane-scroll" onClick={() => setCardMenuQuestId("")}>
                {groups.length === 0 ? (
                  <p className="muted quest-empty-row">{lang === "ko" ? "활성 퀘스트가 없습니다." : "No active quests."}</p>
                ) : (
                  groups.map(({ priority: p, items }) => (
                    <section key={`${period}-${p}`} className="quest-priority-group">
                      {viewGroupBy === "priority" ? (
                        <div className="quest-priority-title">
                          <span className={`priority-pill priority-${p}`}>{priorityLabel(p, lang)}</span>
                        </div>
                      ) : null}
                      <div className="quest-card-grid quest-card-grid-lane">
                        {items.map((q) => {
                          const due = remainDays(q.due_date);
                          const progressPct = Math.max(0, Math.min(100, (q.progress / Math.max(1, q.target)) * 100));
                          const canComplete = q.rule_type === "manual" ? q.status === "Active" : q.claimable;
                          return (
                            <article
                              key={q.quest_id}
                              className={`quest-card quest-priority-${q.priority} quest-difficulty-${q.difficulty}`}
                            >
                              <div className="quest-card-top">
                                <div className="quest-title-main">
                                  <span className="quest-title-icon">{q.emoji || defaultEmoji(q)}</span>
                                  <strong className="quest-title-text">{q.title}</strong>
                                </div>
                                <div className="quest-top-badges">
                                  <span className={`priority-pill priority-${q.priority}`}>{priorityLabel(q.priority, lang)}</span>
                                  <span className={`quest-pill diff-${q.difficulty}`}>{diffLabel(q.difficulty, lang)}</span>
                                  <div className="quest-card-menu-wrap" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="ghost-btn compact-add-btn quest-menu-btn"
                                      onClick={() =>
                                        setCardMenuQuestId((prev) => (prev === q.quest_id ? "" : q.quest_id))
                                      }
                                      aria-label={lang === "ko" ? "퀘스트 메뉴 열기" : "Open quest menu"}
                                    >
                                      ⋮
                                    </button>
                                    {cardMenuQuestId === q.quest_id ? (
                                      <div className="quest-card-menu">
                                        <button
                                          type="button"
                                          className="ghost-btn danger-border compact-add-btn"
                                          disabled={busy}
                                          onClick={async () => {
                                            try {
                                              await failQuest(q.quest_id);
                                              setCardMenuQuestId("");
                                              await load(range);
                                              await onRefresh();
                                            } catch (error) {
                                              notify(error instanceof Error ? error.message : "Failed to fail quest", "error");
                                            }
                                          }}
                                        >
                                          {lang === "ko" ? "실패" : "Fail"}
                                        </button>
                                        <button
                                          type="button"
                                          className="ghost-btn compact-add-btn"
                                          disabled={busy}
                                          onClick={() => openEditModal(q)}
                                        >
                                          {lang === "ko" ? "수정" : "Edit"}
                                        </button>
                                        <button
                                          type="button"
                                          className="ghost-btn compact-add-btn"
                                          disabled={busy}
                                          onClick={() => void extendQuestDueDate(q, 3)}
                                        >
                                          {lang === "ko" ? "+3일 연장" : "+3d"}
                                        </button>
                                        <button
                                          type="button"
                                          className="ghost-btn compact-add-btn"
                                          disabled={busy}
                                          onClick={() => void extendQuestDueDate(q, 7)}
                                        >
                                          {lang === "ko" ? "+7일 연장" : "+7d"}
                                        </button>
                                        <button
                                          type="button"
                                          className="ghost-btn compact-add-btn"
                                          disabled={busy}
                                          onClick={() => void extendQuestDueDate(q, 14)}
                                        >
                                          {lang === "ko" ? "+14일 연장" : "+14d"}
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <small className="muted quest-desc">{q.description || (lang === "ko" ? "설명 없음" : "No description")}</small>

                              <div className="quest-deadline-row">
                                <div className={`quest-remaining ${due < 0 ? "overdue" : due === 0 ? "today" : ""}`}>{remainText(due, lang)}</div>
                                <small className="muted quest-deadline-inline">
                                  {lang === "ko" ? "마감 " : "Due "} {String(q.due_date || "").slice(0, 10)}
                                </small>
                                <div className="row quest-inline-actions">
                                  <button
                                    type="button"
                                    className="ghost-btn compact-add-btn quest-mini-action"
                                    disabled={!canComplete}
                                    onClick={async () => {
                                      try {
                                        await claimQuest(q.quest_id);
                                        onQuestClaimed?.(q);
                                        await load(range);
                                        await onRefresh();
                                      } catch (error) {
                                        notify(error instanceof Error ? error.message : "Failed to claim quest", "error");
                                      }
                                    }}
                                  >
                                    {lang === "ko" ? "완료" : "Done"}
                                  </button>
                                </div>
                              </div>

                              <div className="quest-progress-shell">
                                <div className="progress-bar">
                                  <div style={{ width: `${progressPct}%` }} />
                                </div>
                                <small>
                                  {q.progress}/{q.target} · +{q.xp_reward} XP
                                </small>
                              </div>

                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </article>
          );
        })}
      </section>

      {viewOpen ? (
        <div className="modal-backdrop" onClick={() => setViewOpen(false)}>
          <div className="modal quest-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3>{lang === "ko" ? "필터 / 그룹화" : "Filter / Group"}</h3>
              <button type="button" className="ghost-btn" onClick={() => setViewOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "기간 필터" : "Period"}
                <select value={viewPeriodFilter} onChange={(e) => setViewPeriodFilter(e.target.value as "all" | PeriodClass)}>
                  <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                  <option value="short">{periodLabel("short", lang)}</option>
                  <option value="mid">{periodLabel("mid", lang)}</option>
                  <option value="long">{periodLabel("long", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "중요도 필터" : "Priority"}
                <select value={viewPriorityFilter} onChange={(e) => setViewPriorityFilter(e.target.value as "all" | Priority)}>
                  <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                  <option value="urgent">{priorityLabel("urgent", lang)}</option>
                  <option value="normal">{priorityLabel("normal", lang)}</option>
                  <option value="low">{priorityLabel("low", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "그룹 방식" : "Grouping"}
                <select value={viewGroupBy} onChange={(e) => setViewGroupBy(e.target.value as "priority" | "none")}>
                  <option value="priority">{lang === "ko" ? "중요도 그룹" : "Priority Group"}</option>
                  <option value="none">{lang === "ko" ? "그룹 없음" : "No Group"}</option>
                </select>
              </label>
            </div>
            <div className="row modal-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setViewPeriodFilter("all");
                  setViewPriorityFilter("all");
                  setViewGroupBy("priority");
                }}
              >
                {lang === "ko" ? "초기화" : "Reset"}
              </button>
              <button type="button" className="primary-btn" onClick={() => setViewOpen(false)}>
                {lang === "ko" ? "적용" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal quest-create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3>{lang === "ko" ? "퀘스트 추가" : "Add Quest"}</h3>
              <button type="button" className="ghost-btn" onClick={() => setCreateOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <div className="song-form-grid">
              <div className="quest-emoji-picker">
                <label>{lang === "ko" ? "아이콘" : "Icon"}</label>
                <input
                  value={emojiQuery}
                  placeholder={lang === "ko" ? "이모지 검색 (예: bass, goal)" : "Search emoji (ex: bass, goal)"}
                  onChange={(e) => setEmojiQuery(e.target.value)}
                />
                <div className="quest-emoji-grid">
                  {filteredEmojiCatalog.slice(0, 36).map((item) => (
                    <button
                      key={`${item.emoji}-${item.label}`}
                      type="button"
                      className={`emoji-chip ${emoji === item.emoji ? "selected" : ""}`}
                      onClick={() => setEmoji(item.emoji)}
                      title={`${item.label} (${item.tags.join(", ")})`}
                    >
                      <span>{item.emoji}</span>
                    </button>
                  ))}
                </div>
                <small className="muted">{lang === "ko" ? "선택됨" : "Selected"}: {emoji || "—"}</small>
              </div>
              <label>
                {lang === "ko" ? "제목" : "Title"}
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
            </div>

            <label>
              {lang === "ko" ? "설명" : "Description"}
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>

            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "기간" : "Period"}
                <select value={periodClass} onChange={(e) => setPeriodClass(e.target.value as PeriodClass)}>
                  <option value="short">{periodLabel("short", lang)}</option>
                  <option value="mid">{periodLabel("mid", lang)}</option>
                  <option value="long">{periodLabel("long", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "난이도" : "Difficulty"}
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="low">{diffLabel("low", lang)}</option>
                  <option value="mid">{diffLabel("mid", lang)}</option>
                  <option value="high">{diffLabel("high", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "중요도" : "Priority"}
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  <option value="urgent">{priorityLabel("urgent", lang)}</option>
                  <option value="normal">{priorityLabel("normal", lang)}</option>
                  <option value="low">{priorityLabel("low", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "규칙" : "Rule"}
                <select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
                  <option value="count_events">{ruleLabel("count_events", lang)}</option>
                  <option value="sum_duration">{ruleLabel("sum_duration", lang)}</option>
                  <option value="manual">{ruleLabel("manual", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "목표" : "Target"}
                <input type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value || 1))} />
              </label>
              <label>
                {lang === "ko" ? "마감일" : "Due Date"}
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>

            <div className="quest-xp-preview">
              <strong>XP</strong>
              <span>{lang === "ko" ? "자동 계산" : "Auto"}: {xpPreview}</span>
            </div>

            <div className="quest-filter-toggle-row">
              <label className="inline">
                <input type="checkbox" checked={useGenres} onChange={(e) => setUseGenres(e.target.checked)} />
                <span>{lang === "ko" ? "장르 사용" : "Genres"}</span>
              </label>
              <label className="inline">
                <input type="checkbox" checked={useSongs} onChange={(e) => setUseSongs(e.target.checked)} />
                <span>{lang === "ko" ? "곡 연동" : "Songs"}</span>
              </label>
              <label className="inline">
                <input type="checkbox" checked={useDrills} onChange={(e) => setUseDrills(e.target.checked)} />
                <span>{lang === "ko" ? "드릴 연동" : "Drills"}</span>
              </label>
            </div>

            {useGenres ? (
              <div className="quest-catalog-panel">
                {genreGroups.length ? (
                  genreGroups.map((group) => (
                    <details key={`quest-genre-group-${group.name}`} open>
                      <summary>{group.name}</summary>
                      <div className="chip-toggle-grid">
                        {group.values.map((g) => (
                          <button
                            type="button"
                            key={g}
                            className={`chip-toggle ${selectedGenres.includes(g) ? "selected" : ""}`}
                            onClick={() => toggle(g, selectedGenres, setSelectedGenres)}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </details>
                  ))
                ) : (
                  <small className="muted">{lang === "ko" ? "사용 가능한 장르가 없습니다." : "No genres available."}</small>
                )}
                <small className="muted">
                  {lang === "ko" ? "선택됨" : "Selected"}: {selectedGenres.length ? selectedGenres.join(", ") : "—"}
                </small>
              </div>
            ) : null}

            {useSongs ? (
              <div className="quest-catalog-panel">
                {groupedSongs.map(([group, list]) => (
                  <details key={group} open>
                    <summary>{group}</summary>
                    {list.map((song) => {
                      const id = String(song.library_id || "");
                      return (
                        <label key={id} className="inline">
                          <input
                            type="checkbox"
                            checked={selectedSongs.includes(id)}
                            onChange={() => toggle(id, selectedSongs, setSelectedSongs)}
                          />
                          <span>{song.title || id}</span>
                        </label>
                      );
                    })}
                  </details>
                ))}
              </div>
            ) : null}

            {useDrills ? (
              <div className="quest-catalog-panel">
                {groupedDrills.map(([group, list]) => (
                  <details key={group} open>
                    <summary>{group}</summary>
                    {list.map((drill) => {
                      const id = String(drill.drill_id || "");
                      return (
                        <label key={id} className="inline">
                          <input
                            type="checkbox"
                            checked={selectedDrills.includes(id)}
                            onChange={() => toggle(id, selectedDrills, setSelectedDrills)}
                          />
                          <span>{drill.name || id}</span>
                        </label>
                      );
                    })}
                  </details>
                ))}
              </div>
            ) : null}

            <div className="row modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setCreateOpen(false)}>
                {lang === "ko" ? "취소" : "Cancel"}
              </button>
              <button type="button" className="primary-btn" disabled={busy} onClick={() => void submitCreate()}>
                {lang === "ko" ? "추가" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div className="modal quest-edit-modal" onClick={(event) => event.stopPropagation()}>
            <div className="row">
              <h3>{lang === "ko" ? "퀘스트 수정" : "Edit Quest"}</h3>
              <button type="button" className="ghost-btn" onClick={() => setEditOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "이모지" : "Emoji"}
                <input value={editEmoji} onChange={(event) => setEditEmoji(event.target.value)} />
              </label>
              <label>
                {lang === "ko" ? "제목" : "Title"}
                <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
              </label>
            </div>

            <label>
              {lang === "ko" ? "설명" : "Description"}
              <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </label>

            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "중요도" : "Priority"}
                <select value={editPriority} onChange={(event) => setEditPriority(event.target.value as Priority)}>
                  <option value="urgent">{priorityLabel("urgent", lang)}</option>
                  <option value="normal">{priorityLabel("normal", lang)}</option>
                  <option value="low">{priorityLabel("low", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "난이도" : "Difficulty"}
                <select value={editDifficulty} onChange={(event) => setEditDifficulty(event.target.value as Difficulty)}>
                  <option value="high">{diffLabel("high", lang)}</option>
                  <option value="mid">{diffLabel("mid", lang)}</option>
                  <option value="low">{diffLabel("low", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "목표" : "Target"}
                <input type="number" min={1} value={editTarget} onChange={(event) => setEditTarget(Number(event.target.value || 1))} />
              </label>
              <label>
                {lang === "ko" ? "마감일" : "Due Date"}
                <input type="date" value={editDueDate} onChange={(event) => setEditDueDate(event.target.value)} />
              </label>
            </div>

            <div className="row modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setEditOpen(false)}>
                {lang === "ko" ? "취소" : "Cancel"}
              </button>
              <button type="button" className="primary-btn" disabled={busy} onClick={() => void submitEdit()}>
                {lang === "ko" ? "저장" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {doneOpen ? (
        <div className="modal-backdrop" onClick={() => setDoneOpen(false)}>
          <div className="modal quest-done-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3>{lang === "ko" ? "완료 퀘스트" : "Completed Quests"}</h3>
              <button type="button" className="ghost-btn" onClick={() => setDoneOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "상태" : "Status"}
                <select value={doneFilter} onChange={(e) => setDoneFilter(e.target.value as DoneStatus)}>
                  <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                  <option value="Claimed">{lang === "ko" ? "완료" : "Claimed"}</option>
                  <option value="Failed">{lang === "ko" ? "실패" : "Failed"}</option>
                  <option value="Expired">{lang === "ko" ? "만료" : "Expired"}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "기간" : "Period"}
                <select value={donePeriodFilter} onChange={(e) => setDonePeriodFilter(e.target.value as "all" | PeriodClass)}>
                  <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                  <option value="short">{periodLabel("short", lang)}</option>
                  <option value="mid">{periodLabel("mid", lang)}</option>
                  <option value="long">{periodLabel("long", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "중요도" : "Priority"}
                <select value={donePriorityFilter} onChange={(e) => setDonePriorityFilter(e.target.value as "all" | Priority)}>
                  <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                  <option value="urgent">{priorityLabel("urgent", lang)}</option>
                  <option value="normal">{priorityLabel("normal", lang)}</option>
                  <option value="low">{priorityLabel("low", lang)}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "그룹" : "Group"}
                <select value={doneGroup} onChange={(e) => setDoneGroup(e.target.value as DoneGroup)}>
                  <option value="status">{lang === "ko" ? "상태" : "Status"}</option>
                  <option value="period">{lang === "ko" ? "기간" : "Period"}</option>
                  <option value="priority">{lang === "ko" ? "중요도" : "Priority"}</option>
                  <option value="none">{lang === "ko" ? "없음" : "None"}</option>
                </select>
              </label>
              <label>
                {lang === "ko" ? "정렬" : "Sort"}
                <select value={doneSort} onChange={(e) => setDoneSort(e.target.value as DoneSort)}>
                  <option value="resolved_desc">{lang === "ko" ? "처리 최신순" : "Resolved desc"}</option>
                  <option value="resolved_asc">{lang === "ko" ? "처리 오래된순" : "Resolved asc"}</option>
                  <option value="due_asc">{lang === "ko" ? "마감 빠른순" : "Due asc"}</option>
                  <option value="due_desc">{lang === "ko" ? "마감 늦은순" : "Due desc"}</option>
                  <option value="xp_desc">XP desc</option>
                </select>
              </label>
            </div>

            <div className="quest-card-grid">
              {Array.from(doneGroups.entries()).map(([groupKey, items]) => (
                <section key={groupKey} className="quest-done-group">
                  <h4>
                    {doneGroup === "status"
                      ? statusLabel(groupKey, lang)
                      : doneGroup === "period"
                      ? periodLabel(groupKey as PeriodClass, lang)
                      : doneGroup === "priority"
                      ? priorityLabel(groupKey as Priority, lang)
                      : groupKey}
                  </h4>
                  <div className="quest-card-grid">
                    {items.map((q) => (
                      <article
                        key={`done-${groupKey}-${q.quest_id}`}
                        className={`quest-card quest-priority-${q.priority} quest-difficulty-${q.difficulty}`}
                      >
                        <div className="quest-card-top">
                          <div className="quest-title-main">
                            <span className="quest-title-icon">{q.emoji || defaultEmoji(q)}</span>
                            <strong className="quest-title-text">{q.title}</strong>
                          </div>
                          <div className="quest-top-badges">
                            <span className={`priority-pill priority-${q.priority}`}>{priorityLabel(q.priority, lang)}</span>
                            <span className={`quest-pill diff-${q.difficulty}`}>{diffLabel(q.difficulty, lang)}</span>
                          </div>
                        </div>
                        <small>
                          {statusLabel(q.status, lang)} · {String(q.resolved_at || "").replace("T", " ").slice(0, 16)}
                        </small>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
