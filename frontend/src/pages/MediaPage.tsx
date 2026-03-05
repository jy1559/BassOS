import { useMemo, useState } from "react";
import { uploadByPath } from "../api";
import type { Lang } from "../i18n";

type Props = {
  lang: Lang;
  items: Array<Record<string, unknown>>;
  unlockables: Array<Record<string, unknown>>;
  onRefresh: () => Promise<void>;
  setMessage: (message: string) => void;
};

function toYouTubeEmbed(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host.endsWith("youtube.com")) {
      const vid = u.searchParams.get("v");
      if (vid) return `https://www.youtube.com/embed/${vid}`;
      const pathParts = u.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "shorts" && pathParts[1]) return `https://www.youtube.com/embed/${pathParts[1]}`;
      if (pathParts[0] === "embed" && pathParts[1]) return `https://www.youtube.com/embed/${pathParts[1]}`;
    }
    return "";
  } catch {
    return "";
  }
}

function inferMedia(url: string): "video" | "audio" | "none" {
  if (!url) return "none";
  const lower = url.toLowerCase();
  if (/(\.mp4|\.webm|\.mov|\.mkv)(\?|$)/.test(lower)) return "video";
  if (/(\.mp3|\.wav|\.ogg|\.m4a|\.flac)(\?|$)/.test(lower)) return "audio";
  return "none";
}

function hasUnlock(unlockables: Array<Record<string, unknown>>, keyword: string): boolean {
  return unlockables.some((item) => String(item.name).includes(keyword) && Boolean(item.unlocked));
}

export function MediaPage({ lang, items, unlockables, onRefresh, setMessage }: Props) {
  const [referenceUrl, setReferenceUrl] = useState("");
  const [takeUrl, setTakeUrl] = useState("");
  const [showCompare, setShowCompare] = useState(false);

  const compareUnlocked = hasUnlock(unlockables, "A/B") || hasUnlock(unlockables, "비교") || true;
  const referenceEmbed = toYouTubeEmbed(referenceUrl);
  const takeEmbed = toYouTubeEmbed(takeUrl);
  const referenceType = inferMedia(referenceUrl);
  const takeType = inferMedia(takeUrl);
  const mediaItems = useMemo(() => items.slice(0, 80), [items]);

  return (
    <div className="page-grid media-grid">
      <section className="card">
        <h2>{lang === "ko" ? "미디어 기록 업로드" : "Media Evidence"}</h2>
        <div className="row">
          <button
            className="primary-btn"
            onClick={async () => {
              const sourcePath = window.prompt(lang === "ko" ? "오디오 파일 경로" : "Audio file path");
              if (!sourcePath) return;
              await uploadByPath(sourcePath, "audio");
              setMessage(lang === "ko" ? "오디오 업로드 완료" : "Audio uploaded");
              await onRefresh();
            }}
          >
            Add Audio by Path
          </button>
          <button
            className="ghost-btn"
            onClick={async () => {
              const sourcePath = window.prompt(lang === "ko" ? "영상 파일 경로" : "Video file path");
              if (!sourcePath) return;
              await uploadByPath(sourcePath, "video");
              setMessage(lang === "ko" ? "영상 업로드 완료" : "Video uploaded");
              await onRefresh();
            }}
          >
            Add Video by Path
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2>{lang === "ko" ? "레퍼런스 플레이어" : "Reference Player"}</h2>
          <label className="inline">
            <input
              type="checkbox"
              checked={showCompare}
              disabled={!compareUnlocked}
              onChange={(event) => setShowCompare(event.target.checked)}
            />
            {lang === "ko" ? "비교 모드" : "Compare mode"}
          </label>
        </div>

        <div className="song-form-grid">
          <label>
            {lang === "ko" ? "레퍼런스 URL (YouTube/영상/음성)" : "Reference URL"}
            <input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} />
          </label>
          {showCompare ? (
            <label>
              {lang === "ko" ? "내 테이크 URL" : "My Take URL"}
              <input value={takeUrl} onChange={(event) => setTakeUrl(event.target.value)} />
            </label>
          ) : null}
        </div>

        <div className={`ab-grid ${showCompare ? "" : "single"}`}>
          <div className="media-frame">
            {referenceEmbed ? (
              <iframe
                title="reference-player"
                className="studio-video"
                src={referenceEmbed}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : referenceType === "video" ? (
              <video className="studio-video" src={referenceUrl} controls />
            ) : referenceType === "audio" ? (
              <audio src={referenceUrl} controls />
            ) : (
              <div className="muted">
                {lang === "ko" ? "URL을 넣으면 플레이어가 표시됩니다." : "Paste a URL to preview."}
              </div>
            )}
          </div>

          {showCompare ? (
            <div className="media-frame">
              {takeEmbed ? (
                <iframe
                  title="take-player"
                  className="studio-video"
                  src={takeEmbed}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : takeType === "video" ? (
                <video className="studio-video" src={takeUrl} controls />
              ) : takeType === "audio" ? (
                <audio src={takeUrl} controls />
              ) : (
                <div className="muted">
                  {lang === "ko" ? "비교용 URL을 넣으세요." : "Paste comparison URL."}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {mediaItems.map((item) => (
        <article key={String(item.event_id)} className="card media-card">
          <h3>{String(item.title ?? "Media")}</h3>
          <small>{String(item.created_at ?? "")}</small>
          {item.evidence_url ? (
            <a href={String(item.evidence_url)} target="_blank" rel="noreferrer">
              Open URL
            </a>
          ) : item.evidence_path ? (
            <a href={`/media/${String(item.evidence_path)}`} target="_blank" rel="noreferrer">
              Open Local
            </a>
          ) : (
            <span>No source</span>
          )}
        </article>
      ))}
    </div>
  );
}
