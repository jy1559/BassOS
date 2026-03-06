import { useEffect, useMemo, useRef, useState } from "react";
import { discardSession, finalizeSession, stopSession, uploadEvidenceFile } from "../../api";
import type { Lang } from "../../i18n";
import type { ChainSavedSegment, SessionStopInput, SessionStopResult } from "../../types/models";
import { formatDisplayXp } from "../../utils/xpDisplay";

type MainActivity = "None" | "Song" | "Drill" | "Etc";
type Mode = "single" | "range";
type EvidenceMode = "file" | "url" | "none";

const subMap: Record<MainActivity, Array<{ value: string; labelKo: string; labelEn: string; tag: string }>> = {
  None: [{ value: "Etc", labelKo: "선택 없음", labelEn: "None", tag: "ETC" }],
  Song: [
    { value: "SongCopy", labelKo: "카피", labelEn: "Copy", tag: "SONG_COPY" },
    { value: "SongLearn", labelKo: "곡 익히기", labelEn: "Learn", tag: "SONG_LEARN" },
    { value: "SongPractice", labelKo: "곡 연습", labelEn: "Practice", tag: "SONG_PRACTICE" },
  ],
  Drill: [
    { value: "Core", labelKo: "기본기", labelEn: "Core", tag: "CORE" },
    { value: "Funk", labelKo: "펑크", labelEn: "Funk", tag: "FUNK" },
    { value: "Slap", labelKo: "슬랩", labelEn: "Slap", tag: "SLAP" },
    { value: "Theory", labelKo: "이론", labelEn: "Theory", tag: "THEORY" },
  ],
  Etc: [
    { value: "SongDiscovery", labelKo: "곡 찾기", labelEn: "Discovery", tag: "SONG_DISCOVERY" },
    { value: "Community", labelKo: "커뮤니티", labelEn: "Community", tag: "COMMUNITY" },
    { value: "Gear", labelKo: "장비", labelEn: "Gear", tag: "GEAR" },
    { value: "Etc", labelKo: "기타", labelEn: "Etc", tag: "ETC" },
  ],
};

