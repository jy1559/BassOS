import { useEffect, useMemo, useState } from "react";
import { deleteSession, getSessions, updateSession } from "../api";
import { RecordPeriodToolbar } from "../components/records/RecordPeriodToolbar";
import { RecordTabHeader } from "../components/records/RecordTabHeader";
import { buildRecordPeriodWindow, createDefaultRecordPeriodState, inRecordPeriodWindow } from "../components/records/recordPeriod";
import type { Lang } from "../i18n";
import type { RecordPeriodState, SessionItem, Settings } from "../types/models";
import { formatDisplayXp, getXpDisplayScale } from "../utils/xpDisplay";

type Props = {
  lang: Lang;
  settings: Settings;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onRefresh: () => Promise<void>;
};

type EditForm = {
  start_at: string;
  end_at: string;
  activity: string;
  sub_activity: string;
  notes: string;
  tags: string;
};

const activityOptions = ["Song", "Drill", "Etc"];
const subOptions = [
  "SongCopy",
  "SongLearn",
  "SongPractice",
  "Core",
  "Funk",
  "Slap",
  "Theory",
  "SongDiscovery",
  "Community",
  "Gear",
  "Etc",
];

const activityLabelKo: Record<string, string> = {
  Song: "노래",
  Drill: "드릴",
  Etc: "기타",
  SongCopy: "카피",
  SongLearn: "곡 익히기",
  SongPractice: "곡 연습",
  Core: "기본기",
  Funk: "펑크",
  Slap: "슬랩",
  Theory: "이론",
  SongDiscovery: "곡찾기",
  Community: "커뮤니티",
  Gear: "장비",
};

function activityLabel(activity: string, lang: Lang): string {
  return lang === "ko" ? activityLabelKo[activity] ?? activity : activity;
}

