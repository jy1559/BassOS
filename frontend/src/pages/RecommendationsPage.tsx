import { useEffect, useMemo, useState } from "react";
import { createSong } from "../api";
import { buildGenreGroups, collectGenrePool, normalizeGenre, parseGenreTokens } from "../genreCatalog";
import type { Lang } from "../i18n";
import type { Settings } from "../types/models";

type Props = {
  lang: Lang;
  ladder: Array<Record<string, string>>;
  library: Array<Record<string, string>>;
  settings: Settings;
  onRefresh: () => Promise<void>;
  onOpenLibrary: () => void;
  setMessage: (message: string) => void;
};

type RowState = "active" | "archived" | "imported";
type ViewFilter = "active" | "archived" | "imported" | "all";

type RecommendationRow = {
  key: string;
  songId: string;
  title: string;
  artist: string;
  difficulty: string;
  genres: string[];
  moods: string[];
  techniques: string[];
  description: string;
  status: string;
  youtubeUrl: string;
  state: RowState;
  inLibrary: boolean;
};

const LS_KEY = "bassos_recommendation_state_v2";

function splitTags(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[;|,]/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function readField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function normalizeDifficulty(raw: string): string {
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "").replace(/^Lv(\d)/i, "Lv.$1");
  return compact;
}

function makeKey(songId: string, title: string, artist: string): string {
  if (songId) return songId;
  return `${title.toLowerCase()}::${artist.toLowerCase()}`;
}

