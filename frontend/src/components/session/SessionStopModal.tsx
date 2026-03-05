import { useEffect, useMemo, useRef, useState } from "react";
import { discardSession, stopSession, uploadEvidenceFile } from "../../api";
import type { Lang } from "../../i18n";
import type { SessionStopInput, SessionStopResult } from "../../types/models";
import { formatDisplayXp } from "../../utils/xpDisplay";

type MainActivity = "Song" | "Drill" | "Etc";
type Mode = "single" | "range";
type EvidenceMode = "file" | "url" | "none";

const subMap: Record<MainActivity, Array<{ value: string; labelKo: string; labelEn: string; tag: string }>> = {
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

function toMain(raw: string): MainActivity {
  if (raw === "Song" || raw === "Drill" || raw === "Etc") return raw;
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
    activity?: string;
    sub_activity?: string;
    song_library_id?: string;
    drill_id?: string;
    notes?: string;
    start_at?: string;
  };
  testIdPrefix?: string;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSaved?: (result: SessionStopResult) => Promise<void> | void;
  onDiscarded?: () => Promise<void> | void;
};

export function SessionStopModal({
  open,
  lang,
  xpDisplayScale = 4000,
  songs,
  drills,
  activeSession,
  testIdPrefix = "session",
  notify,
  onClose,
  onSaved,
  onDiscarded,
}: SessionStopModalProps) {
  const [activity, setActivity] = useState<MainActivity>("Song");
  const [subActivity, setSubActivity] = useState("SongPractice");
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
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setShowDetails(false);
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const main = toMain(String(activeSession?.activity || "Song"));
    setActivity(main);
    setSubActivity(String(activeSession?.sub_activity || subMap[main][0]?.value || ""));
    setSongId(String(activeSession?.song_library_id || ""));
    setDrillId(String(activeSession?.drill_id || ""));
    setNotes(String(activeSession?.notes || ""));
    setEvidenceMode("file");
    setEvidenceUrl("");
    setFile(null);
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
  }, [open, activeSession]);

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

  if (!open) return null;

  const subOptions = subMap[activity];

  const buildPayload = (): SessionStopInput => {
    const subTag = subOptions.find((item) => item.value === subActivity)?.tag || "";
    const payload: SessionStopInput = {
      activity,
      sub_activity: subActivity,
      song_library_id: activity === "Song" ? songId : "",
      drill_id: activity === "Drill" ? drillId : "",
      tags: [activity.toUpperCase(), subTag].filter(Boolean),
      notes,
      start_at: toIsoIfValid(startAtInput),
      end_at: toIsoIfValid(endAtInput),
    };
    if (activity === "Song" && payload.song_library_id) {
      payload.song_speed =
        speedMode === "single"
          ? { mode: "single", single: songSpeedSingle }
          : { mode: "range", start: Math.min(songSpeedStart, songSpeedEnd), end: Math.max(songSpeedStart, songSpeedEnd) };
    }
    if (activity === "Drill" && payload.drill_id) {
      payload.drill_bpm =
        bpmMode === "single"
          ? { mode: "single", single: drillBpmSingle }
          : { mode: "range", start: Math.min(drillBpmStart, drillBpmEnd), end: Math.max(drillBpmStart, drillBpmEnd) };
    }
    return payload;
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

    try {
      setBusy(true);
      const payload = buildPayload();
      payload.start_at = start.toISOString();
      payload.end_at = end.toISOString();
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

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{lang === "ko" ? "종료하시겠습니까?" : "Finish session?"}</h3>

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

        <details open={showDetails} onToggle={(event) => setShowDetails((event.target as HTMLDetailsElement).open)}>
          <summary>{lang === "ko" ? "상세 입력(선택)" : "Detailed Input (Optional)"}</summary>

          <label>
            {lang === "ko" ? "활동" : "Activity"}
            <select
              value={activity}
              onChange={(event) => {
                const next = toMain(event.target.value);
                setActivity(next);
                setSubActivity(subMap[next][0]?.value || "");
                if (next !== "Song") setSongId("");
                if (next !== "Drill") setDrillId("");
              }}
            >
              <option value="Song">{lang === "ko" ? "곡" : "Song"}</option>
              <option value="Drill">{lang === "ko" ? "드릴" : "Drill"}</option>
              <option value="Etc">{lang === "ko" ? "기타" : "Etc"}</option>
            </select>
          </label>

          <label>
            {lang === "ko" ? "세부 활동" : "Sub Activity"}
            <select value={subActivity} onChange={(event) => setSubActivity(event.target.value)}>
              {subOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {lang === "ko" ? item.labelKo : item.labelEn}
                </option>
              ))}
            </select>
          </label>

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
                await discardSession();
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
      </div>
    </div>
  );
}