function normalizeActivity(activity: string): "Song" | "Drill" | "Etc" {
  const value = String(activity || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (["song", "songpractice", "songlearn", "songcopy", "곡", "노래"].includes(value)) return "Song";
  if (["drill", "drillpractice", "core", "funk", "slap", "theory", "드릴"].includes(value)) return "Drill";
  return "Etc";
}

function normalizeSubActivity(activity: string, subActivity: string): string {
  const sub = String(subActivity || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (sub === "songpractice") return "SongPractice";
  if (sub === "songlearn") return "SongLearn";
  if (sub === "songcopy") return "SongCopy";
  if (sub === "core") return "Core";
  if (sub === "funk") return "Funk";
  if (sub === "slap") return "Slap";
  if (sub === "theory") return "Theory";
  const normalizedActivity = normalizeActivity(activity);
  if (normalizedActivity === "Song") return "SongPractice";
  if (normalizedActivity === "Drill") return "Core";
  return "Etc";
}

function toDatetimeInput(value: string): string {
  if (!value) return "";
  const raw = value.replace("Z", "");
  return raw.slice(0, 16);
}

function renderStartAt(value: string): { date: string; time: string } {
  const raw = (value || "").replace("T", " ").replace("Z", "");
  return { date: raw.slice(0, 10), time: raw.slice(11, 16) };
}

function paceText(session: SessionItem): string {
  const songSpeed = session.song_speed as Record<string, unknown> | undefined;
  const drillBpm = session.drill_bpm as Record<string, unknown> | undefined;
  const speedText = songSpeed?.mode === "range" ? `${songSpeed.start}%~${songSpeed.end}%` : songSpeed?.single ? `${songSpeed.single}%` : "";
  const bpmText = drillBpm?.mode === "range" ? `${drillBpm.start}~${drillBpm.end} bpm` : drillBpm?.single ? `${drillBpm.single} bpm` : "";
  if (speedText && bpmText) return `${speedText} / ${bpmText}`;
  return speedText || bpmText || "-";
}

function songOrDrillLabel(session: SessionItem): string {
  const song = (session.song_title || session.song_library_id || "").trim();
  if (song) return song;
  const drill = (session.drill_name || session.drill_id || "").trim();
  if (drill) return drill;
  return "-";
}

export function SessionsPage({ lang, settings, notify, onRefresh }: Props) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [periodState, setPeriodState] = useState<RecordPeriodState>(() => createDefaultRecordPeriodState());
  const [activityFilter, setActivityFilter] = useState<"all" | "Song" | "Drill" | "Etc">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<SessionItem | null>(null);
  const [form, setForm] = useState<EditForm>({
    start_at: "",
    end_at: "",
    activity: "Song",
    sub_activity: "SongPractice",
    notes: "",
    tags: "",
  });
  const xpDisplayScale = getXpDisplayScale(settings);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await getSessions(2000);
      setSessions(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const periodWindow = useMemo(() => buildRecordPeriodWindow(periodState, lang), [periodState, lang]);

  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((item) => {
      if (!inRecordPeriodWindow(item.start_at, periodWindow)) return false;
      const normalizedActivity = normalizeActivity(item.activity);
      if (activityFilter !== "all" && normalizedActivity !== activityFilter) return false;
      if (!q) return true;
      const merged = `${item.song_title || ""} ${item.drill_name || ""} ${item.notes || ""} ${item.sub_activity || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      return merged.includes(q);
    });
  }, [sessions, periodWindow, activityFilter, query]);

  const summary = useMemo(() => {
    const sessionsCount = scoped.length;
    const totalDuration = scoped.reduce((acc, item) => acc + (item.duration_min || 0), 0);
    const totalXp = scoped.reduce((acc, item) => acc + (item.xp || 0), 0);
    const avg = sessionsCount > 0 ? Math.round((totalDuration / sessionsCount) * 10) / 10 : 0;
    const songCount = scoped.filter((item) => normalizeActivity(item.activity) === "Song").length;
    const drillCount = scoped.filter((item) => normalizeActivity(item.activity) === "Drill").length;
    return { sessionsCount, totalDuration, totalXp, avg, songCount, drillCount };
  }, [scoped]);

  const byActivity = useMemo(() => {
    const map = new Map<string, { duration: number; count: number }>();
    scoped.forEach((item) => {
      const key = normalizeActivity(item.activity);
      const prev = map.get(key) ?? { duration: 0, count: 0 };
      prev.duration += item.duration_min || 0;
      prev.count += 1;
      map.set(key, prev);
    });
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.duration - a.duration);
  }, [scoped]);

  const maxActivityDuration = Math.max(...byActivity.map((item) => item.duration), 1);

  return (
    <div className="page-grid songs-page-list">
      <section className="card">
        <RecordTabHeader
          title={lang === "ko" ? "세션 기록" : "Session Log"}
          toolbar={<RecordPeriodToolbar lang={lang} value={periodState} onChange={setPeriodState} testIdPrefix="sessions-period" compact />}
        />

        <div className="song-form-grid">
          <label>
            {lang === "ko" ? "활동 필터" : "Activity"}
            <select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as "all" | "Song" | "Drill" | "Etc")}>
              <option value="all">{lang === "ko" ? "전체" : "All"}</option>
              <option value="Song">{activityLabel("Song", lang)}</option>
              <option value="Drill">{activityLabel("Drill", lang)}</option>
              <option value="Etc">{activityLabel("Etc", lang)}</option>
            </select>
          </label>
          <label>
            {lang === "ko" ? "검색" : "Search"}
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={lang === "ko" ? "곡/드릴/노트/태그" : "song/drill/note/tag"} />
          </label>
        </div>

        <div className="stat-grid">
          <div><span>{lang === "ko" ? "세션" : "Sessions"}</span><strong>{summary.sessionsCount}</strong></div>
          <div><span>{lang === "ko" ? "총 시간(분)" : "Minutes"}</span><strong>{summary.totalDuration}</strong></div>
          <div><span>{lang === "ko" ? "평균 세션(분)" : "Avg"}</span><strong>{summary.avg}</strong></div>
          <div><span>XP</span><strong>{formatDisplayXp(summary.totalXp, xpDisplayScale)}</strong></div>
          <div><span>{lang === "ko" ? "노래 세션" : "Song Sessions"}</span><strong>{summary.songCount}</strong></div>
          <div><span>{lang === "ko" ? "드릴 세션" : "Drill Sessions"}</span><strong>{summary.drillCount}</strong></div>
        </div>

        <div className="activity-bars">
          {byActivity.map((item) => (
            <div key={item.key} className="activity-row">
              <span>{activityLabel(item.key, lang)}</span>
              <div className="progress-bar"><div style={{ width: `${Math.max(4, Math.round((item.duration / maxActivityDuration) * 100))}%` }} /></div>
              <strong>{item.duration}m</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card" data-testid="tutorial-sessions-list">
        <div className="row">
          <h2>{lang === "ko" ? "연습 세션 목록" : "Session Entries"}</h2>
          <small className="muted">{loading ? (lang === "ko" ? "불러오는 중..." : "Loading...") : `${scoped.length}`}</small>
        </div>
        <div className="table-wrap">
          <table className="session-table session-notes-table">
            <thead>
              <tr>
                <th>{lang === "ko" ? "시작" : "Start"}</th>
                <th>{lang === "ko" ? "활동" : "Activity"}</th>
                <th>{lang === "ko" ? "세부" : "Sub"}</th>
                <th>{lang === "ko" ? "곡/드릴" : "Song/Drill"}</th>
                <th>{lang === "ko" ? "속도/BPM" : "Speed/BPM"}</th>
                <th>{lang === "ko" ? "분" : "Min"}</th>
                <th>XP</th>
                <th className="note-col">{lang === "ko" ? "노트" : "Notes"}</th>
                <th>{lang === "ko" ? "관리" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {scoped.map((session) => {
                const start = renderStartAt(session.start_at);
                return (
                  <tr key={session.event_id}>
                    <td className="date-break">{start.date}<br />{start.time}</td>
                    <td>{activityLabel(normalizeActivity(session.activity), lang)}</td>
                    <td>{activityLabel(normalizeSubActivity(session.activity, session.sub_activity || ""), lang)}</td>
                    <td>{songOrDrillLabel(session)}</td>
                    <td>{paceText(session)}</td>
                    <td>{session.duration_min}</td>
                    <td>{formatDisplayXp(session.xp, xpDisplayScale)}</td>
                    <td className="note-cell">{session.notes || "-"}</td>
                    <td>
                      <div className="row session-action-row">
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            setEditing(session);
                            setForm({
                              start_at: toDatetimeInput(session.start_at),
                              end_at: toDatetimeInput(session.end_at),
                              activity: normalizeActivity(session.activity),
                              sub_activity: normalizeSubActivity(session.activity, session.sub_activity || ""),
                              notes: session.notes || "",
                              tags: session.tags.join(", "),
                            });
                          }}
                        >
                          {lang === "ko" ? "수정" : "Edit"}
                        </button>
                        <button
                          className="ghost-btn danger-border"
                          data-testid={`session-delete-${session.event_id}`}
                          onClick={async () => {
                            if (!window.confirm(lang === "ko" ? "이 세션을 삭제할까요?" : "Delete this session?")) return;
                            try {
                              await deleteSession(session.event_id);
                              notify(lang === "ko" ? "세션 삭제 완료 (XP/레벨 재계산)" : "Session deleted", "success");
                              await load();
                              await onRefresh();
                            } catch (error) {
                              notify(error instanceof Error ? error.message : "Delete failed", "error");
                            }
                          }}
                        >
                          {lang === "ko" ? "삭제" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{lang === "ko" ? "세션 수정" : "Edit Session"}</h3>
            <label>
              {lang === "ko" ? "시작 시간" : "Start Time"}
              <input type="datetime-local" value={form.start_at} onChange={(event) => setForm((prev) => ({ ...prev, start_at: event.target.value }))} />
            </label>
            <label>
              {lang === "ko" ? "종료 시간" : "End Time"}
              <input type="datetime-local" value={form.end_at} onChange={(event) => setForm((prev) => ({ ...prev, end_at: event.target.value }))} />
            </label>
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "활동" : "Activity"}
                <select value={form.activity} onChange={(event) => setForm((prev) => ({ ...prev, activity: event.target.value }))}>
                  {activityOptions.map((item) => <option key={item} value={item}>{activityLabel(item, lang)}</option>)}
                </select>
              </label>
              <label>
                {lang === "ko" ? "세부 활동" : "Sub Activity"}
                <select value={form.sub_activity} onChange={(event) => setForm((prev) => ({ ...prev, sub_activity: event.target.value }))}>
                  {subOptions.map((item) => <option key={item} value={item}>{activityLabel(item, lang)}</option>)}
                </select>
              </label>
            </div>
            <label>
              Tags (comma)
              <input value={form.tags} onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))} />
            </label>
            <label>
              Notes
              <textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </label>
            <div className="modal-actions">
              <button
                className="primary-btn"
                onClick={async () => {
                  try {
                    const tags = form.tags.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
                    await updateSession(editing.event_id, {
                      start_at: form.start_at,
                      end_at: form.end_at,
                      activity: form.activity,
                      sub_activity: form.sub_activity,
                      notes: form.notes,
                      tags,
                    });
                    notify(lang === "ko" ? "세션 수정 완료" : "Session updated", "success");
                    setEditing(null);
                    await load();
                    await onRefresh();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : "Update failed", "error");
                  }
                }}
              >
                {lang === "ko" ? "저장" : "Save"}
              </button>
              <button className="ghost-btn" onClick={() => setEditing(null)}>{lang === "ko" ? "취소" : "Cancel"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