function loadStateMap(): Record<string, RowState> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const clean: Record<string, RowState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "active" || value === "archived" || value === "imported") {
        clean[key] = value;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function saveStateMap(value: Record<string, RowState>): void {
  window.localStorage.setItem(LS_KEY, JSON.stringify(value));
}

export function RecommendationsPage({ lang, ladder, library, settings, onRefresh, onOpenLibrary, setMessage }: Props) {
  const [stateMap, setStateMap] = useState<Record<string, RowState>>({});
  const [view, setView] = useState<ViewFilter>("active");
  const [difficulty, setDifficulty] = useState("all");
  const [genre, setGenre] = useState("all");
  const [mood, setMood] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setStateMap(loadStateMap());
  }, []);

  const enriched = useMemo<RecommendationRow[]>(() => {
    const librarySongIds = new Set<string>();
    const libraryTitleKeys = new Set<string>();
    for (const item of library) {
      const songId = String(item.song_id || "").trim();
      if (songId) librarySongIds.add(songId);
      const title = String(item.title || "").trim();
      const artist = String(item.artist || "").trim();
      libraryTitleKeys.add(makeKey("", title, artist));
    }

    return ladder.map((row) => {
      const songId = readField(row, ["song_id", "ID", "id"]);
      const title = readField(row, ["title", "곡", "song", "name"]);
      const artist = readField(row, ["artist", "아티스트"]);
      const key = makeKey(songId, title, artist);

      const inLibrary =
        (songId && librarySongIds.has(songId)) ||
        libraryTitleKeys.has(makeKey("", title, artist));

      const state: RowState = inLibrary
        ? "imported"
        : stateMap[key] === "archived"
        ? "archived"
        : "active";

      const difficultyValue = normalizeDifficulty(readField(row, ["difficulty", "예상 난이도"]));
      const genres = parseGenreTokens(readField(row, ["genre", "장르", "style_tags"]));
      const moods = splitTags(readField(row, ["mood", "분위기 유형", "mood_tags"]));
      const techniques = splitTags(readField(row, ["skill_tags", "핵심 테크닉 태그", "techniques"]));
      const description = readField(row, ["description", "설명 feature", "notes"]);
      const status = readField(row, ["status", "상태"]) || (lang === "ko" ? "추천" : "Recommended");
      const youtubeUrl = readField(row, ["youtube_url", "유튜브", "reference_url", "url"]);

      return {
        key,
        songId,
        title,
        artist,
        difficulty: difficultyValue,
        genres,
        moods,
        techniques,
        description,
        status,
        youtubeUrl,
        state,
        inLibrary,
      };
    });
  }, [ladder, library, stateMap, lang]);

  const setRowState = (key: string, next: RowState) => {
    setStateMap((prev) => {
      const merged = { ...prev, [key]: next };
      saveStateMap(merged);
      return merged;
    });
  };

  const difficulties = useMemo(
    () => ["all", ...Array.from(new Set(enriched.map((item) => item.difficulty).filter(Boolean))).sort()],
    [enriched]
  );
  const genrePool = useMemo(() => {
    const userGenres = Array.isArray(settings.ui.song_genres) ? settings.ui.song_genres.map((item) => String(item || "")) : [];
    const ladderGenres = ladder.map((row) => String(row.genre || row["장르"] || ""));
    const libraryGenres = library.map((row) => String(row.genre || ""));
    return collectGenrePool([...userGenres, ...ladderGenres, ...libraryGenres]);
  }, [settings.ui.song_genres, ladder, library]);

  const genres = useMemo(() => ["all", ...genrePool], [genrePool]);
  const genreGroups = useMemo(() => buildGenreGroups(genrePool), [genrePool]);
  const moods = useMemo(
    () => ["all", ...Array.from(new Set(enriched.flatMap((item) => item.moods))).sort()],
    [enriched]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
      .filter((item) => (view === "all" ? true : item.state === view))
      .filter((item) => (difficulty === "all" ? true : item.difficulty === difficulty))
      .filter((item) => (genre === "all" ? true : item.genres.includes(genre)))
      .filter((item) => (mood === "all" ? true : item.moods.includes(mood)))
      .filter((item) => {
        if (!q) return true;
        const text = `${item.songId} ${item.title} ${item.artist} ${item.genres.join(" ")} ${item.moods.join(" ")} ${item.techniques.join(" ")}`.toLowerCase();
        return text.includes(q);
      })
      .sort((a, b) => {
        const aLv = Number((a.difficulty || "").replace(/[^\d]/g, "") || 999);
        const bLv = Number((b.difficulty || "").replace(/[^\d]/g, "") || 999);
        if (aLv !== bLv) return aLv - bLv;
        return a.title.localeCompare(b.title);
      });
  }, [enriched, view, difficulty, genre, mood, query]);

  return (
    <div className="page-grid songs-page-list">
      <section className="card" data-testid="tutorial-recommend-main">
        <div className="row compact-toolbar">
          <h2>{lang === "ko" ? "추천곡" : "Recommended Songs"}</h2>
          <small className="muted">{filtered.length}</small>
        </div>

        <div className="song-control-grid">
          <label>
            {lang === "ko" ? "보기" : "View"}
            <select value={view} onChange={(event) => setView(event.target.value as ViewFilter)}>
              <option value="active">{lang === "ko" ? "추천 목록" : "Active"}</option>
              <option value="archived">{lang === "ko" ? "숨김 목록" : "Hidden"}</option>
              <option value="imported">{lang === "ko" ? "라이브러리로 이동" : "Imported"}</option>
              <option value="all">{lang === "ko" ? "전체" : "All"}</option>
            </select>
          </label>

          <label>
            {lang === "ko" ? "난이도" : "Difficulty"}
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              {difficulties.map((item) => (
                <option key={item} value={item}>{item === "all" ? (lang === "ko" ? "전체" : "All") : item}</option>
              ))}
            </select>
          </label>

          <label>
            {lang === "ko" ? "장르" : "Genre"}
            <select value={genre} onChange={(event) => setGenre(event.target.value)}>
              <option value="all">{lang === "ko" ? "전체" : "All"}</option>
              {genreGroups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.values.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label>
            {lang === "ko" ? "분위기" : "Mood"}
            <select value={mood} onChange={(event) => setMood(event.target.value)}>
              {moods.map((item) => (
                <option key={item} value={item}>{item === "all" ? (lang === "ko" ? "전체" : "All") : item}</option>
              ))}
            </select>
          </label>

          <label>
            {lang === "ko" ? "검색" : "Search"}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={lang === "ko" ? "곡/아티스트/장르/분위기" : "song / artist / genre / mood"}
            />
          </label>
        </div>

        <div className="table-wrap">
          <table className="session-table clean-wrap recommend-table">
            <colgroup>
              <col style={{ width: "44%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>{lang === "ko" ? "곡" : "Song"}</th>
                <th>{lang === "ko" ? "난이도" : "Difficulty"}</th>
                <th>{lang === "ko" ? "장르/분위기" : "Genre / Mood"}</th>
                <th>{lang === "ko" ? "상태" : "State"}</th>
                <th>{lang === "ko" ? "관리" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.key}>
                  <td>
                    <strong>{item.title || "-"}</strong>
                    <div className="muted song-meta-line">{item.artist || "-"}</div>
                    <div className="song-genre-chips recommend-tech-chips">
                      {item.techniques.slice(0, 2).map((tag) => (
                        <span key={`${item.key}-tech-${tag}`} className="achievement-chip">{tag}</span>
                      ))}
                    </div>
                    {item.description ? <small className="muted recommend-desc">{item.description}</small> : null}
                  </td>
                  <td>{item.difficulty || "-"}</td>
                  <td>
                    <div className="song-genre-chips">
                      {item.genres.map((g) => (
                        <span key={`${item.key}-g-${g}`} className="achievement-chip">{g}</span>
                      ))}
                      {item.moods.map((m) => (
                        <span key={`${item.key}-m-${m}`} className="achievement-chip">{m}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`rank-badge ${item.state === "imported" ? "gold" : item.state === "archived" ? "bronze" : "silver"}`}>
                      {item.state === "active"
                        ? (lang === "ko" ? "추천" : "Active")
                        : item.state === "archived"
                        ? (lang === "ko" ? "숨김" : "Hidden")
                        : (lang === "ko" ? "라이브러리 반영" : "Imported")}
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      {item.state === "archived" ? (
                        <button className="ghost-btn" onClick={() => setRowState(item.key, "active")}>
                          {lang === "ko" ? "복원" : "Restore"}
                        </button>
                      ) : (
                        <button className="ghost-btn" onClick={() => setRowState(item.key, "archived")}>
                          {lang === "ko" ? "숨기기" : "Hide"}
                        </button>
                      )}

                      {!item.inLibrary ? (
                        <button
                          className="primary-btn"
                          onClick={async () => {
                            await createSong({
                              song_id: item.songId,
                              title: item.title,
                              artist: item.artist,
                              genre: item.genres.map((genre) => normalizeGenre(genre)).join(";"),
                              mood: item.moods.join(";"),
                              difficulty: item.difficulty,
                              purpose: "Skill",
                              status: "예정",
                              original_url: item.youtubeUrl || "",
                              notes: [
                                lang === "ko" ? "추천곡 탭에서 가져온 항목" : "Imported from recommendations",
                                item.difficulty ? `${lang === "ko" ? "난이도" : "Difficulty"}: ${item.difficulty}` : "",
                                item.moods.length ? `${lang === "ko" ? "분위기" : "Mood"}: ${item.moods.join(", ")}` : "",
                                item.techniques.length ? `${lang === "ko" ? "핵심 테크닉" : "Techniques"}: ${item.techniques.join(", ")}` : "",
                                item.description,
                              ]
                                .filter(Boolean)
                                .join("\n"),
                            });
                            setRowState(item.key, "imported");
                            setMessage(lang === "ko" ? "곡 라이브러리로 이동했습니다." : "Added to song library.");
                            await onRefresh();
                          }}
                        >
                          {lang === "ko" ? "라이브러리로" : "Add to Library"}
                        </button>
                      ) : (
                        <button className="ghost-btn" onClick={onOpenLibrary}>
                          {lang === "ko" ? "곡 라이브러리 열기" : "Open Library"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
