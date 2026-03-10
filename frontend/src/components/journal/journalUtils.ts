export const RECORD_VIEW_KEY = "bassos_record_view_mode";

export type JournalMetaDraft = {
  practice_date: string;
  duration_min: string;
  bpm: string;
  focus: string;
  today_win: string;
  issue: string;
  next_action: string;
  recording_kind: string;
};

export type SlashCommandSpec = {
  id: string;
  label: string;
  snippet: string;
  keywords: string[];
};

export type AttachmentEmbedSize = "small" | "medium" | "large";

export type AttachmentEmbedMatch = {
  index: number;
  size: AttachmentEmbedSize;
  token: string;
  start: number;
  end: number;
};

const ATTACHMENT_EMBED_RE = /\{\{attachment:(\d+)(?:\s+size=(small|medium|large))?\}\}/gi;

export const SLASH_COMMANDS: SlashCommandSpec[] = [
  { id: "h2", label: "/h2", snippet: "## 제목\n", keywords: ["heading", "title", "제목"] },
  { id: "todo", label: "/todo", snippet: "- [ ] \n", keywords: ["check", "task", "체크", "할일"] },
  { id: "quote", label: "/quote", snippet: "> \n", keywords: ["인용", "quote"] },
  { id: "divider", label: "/divider", snippet: "---\n", keywords: ["line", "구분선"] },
  { id: "today", label: "/today", snippet: `> ${new Date().toISOString().slice(0, 10)}\n`, keywords: ["date", "오늘"] },
  {
    id: "daily-log",
    label: "/daily-log",
    snippet: "## 오늘의 포커스\n- \n\n## 잘 된 점\n- \n\n## 막힌 점\n- \n\n## 다음 액션\n- [ ] \n",
    keywords: ["daily", "일일", "연습일지"],
  },
  {
    id: "monthly-review",
    label: "/monthly-review",
    snippet: "## 이번 달 요약\n- \n\n## 가장 늘어난 점\n- \n\n## 아직 불안한 점\n- \n\n## 다음 달 목표\n- [ ] \n",
    keywords: ["month", "monthly", "월간", "회고"],
  },
  {
    id: "video-review",
    label: "/video-review",
    snippet: "## 체크한 구간\n- \n\n## 톤/리듬 메모\n- \n\n## 수정 포인트\n- \n\n## 다음 테이크 액션\n- [ ] \n",
    keywords: ["video", "영상", "take", "테이크"],
  },
  {
    id: "next-action",
    label: "/next-action",
    snippet: "## 다음 액션\n- [ ] \n",
    keywords: ["next", "action", "다음액션"],
  },
];

export function emptyJournalMeta(): JournalMetaDraft {
  return {
    practice_date: "",
    duration_min: "",
    bpm: "",
    focus: "",
    today_win: "",
    issue: "",
    next_action: "",
    recording_kind: "",
  };
}

export function normalizeJournalMeta(value: Record<string, unknown> | undefined | null): JournalMetaDraft {
  const source = value && typeof value === "object" ? value : {};
  return {
    practice_date: String(source.practice_date || ""),
    duration_min: String(source.duration_min || ""),
    bpm: String(source.bpm || ""),
    focus: String(source.focus || ""),
    today_win: String(source.today_win || ""),
    issue: String(source.issue || ""),
    next_action: String(source.next_action || ""),
    recording_kind: String(source.recording_kind || ""),
  };
}

export function serializeJournalMeta(meta: JournalMetaDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.practice_date.trim()) out.practice_date = meta.practice_date.trim();
  if (meta.duration_min.trim()) {
    const parsed = Number(meta.duration_min);
    out.duration_min = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : meta.duration_min.trim();
  }
  if (meta.bpm.trim()) out.bpm = meta.bpm.trim();
  if (meta.focus.trim()) out.focus = meta.focus.trim();
  if (meta.today_win.trim()) out.today_win = meta.today_win.trim();
  if (meta.issue.trim()) out.issue = meta.issue.trim();
  if (meta.next_action.trim()) out.next_action = meta.next_action.trim();
  if (meta.recording_kind.trim()) out.recording_kind = meta.recording_kind.trim();
  return out;
}

export function hasMeaningfulMeta(meta: JournalMetaDraft): boolean {
  return Object.values(meta).some((value) => value.trim());
}