const speedValues = Array.from({ length: 21 }).map((_, idx) => 50 + idx * 5);
const bpmValues = Array.from({ length: 37 }).map((_, idx) => 60 + idx * 5);

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function toMain(raw: string): MainActivity {
  if (raw === "None" || raw === "Song" || raw === "Drill" || raw === "Etc") return raw;
  return "Song";
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

export type SessionStopModalProps = {
  open: boolean;
  lang: Lang;
  xpDisplayScale?: number;
  songs: Array<Record<string, string>>;
  drills: Array<Record<string, string>>;
  activeSession?: {
    session_id?: string;
    activity?: string;
    sub_activity?: string;
    song_library_id?: string;
    drill_id?: string;
    title?: string;
    notes?: string;
    start_at?: string;
    chain_saved_segments?: ChainSavedSegment[];
    chain_saved_count?: number;
    chain_under_min_count?: number;
  };
  testIdPrefix?: string;
  forceShowEditor?: boolean;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSaved?: (result: SessionStopResult) => Promise<void> | void;
  onDiscarded?: () => Promise<void> | void;
};

export function SessionStopModal({
  open,
  lang,
  xpDisplayScale = 50,
  songs,
  drills,
  activeSession,
  testIdPrefix = "session",
  forceShowEditor = false,
  notify,
  onClose,
  onSaved,
  onDiscarded,
}: SessionStopModalProps) {
  const [activity, setActivity] = useState<MainActivity>("None");
  const [subActivity, setSubActivity] = useState("Etc");
  const [songId, setSongId] = useState("");
  const [drillId, setDrillId] = useState("");
  const [notes, setNotes] = useState("");
  const [evidenceMode, setEvidenceMode] = useState<EvidenceMode>("file");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [speedMode, setSpeedMode] = useState<Mode>("single");
  const [songSpeedSingle, setSongSpeedSingle] = useState(100);
  const [songSpeedStart, setSongSpeedStart] = useState(80);
  const [songSpeedEnd, setSongSpeedEnd] = useState(100);
  const [bpmMode, setBpmMode] = useState<Mode>("single");
  const [drillBpmSingle, setDrillBpmSingle] = useState(100);
  const [drillBpmStart, setDrillBpmStart] = useState(90);
  const [drillBpmEnd, setDrillBpmEnd] = useState(120);
  const [startAtInput, setStartAtInput] = useState("");
  const [endAtInput, setEndAtInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [includeSavedMap, setIncludeSavedMap] = useState<Record<string, boolean>>({});
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const [showUnderMinGate, setShowUnderMinGate] = useState(false);
  const [showUnderMinAlert, setShowUnderMinAlert] = useState(false);
  const wasOpenRef = useRef(false);

  const chainSavedSegments = useMemo(() => {
    const raw = activeSession?.chain_saved_segments;
    if (!Array.isArray(raw)) return [] as ChainSavedSegment[];
    return raw.filter((item): item is ChainSavedSegment => Boolean(item && item.event_id));
  }, [activeSession?.chain_saved_segments]);

  const chainUnderMinCount = Math.max(0, Number(activeSession?.chain_under_min_count || 0));

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setShowDetails(false);
      setShowUnderMinGate(false);
      setShowUnderMinAlert(false);
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const hasTarget = Boolean(
      String(activeSession?.song_library_id || "").trim() || String(activeSession?.drill_id || "").trim()
    );
    const sessionMain = toMain(String(activeSession?.activity || "Song"));
    const main: MainActivity = hasTarget ? sessionMain : "None";
    setActivity(main);
    setSubActivity(main === "None" ? "Etc" : String(activeSession?.sub_activity || subMap[main][0]?.value || ""));
    setSongId(String(activeSession?.song_library_id || ""));
    setDrillId(String(activeSession?.drill_id || ""));
    setNotes(String(activeSession?.notes || ""));
    setEvidenceMode("file");
    setEvidenceUrl("");
    setFile(null);
    setIncludeCurrent(true);
    setIncludeSavedMap(() => {
      const next: Record<string, boolean> = {};
      const rawSegments = Array.isArray(activeSession?.chain_saved_segments) ? activeSession.chain_saved_segments : [];
      rawSegments.forEach((item) => {
        const eventId = String(item?.event_id || "").trim();
        if (!eventId) return;
        next[eventId] = true;
      });
      return next;
    });
    const now = new Date();
    const startValue = toDatetimeLocalInput(activeSession?.start_at, new Date(now.getTime() - 10 * 60 * 1000));
    const startDate = new Date(startValue);
    let endDate = now;
    if (!Number.isNaN(startDate.getTime())) {
      const minEnd = new Date(startDate.getTime() + 60 * 1000);
      if (endDate.getTime() < minEnd.getTime()) endDate = minEnd;
    }
    setStartAtInput(startValue);
    setEndAtInput(toDatetimeLocalInput(undefined, endDate));
    const activeStart = new Date(String(activeSession?.start_at || ""));
    const activeElapsedMin = Number.isNaN(activeStart.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - activeStart.getTime()) / 60000));
    setShowUnderMinGate(!forceShowEditor && activeElapsedMin < 10);
    setShowUnderMinAlert(false);
  }, [open, activeSession, forceShowEditor]);

  const sortedSongs = useMemo(
    () =>
      [...songs].sort((a, b) => String(a.title || a.library_id || "").localeCompare(String(b.title || b.library_id || ""))),
    [songs]
  );
  const sortedDrills = useMemo(
    () =>
      [...drills].sort((a, b) => String(a.name || a.drill_id || "").localeCompare(String(b.name || b.drill_id || ""))),
    [drills]
  );

  const subOptions = subMap[activity];

  const currentDurationMin = useMemo(() => {
    const start = new Date(startAtInput);
    const end = new Date(endAtInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  }, [startAtInput, endAtInput]);

  const segmentLabel = (item: {
    song_library_id?: string;
    drill_id?: string;
    title?: string;
    activity?: string;
    sub_activity?: string;
  }): string => {
    if (item.song_library_id) {
      const song = songs.find((row) => row.library_id === item.song_library_id);
      return song?.title || item.title || item.song_library_id;
    }
    if (item.drill_id) {
      const drill = drills.find((row) => row.drill_id === item.drill_id);
      return drill?.name || item.title || item.drill_id;
    }
    return item.title || `${item.activity || "Session"}${item.sub_activity ? `/${item.sub_activity}` : ""}`;
  };

  const buildPayload = (): SessionStopInput => {
    const subTag = subOptions.find((item) => item.value === subActivity)?.tag || "";
    const mappedActivity: "Song" | "Drill" | "Etc" = activity === "None" ? "Etc" : activity;
    const mappedSubActivity = activity === "None" ? "Etc" : subActivity;
    const payload: SessionStopInput = {
      activity: mappedActivity,
      sub_activity: mappedSubActivity,
      song_library_id: mappedActivity === "Song" ? songId : "",
      drill_id: mappedActivity === "Drill" ? drillId : "",
      tags: [mappedActivity.toUpperCase(), subTag].filter(Boolean),
      notes,
      start_at: toIsoIfValid(startAtInput),
      end_at: toIsoIfValid(endAtInput),
    };
    if (mappedActivity === "Song" && payload.song_library_id) {
      payload.song_speed =
        speedMode === "single"
          ? { mode: "single", single: songSpeedSingle }
          : { mode: "range", start: Math.min(songSpeedStart, songSpeedEnd), end: Math.max(songSpeedStart, songSpeedEnd) };
    }
    if (mappedActivity === "Drill" && payload.drill_id) {
      payload.drill_bpm =
        bpmMode === "single"
          ? { mode: "single", single: drillBpmSingle }
          : { mode: "range", start: Math.min(drillBpmStart, drillBpmEnd), end: Math.max(drillBpmStart, drillBpmEnd) };
    }
    return payload;
  };

  const endWithoutSavingCurrent = async () => {
    try {
      setBusy(true);
      const hasChainSavedSegments = chainSavedSegments.length > 0;
      if (hasChainSavedSegments) {
        const includeSavedEventIds = chainSavedSegments
          .filter((item) => includeSavedMap[item.event_id] !== false)
          .map((item) => item.event_id);
        const result = await finalizeSession({
          include_saved_event_ids: includeSavedEventIds,
          include_current: false,
        });
        const totalXp = Number(result.summary?.total_xp || 0);
        notify(
          `${lang === "ko" ? "세션 저장 완료" : "Session saved"} (+${formatDisplayXp(totalXp, xpDisplayScale)} XP)`,
          "success"
        );
        await onSaved?.(result);
      } else {
        await discardSession();
        notify(lang === "ko" ? "저장하지 않고 종료했습니다." : "Session ended without saving.", "info");
        await onDiscarded?.();
      }
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Discard failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveAndStop = async () => {
    const start = new Date(startAtInput);
    let end = new Date(endAtInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      notify(lang === "ko" ? "시작/종료 시간을 확인해주세요." : "Please check start/end time.", "error");
      return;
    }
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 1000);
      setEndAtInput(toDatetimeLocalInput(undefined, end));
    }
    const durationMin = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));

    try {
      setBusy(true);
      const payload = buildPayload();
      payload.start_at = start.toISOString();
      payload.end_at = end.toISOString();

      const hasChainSavedSegments = chainSavedSegments.length > 0;
      const includeCurrentFinal = hasChainSavedSegments ? includeCurrent : true;
      if (includeCurrentFinal && durationMin < 10) {
        setShowUnderMinAlert(true);
        return;
      }

      if (hasChainSavedSegments) {
        const includeSavedEventIds = chainSavedSegments
          .filter((item) => includeSavedMap[item.event_id] !== false)
          .map((item) => item.event_id);

        if (includeCurrentFinal) {
          if (evidenceMode === "file" && file) {
            const mediaType = file.type.startsWith("video") ? "video" : "audio";
            const uploaded = await uploadEvidenceFile(file, mediaType);
            payload.evidence_path = uploaded.path;
            payload.evidence_type = "file";
          } else if (evidenceMode === "url" && evidenceUrl.trim()) {
            payload.evidence_type = "url";
            payload.evidence_url = evidenceUrl.trim();
          } else {
            payload.evidence_type = undefined;
            payload.evidence_url = "";
          }
        }

        const result = await finalizeSession({
          include_saved_event_ids: includeSavedEventIds,
          include_current: includeCurrentFinal,
          current_stop_payload: includeCurrentFinal ? payload : undefined,
        });
        const totalXp = Number(result.summary?.total_xp || 0);
        notify(
          `${lang === "ko" ? "세션 저장 완료" : "Session saved"} (+${formatDisplayXp(totalXp, xpDisplayScale)} XP)`,
          "success"
        );
        await onSaved?.(result);
        onClose();
        return;
      }

      if (evidenceMode === "file" && file) {
        const mediaType = file.type.startsWith("video") ? "video" : "audio";
        const uploaded = await uploadEvidenceFile(file, mediaType);
        payload.evidence_path = uploaded.path;
        payload.evidence_type = "file";
      } else if (evidenceMode === "url" && evidenceUrl.trim()) {
        payload.evidence_type = "url";
        payload.evidence_url = evidenceUrl.trim();
      } else {
        payload.evidence_type = undefined;
        payload.evidence_url = "";
      }

      const result = await stopSession(payload);
      notify(
        `${lang === "ko" ? "세션 저장 완료" : "Session saved"} (+${formatDisplayXp(result.xp_breakdown.total_xp, xpDisplayScale)} XP)`,
        "success"
      );
      await onSaved?.(result);
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;
      if (showUnderMinAlert) {
        if (event.key === "Escape" || event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          if (isEditableTarget(event.target)) return;
          event.preventDefault();
          setShowUnderMinAlert(false);
        }
        return;
      }
      if (showUnderMinGate) {
        if (event.key === "Escape" || event.key === " " || event.key === "Spacebar") {
          if (isEditableTarget(event.target)) return;
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          if (isEditableTarget(event.target)) return;
          event.preventDefault();
          void endWithoutSavingCurrent();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      const isSaveKey =
        (event.key === "Enter" && !event.shiftKey) || event.key === " " || event.key === "Spacebar";
      if (isSaveKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        void saveAndStop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, endWithoutSavingCurrent, onClose, open, saveAndStop, showUnderMinAlert, showUnderMinGate]);

  if (!open) return null;

  return (
    <>
      <div className="modal-backdrop">
        <div className="modal">
          <h3>{lang === "ko" ? "종료하시겠습니까?" : "Finish session?"}</h3>
          {showUnderMinGate ? (
            <small className="muted">
              {lang === "ko" ? "Enter 저장하지 않고 종료 · Esc/Space 닫기" : "Enter ends without save · Esc/Space closes"}
            </small>
          ) : (
            <small className="muted">
              {lang === "ko" ? "Enter/Space 저장 · Esc 닫기" : "Enter/Space to save · Esc to close"}
            </small>
          )}

          {showUnderMinGate ? (
            <>
              <p>{lang === "ko" ? "10분 미만의 세션은 저장되지 않습니다. 종료하시겠습니까?" : "Sessions under 10 minutes are not saved. End this session?"}</p>
              <div className="modal-actions">
                <button type="button" className="danger-btn" onClick={() => void endWithoutSavingCurrent()} disabled={busy}>
                  {lang === "ko" ? "저장하지 않고 종료" : "End Without Save"}
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    setShowUnderMinGate(false);
                    setShowDetails(true);
                  }}
                  disabled={busy}
                >
                  {lang === "ko" ? "시간 지정" : "Set Time"}
                </button>
                <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
                  {lang === "ko" ? "닫기" : "Close"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="song-form-grid">
          <label>
            {lang === "ko" ? "시작 시각" : "Start Time"}
            <input
              type="datetime-local"
              value={startAtInput}
              onChange={(event) => setStartAtInput(event.target.value)}
              data-testid={`${testIdPrefix}-stop-start-at`}
            />
          </label>
          <label>
            {lang === "ko" ? "종료 시각" : "End Time"}
            <input
              type="datetime-local"
              value={endAtInput}
              onChange={(event) => setEndAtInput(event.target.value)}
              data-testid={`${testIdPrefix}-stop-end-at`}
            />
          </label>
        </div>

        {chainSavedSegments.length > 0 ? (
          <div className="session-chain-finalize-block">
            <strong>{lang === "ko" ? "세션별 저장" : "Per-session save"}</strong>
            {chainUnderMinCount > 0 ? (
              <small className="muted">
                {lang === "ko" ? "10분 미만 진행된 곡은 저장되지 않습니다." : "Segments under 10 minutes are not saved."}
              </small>
            ) : null}
            <div className="session-chain-finalize-list">
              {chainSavedSegments.map((item) => {
                const included = includeSavedMap[item.event_id] !== false;
                return (
                  <div key={item.event_id} className={`session-chain-finalize-row ${included ? "" : "excluded"}`}>
                    <span>
                      <strong>{segmentLabel(item)}</strong>
                      <small className="muted">
                        {Math.max(0, Number(item.duration_min || 0))}m · +{formatDisplayXp(Math.max(0, Number(item.xp || 0)), xpDisplayScale)} XP
                      </small>
                    </span>
                    <button
                      type="button"
                      className={`ghost-btn compact-add-btn ${included ? "active-mini" : "danger-border"}`}
                      onClick={() => setIncludeSavedMap((prev) => ({ ...prev, [item.event_id]: !included }))}
                    >
                      {included ? (lang === "ko" ? "저장" : "Keep") : (lang === "ko" ? "제외" : "Exclude")}
                    </button>
                  </div>
                );
              })}
              <div className={`session-chain-finalize-row ${includeCurrent ? "" : "excluded"}`}>
                <span>
                  <strong>{lang === "ko" ? "현재 세션" : "Current session"}</strong>
                  <small className="muted">
                    {segmentLabel({
                      song_library_id: activeSession?.song_library_id,
                      drill_id: activeSession?.drill_id,
                      title: activeSession?.title || "",
                      activity: activeSession?.activity,
                      sub_activity: activeSession?.sub_activity,
                    })}{" "}
                    · {Math.max(0, currentDurationMin)}m
                  </small>
                </span>
                <button
                  type="button"
                  className={`ghost-btn compact-add-btn ${includeCurrent ? "active-mini" : "danger-border"}`}
                  onClick={() => setIncludeCurrent((prev) => !prev)}
                >
                  {includeCurrent ? (lang === "ko" ? "저장" : "Keep") : (lang === "ko" ? "제외" : "Exclude")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <details open={showDetails} onToggle={(event) => setShowDetails((event.target as HTMLDetailsElement).open)}>
          <summary data-testid={`${testIdPrefix}-stop-detail-toggle`}>{lang === "ko" ? "상세 입력(선택)" : "Detailed Input (Optional)"}</summary>

          <label>
            {lang === "ko" ? "활동" : "Activity"}
            <select
              value={activity}
              data-testid={`${testIdPrefix}-stop-activity`}
              onChange={(event) => {
                const next = toMain(event.target.value);
                setActivity(next);
                setSubActivity(subMap[next][0]?.value || "");
                if (next !== "Song") setSongId("");
                if (next !== "Drill") setDrillId("");
              }}
            >
              <option value="None">{lang === "ko" ? "선택 없음" : "None"}</option>
              <option value="Song">{lang === "ko" ? "곡" : "Song"}</option>
              <option value="Drill">{lang === "ko" ? "드릴" : "Drill"}</option>
              <option value="Etc">{lang === "ko" ? "기타" : "Etc"}</option>
            </select>
          </label>

          {activity !== "None" ? (
            <label>
              {lang === "ko" ? "세부 활동" : "Sub Activity"}
              <select
                value={subActivity}
                data-testid={`${testIdPrefix}-stop-sub-activity`}
                onChange={(event) => setSubActivity(event.target.value)}
              >
                {subOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {lang === "ko" ? item.labelKo : item.labelEn}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {activity === "Song" ? (
            <label>
              Song
              <select value={songId} onChange={(event) => setSongId(event.target.value)}>
                <option value="">(None)</option>
                {sortedSongs.map((item) => (
                  <option key={item.library_id} value={item.library_id}>
                    {item.title || item.library_id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {activity === "Drill" ? (
            <label>
              Drill
              <select value={drillId} onChange={(event) => setDrillId(event.target.value)}>
                <option value="">(None)</option>
                {sortedDrills.map((item) => (
                  <option key={item.drill_id} value={item.drill_id}>
                    {item.name || item.drill_id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {activity === "Song" && songId ? (
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "곡 속도 모드" : "Song Speed Mode"}
                <select value={speedMode} onChange={(event) => setSpeedMode(event.target.value as Mode)}>
                  <option value="single">{lang === "ko" ? "단일" : "Single"}</option>
                  <option value="range">{lang === "ko" ? "범위" : "Range"}</option>
                </select>
              </label>
              {speedMode === "single" ? (
                <label>
                  {lang === "ko" ? "속도" : "Speed"}
                  <select value={songSpeedSingle} onChange={(event) => setSongSpeedSingle(Number(event.target.value))}>
                    {speedValues.map((value) => (
                      <option key={value} value={value}>
                        {value}%
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Start
                    <select value={songSpeedStart} onChange={(event) => setSongSpeedStart(Number(event.target.value))}>
                      {speedValues.map((value) => (
                        <option key={value} value={value}>
                          {value}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    End
                    <select value={songSpeedEnd} onChange={(event) => setSongSpeedEnd(Number(event.target.value))}>
                      {speedValues.map((value) => (
                        <option key={value} value={value}>
                          {value}%
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          ) : null}

          {activity === "Drill" && drillId ? (
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "드릴 BPM 모드" : "Drill BPM Mode"}
                <select value={bpmMode} onChange={(event) => setBpmMode(event.target.value as Mode)}>
                  <option value="single">{lang === "ko" ? "단일" : "Single"}</option>
                  <option value="range">{lang === "ko" ? "범위" : "Range"}</option>
                </select>
              </label>
              {bpmMode === "single" ? (
                <label>
                  BPM
                  <select value={drillBpmSingle} onChange={(event) => setDrillBpmSingle(Number(event.target.value))}>
                    {bpmValues.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Start
                    <select value={drillBpmStart} onChange={(event) => setDrillBpmStart(Number(event.target.value))}>
                      {bpmValues.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    End
                    <select value={drillBpmEnd} onChange={(event) => setDrillBpmEnd(Number(event.target.value))}>
                      {bpmValues.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          ) : null}

          <label>
            {lang === "ko" ? "증빙" : "Evidence"}
            <select value={evidenceMode} onChange={(event) => setEvidenceMode(event.target.value as EvidenceMode)}>
              <option value="file">{lang === "ko" ? "첨부파일" : "Attachment"}</option>
              <option value="url">URL</option>
              <option value="none">{lang === "ko" ? "없음" : "None"}</option>
            </select>
          </label>

          {evidenceMode === "file" ? (
            <label>
              {lang === "ko" ? "첨부 파일" : "Attachment"}
              <input type="file" accept="audio/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
          ) : null}

          {evidenceMode === "url" ? (
            <label>
              Evidence URL
              <input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} />
            </label>
          ) : null}

          <label>
            Note
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </details>

        <div className="modal-actions">
          <button type="button" className="primary-btn" data-testid={`${testIdPrefix}-stop-save`} disabled={busy} onClick={() => void saveAndStop()}>
            {lang === "ko" ? "저장 후 종료" : "Save & End"}
          </button>
          <button
            type="button"
            className="ghost-btn danger-border"
            data-testid={`${testIdPrefix}-stop-discard`}
            disabled={busy}
            onClick={async () => {
              try {
                setBusy(true);
                await discardSession({ chain_mode: chainSavedSegments.length > 0 ? "all" : "last" });
                notify(lang === "ko" ? "저장하지 않고 종료했습니다." : "Session ended without saving.", "info");
                await onDiscarded?.();
                onClose();
              } catch (error) {
                notify(error instanceof Error ? error.message : "Discard failed", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {lang === "ko" ? "저장하지 않고 종료" : "End Without Save"}
          </button>
          <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
            {lang === "ko" ? "닫기" : "Close"}
          </button>
        </div>
            </>
          )}
        </div>
      </div>
      {showUnderMinAlert ? (
        <div className="modal-backdrop mini-alert-backdrop" onClick={() => setShowUnderMinAlert(false)}>
          <div className="modal mini-alert-modal" onClick={(event) => event.stopPropagation()}>
            <p>{lang === "ko" ? "10분 미만의 세션은 저장되지 않습니다." : "Sessions under 10 minutes are not saved."}</p>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setShowUnderMinAlert(false)}>
                {lang === "ko" ? "확인" : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