export function formatJournalDate(raw: string): string {
  if (!raw) return "";
  return raw.replace("T", " ").slice(0, 16);
}

function parseJournalDate(raw: string): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatJournalBoardDate(raw: string, now = new Date()): string {
  const parsed = parseJournalDate(raw);
  if (!parsed) return formatJournalDate(raw);
  if (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  ) {
    return `${padTwo(parsed.getHours())}:${padTwo(parsed.getMinutes())}`;
  }
  if (parsed.getFullYear() === now.getFullYear()) {
    return `${padTwo(parsed.getMonth() + 1)}.${padTwo(parsed.getDate())}`;
  }
  return `${padTwo(parsed.getFullYear() % 100)}.${padTwo(parsed.getMonth() + 1)}.${padTwo(parsed.getDate())}`;
}

export function formatJournalBoardTitle(raw: string, commentCount: number, fallback: string, limit = 36): string {
  const title = String(raw || "").trim() || fallback;
  const suffix = commentCount > 0 ? `(${commentCount})` : "";
  if (title.length + suffix.length <= limit) return `${title}${suffix}`;
  const room = Math.max(1, limit - suffix.length - 3);
  return `${title.slice(0, room).trim()}...${suffix}`;
}

export function stripMarkdown(text: string): string {
  return (text || "")
    .replace(ATTACHMENT_EMBED_RE, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[.\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerptFromMarkdown(text: string, limit = 110): string {
  const plain = stripMarkdown(text);
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

export function withAlpha(color: string, alpha = 0.14): string {
  const normalized = String(color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return "rgba(92,110,124,0.14)";
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function clampCommentDepth(depth: number): number {
  return Math.max(0, Math.min(3, Math.round(depth || 0)));
}

export function findSlashQuery(value: string, selectionStart: number): string {
  const head = value.slice(0, selectionStart);
  const lineStart = head.lastIndexOf("\n") + 1;
  const currentLine = head.slice(lineStart);
  const trimmed = currentLine.trimStart();
  if (!trimmed.startsWith("/")) return "";
  if (trimmed.includes(" ")) return "";
  return trimmed.slice(1).toLowerCase();
}

export function filterSlashCommands(query: string): SlashCommandSpec[] {
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((item) => {
    const target = `${item.id} ${item.label} ${item.keywords.join(" ")}`.toLowerCase();
    return target.includes(query);
  });
}

export function extractYouTubeVideoId(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  const candidate =
    /^https?:\/\//i.test(raw) ? raw : raw.startsWith("//") ? `https:${raw}` : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") || "";
      }
      if (
        parsed.pathname.startsWith("/shorts/") ||
        parsed.pathname.startsWith("/embed/") ||
        parsed.pathname.startsWith("/live/")
      ) {
        return parsed.pathname.split("/")[2] || "";
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function isYouTubeUrl(url: string): boolean {
  return Boolean(extractYouTubeVideoId(url));
}

export function normalizeYouTubeUrl(url: string): string {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

export function getYouTubeEmbedUrl(url: string): string {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
}

export function getYouTubeThumbnailUrl(url: string): string {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

export function buildAttachmentEmbedToken(index: number, size: AttachmentEmbedSize = "medium"): string {
  const safeIndex = Math.max(1, Math.round(index || 1));
  return size === "medium" ? `{{attachment:${safeIndex}}}` : `{{attachment:${safeIndex} size=${size}}}`;
}

export function extractAttachmentEmbeds(body: string): AttachmentEmbedMatch[] {
  const matches: AttachmentEmbedMatch[] = [];
  const input = String(body || "");
  ATTACHMENT_EMBED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTACHMENT_EMBED_RE.exec(input))) {
    const index = Number(match[1] || 0);
    if (!Number.isFinite(index) || index < 1) continue;
    const size = match[2] === "small" || match[2] === "large" ? match[2] : "medium";
    matches.push({
      index,
      size,
      token: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  ATTACHMENT_EMBED_RE.lastIndex = 0;
  return matches;
}

export function collectEmbeddedAttachmentIndexes(body: string): Set<number> {
  return new Set(extractAttachmentEmbeds(body).map((item) => item.index));
}

export function resolveRecordAttachmentUrl(input: { preview_url?: string; path?: string; url?: string }): string {
  if (input.preview_url) return input.preview_url;
  if (input.url) return input.url;
  if (input.path) return `/media/${input.path}`;
  return "";
}
