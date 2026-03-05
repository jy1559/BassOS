import { useEffect, useMemo, useState } from "react";
import { createRecordPost, deleteRecordPost, getRecords, putBasicSettings, updateRecordPost } from "../api";
import type { Lang } from "../i18n";
import type { JournalTagPreset, RecordPost, Settings } from "../types/models";

type Props = {
  lang: Lang;
  catalogs: {
    song_library: Array<Record<string, string>>;
    drill_library: Array<Record<string, string>>;
    drills: Array<Record<string, string>>;
  };
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onRefresh: () => Promise<void>;
  setMessage: (message: string) => void;
};

type ViewMode = "list" | "gallery";
const RECORD_VIEW_KEY = "bassos_record_view_mode";
const SONG_STATUS_GROUP_ORDER = ["before", "progress", "done", "other"] as const;
type SongStatusGroupKey = (typeof SONG_STATUS_GROUP_ORDER)[number];

function splitLooseTags(raw: string): string[] {
  return (raw || "")
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  labels.forEach((label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(trimmed);
  });
  return rows;
}

function nextTagId(): string {
  return `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mediaUrl(path: string, url: string): string {
  if (url) return url;
  if (path) return `/media/${path}`;
  return "";
}

function matchesQuery(item: RecordPost, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [item.title, item.body, ...(item.tags || []), ...(item.linked_song_titles || []), ...(item.linked_drill_titles || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function isFavorite(value: string): boolean {
  const raw = String(value || "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function songStatusGroupKey(status: string): SongStatusGroupKey {
  const value = String(status || "").trim();
  if (["목표", "예정", "카피중"].includes(value)) return "before";
  if (["시작", "루프 연습", "연습 중"].includes(value)) return "progress";
  if (["마무리", "공연완료", "포기"].includes(value)) return "done";
  return "other";
}

function songStatusGroupLabel(key: SongStatusGroupKey, lang: Lang): string {
  if (key === "before") return lang === "ko" ? "시작 전" : "Before Start";
  if (key === "progress") return lang === "ko" ? "진행 중" : "In Progress";
  if (key === "done") return lang === "ko" ? "완료" : "Done";
  return lang === "ko" ? "기타" : "Others";
}

function drillIdentity(item: Record<string, string>): string {
  return item.drill_id || `${item.name || ""}_${item.area || ""}`;
}

function mergeDrills(
  drills: Array<Record<string, string>>,
  drillLibrary: Array<Record<string, string>>
): Array<Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  drills.forEach((item) => {
    map.set(drillIdentity(item), { ...item });
  });
  drillLibrary.forEach((item) => {
    const key = drillIdentity(item);
    map.set(key, { ...(map.get(key) || {}), ...item });
  });
  return Array.from(map.values());
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

export function GalleryPage({ lang, catalogs, settings, onSettingsChange, onRefresh, setMessage }: Props) {
  const [items, setItems] = useState<RecordPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(RECORD_VIEW_KEY) === "list" ? "list" : "gallery"));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceContext, setSourceContext] = useState("practice");
  const [freeTargets, setFreeTargets] = useState("");
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [showAttachmentSection, setShowAttachmentSection] = useState(false);
  const [showTagSection, setShowTagSection] = useState(false);
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [selectedDrillIds, setSelectedDrillIds] = useState<string[]>([]);
  const [selectedCatalogTagIds, setSelectedCatalogTagIds] = useState<string[]>([]);
  const [openTagCategories, setOpenTagCategories] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busySave, setBusySave] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [catalogDraft, setCatalogDraft] = useState<JournalTagPreset[]>([]);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagCategory, setNewTagCategory] = useState("");

  const loadItems = async () => {
    setLoading(true);
    try {
      setItems(await getRecords({ limit: 1200 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : lang === "ko" ? "기록장 데이터를 불러오지 못했습니다." : "Failed to load journal data.");
    } finally {
      setLoading(false);
    }
  };

  const settingsCatalog = useMemo<JournalTagPreset[]>(
    () =>
      Array.isArray(settings.profile?.journal_tag_catalog)
        ? [...(settings.profile.journal_tag_catalog || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        : [],
    [settings.profile?.journal_tag_catalog]
  );

  useEffect(() => {
    setCatalogDraft(settingsCatalog);
  }, [settingsCatalog]);

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    if (settingsCatalog.length > 0) return;
    if (!items.length) return;
    const count = new Map<string, number>();
    items.forEach((item) => {
      (item.tags || []).forEach((tag) => {
        const normalized = tag.trim();
        if (!normalized) return;
        count.set(normalized, (count.get(normalized) ?? 0) + 1);
      });
    });
    const seeded = Array.from(count.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([label], index) => ({
        id: nextTagId(),
        label,
        category: lang === "ko" ? "기본" : "General",
        active: true,
        order: index,
      }));
    if (!seeded.length) return;
    void putBasicSettings({
      profile: {
        ...settings.profile,
        journal_tag_catalog: seeded,
      },
    })
      .then((updated) => {
        onSettingsChange(updated);
        setCatalogDraft(seeded);
      })
      .catch(() => undefined);
  }, [items, lang, onSettingsChange, settings.profile, settingsCatalog.length]);

  useEffect(() => {
    localStorage.setItem(RECORD_VIEW_KEY, viewMode);
  }, [viewMode]);

  const songLinkGroups = useMemo(() => {
    const sorted = [...catalogs.song_library]
      .filter((song) => String(song.library_id || "").trim())
      .sort((a, b) => (a.title || a.library_id || "").localeCompare(b.title || b.library_id || ""));
    const favorites = sorted.filter((song) => isFavorite(song.favorite || ""));
    const map = new Map<SongStatusGroupKey, Array<Record<string, string>>>();
    sorted
      .filter((song) => !isFavorite(song.favorite || ""))
      .forEach((song) => {
        const key = songStatusGroupKey(song.status || "");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(song);
      });
    const groups: Array<{ key: string; label: string; rows: Array<Record<string, string>>; defaultOpen: boolean }> = [];
    if (favorites.length) {
      groups.push({
        key: "favorite",
        label: lang === "ko" ? `★ 즐겨찾기 (${favorites.length})` : `★ Favorites (${favorites.length})`,
        rows: favorites,
        defaultOpen: true,
      });
    }
    SONG_STATUS_GROUP_ORDER.forEach((key) => {
      const rows = map.get(key) || [];
      if (!rows.length) return;
      groups.push({
        key,
        label: `${songStatusGroupLabel(key, lang)} (${rows.length})`,
        rows,
        defaultOpen: key === "before",
      });
    });
    return groups;
  }, [catalogs.song_library, lang]);

  const drillLinkGroups = useMemo(() => {
    const merged = mergeDrills(catalogs.drills, catalogs.drill_library)
      .filter((item) => String(item.drill_id || "").trim())
      .sort((a, b) => (a.name || a.drill_id || "").localeCompare(b.name || b.drill_id || ""));
    const favorites = merged.filter((item) => isFavorite(item.favorite || ""));
    const map = new Map<string, Array<Record<string, string>>>();
    merged
      .filter((item) => !isFavorite(item.favorite || ""))
      .forEach((item) => {
        const area = String(item.area || "").trim() || (lang === "ko" ? "미분류" : "Uncategorized");
        if (!map.has(area)) map.set(area, []);
        map.get(area)!.push(item);
      });

    const groups: Array<{ key: string; label: string; rows: Array<Record<string, string>>; defaultOpen: boolean }> = [];
    if (favorites.length) {
      groups.push({
        key: "favorite",
        label: lang === "ko" ? `★ 즐겨찾기 (${favorites.length})` : `★ Favorites (${favorites.length})`,
        rows: favorites,
        defaultOpen: true,
      });
    }
    Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([area, rows], index) => {
        groups.push({
          key: area,
          label: `${area} (${rows.length})`,
          rows,
          defaultOpen: index === 0,
        });
      });
    return groups;
  }, [catalogs.drills, catalogs.drill_library, lang]);

  const activeTagCatalog = useMemo(
    () =>
      catalogDraft
        .filter((item) => item.active !== false && String(item.label || "").trim())
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [catalogDraft]
  );

  const tagCategoryGroups = useMemo(() => {
    const map = new Map<string, JournalTagPreset[]>();
    activeTagCatalog.forEach((row) => {
      const category = row.category?.trim() || (lang === "ko" ? "기타" : "Other");
      if (!map.has(category)) map.set(category, []);
      map.get(category)!.push(row);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeTagCatalog, lang]);

  useEffect(() => {
    setOpenTagCategories((prev) => {
      if (!tagCategoryGroups.length) return {};
      const next: Record<string, boolean> = {};
      tagCategoryGroups.forEach(([category], index) => {
        next[category] = prev[category] ?? index === 0;
      });
      return next;
    });
  }, [tagCategoryGroups]);

  const filtered = useMemo(() => items.filter((item) => matchesQuery(item, search)), [items, search]);
  const selectedCatalogLabels = useMemo(
    () =>
      selectedCatalogTagIds
        .map((id) => activeTagCatalog.find((row) => row.id === id)?.label || "")
        .filter(Boolean),
    [selectedCatalogTagIds, activeTagCatalog]
  );
  const summary = useMemo(
    () => ({
      posts: items.length,
      attachments: items.reduce((sum, item) => sum + (item.attachments || []).length, 0),
    }),
    [items]
  );

  const resetComposer = () => {
    setEditingId("");
    setTitle("");
    setBody("");
    setSourceContext("practice");
    setFreeTargets("");
    setShowLinkSection(false);
    setShowAttachmentSection(false);
    setShowTagSection(false);
    setSelectedSongIds([]);
    setSelectedDrillIds([]);
    setSelectedCatalogTagIds([]);
    setFiles([]);
  };

  const toggleInArray = (value: string, current: string[], setter: (next: string[]) => void) =>
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  const setCatalogValue = (id: string, patch: Partial<JournalTagPreset>) => {
    setCatalogDraft((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        return { ...row, ...patch };
      })
    );
  };

  const addCatalogTag = () => {
    const label = newTagLabel.trim();
    if (!label) {
      setMessage(lang === "ko" ? "태그 이름을 입력하세요." : "Enter a tag name.");
      return;
    }
    const dup = catalogDraft.some((row) => row.label.trim().toLowerCase() === label.toLowerCase());
    if (dup) {
      setMessage(lang === "ko" ? "같은 이름의 태그가 이미 있습니다." : "Duplicate tag label.");
      return;
    }
    const next: JournalTagPreset = {
      id: nextTagId(),
      label,
      category: newTagCategory.trim() || (lang === "ko" ? "기타" : "Other"),
      active: true,
      order: catalogDraft.length,
    };
    setCatalogDraft((prev) => [...prev, next]);
    setNewTagLabel("");
  };

  const removeCatalogTag = (id: string) => {
    setCatalogDraft((prev) => prev.filter((row) => row.id !== id).map((row, index) => ({ ...row, order: index })));
    setSelectedCatalogTagIds((prev) => prev.filter((item) => item !== id));
  };

  const saveCatalog = async () => {
    const sanitized = catalogDraft
      .map((row, index) => ({
        ...row,
        label: row.label.trim(),
        category: row.category.trim() || (lang === "ko" ? "기타" : "Other"),
        order: index,
      }))
      .filter((row) => row.label);
    const seen = new Set<string>();
    for (const row of sanitized) {
      const key = row.label.toLowerCase();
      if (seen.has(key)) {
        setMessage(lang === "ko" ? "태그 이름이 중복되었습니다." : "Duplicate tag labels detected.");
        return;
      }
      seen.add(key);
    }
    try {
      const updated = await putBasicSettings({
        profile: {
          ...settings.profile,
          journal_tag_catalog: sanitized,
        },
      });
      onSettingsChange(updated);
      setCatalogDraft(sanitized);
      setShowTagManager(false);
      setMessage(lang === "ko" ? "태그 카탈로그를 저장했습니다." : "Tag catalog saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : lang === "ko" ? "태그 저장에 실패했습니다." : "Failed to save tag catalog.");
    }
  };

  const submitComposer = async () => {
    const freeTagList = dedupeLabels(splitLooseTags(freeTargets));
    const mergedTags = dedupeLabels([...selectedCatalogLabels, ...freeTagList]);
    const payload = {
      title: title.trim(),
      body: body.trim(),
      post_type: "기록",
      tags: mergedTags,
      linked_song_ids: selectedSongIds,
      linked_drill_ids: selectedDrillIds,
      free_targets: freeTagList,
      source_context: sourceContext,
    };
    if (!payload.title && !payload.body && files.length === 0) {
      setMessage(lang === "ko" ? "제목/본문/첨부 중 하나는 입력하세요." : "Fill title/body or add attachment.");
      return;
    }
    setBusySave(true);
    try {
      if (editingId) await updateRecordPost(editingId, payload);
      else await createRecordPost(payload, files);
      setMessage(lang === "ko" ? "저장되었습니다." : "Saved.");
      resetComposer();
      setShowComposer(false);
      await loadItems();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : lang === "ko" ? "저장 중 오류가 발생했습니다." : "Failed while saving.");
    } finally {
      setBusySave(false);
    }
  };

  const openEdit = (item: RecordPost) => {
    setEditingId(item.post_id);
    setTitle(item.title || "");
    setBody(item.body || "");
    setSourceContext(item.source_context || "practice");
    const selectedIds = activeTagCatalog
      .filter((preset) => (item.tags || []).some((tag) => tag.trim().toLowerCase() === preset.label.trim().toLowerCase()))
      .map((preset) => preset.id);
    const knownLabels = new Set(
      activeTagCatalog
        .filter((preset) => selectedIds.includes(preset.id))
        .map((preset) => preset.label.trim().toLowerCase())
    );
    const freeFallback = (item.tags || []).filter((tag) => !knownLabels.has(tag.trim().toLowerCase()));
    const freeMerged = dedupeLabels([...(item.free_targets || []), ...freeFallback]);
    setSelectedCatalogTagIds(selectedIds);
    setFreeTargets(freeMerged.join(", "));
    setShowTagSection(selectedIds.length > 0 || freeMerged.length > 0);
    setSelectedSongIds(item.linked_song_ids || []);
    setSelectedDrillIds(item.linked_drill_ids || []);
    setShowLinkSection((item.linked_song_ids || []).length > 0 || (item.linked_drill_ids || []).length > 0);
    setShowAttachmentSection((item.attachments || []).length > 0);
    setFiles([]);
    setShowComposer(true);
  };

  return (
    <div className="page-grid songs-page-list">
      <section className="card journal-header">
        <div className="journal-toolbar">
          <div className="journal-summary-inline">
            <strong>{lang === "ko" ? "기록장" : "Journal"}</strong>
            <small>{lang === "ko" ? `글 ${summary.posts}개` : `${summary.posts} posts`}</small>
            <small>{lang === "ko" ? `첨부 ${summary.attachments}개` : `${summary.attachments} files`}</small>
          </div>
          <div className="journal-actions">
            <button className={`ghost-btn ${viewMode === "list" ? "active-mini" : ""}`} onClick={() => setViewMode("list")}>{lang === "ko" ? "리스트" : "List"}</button>
            <button className={`ghost-btn ${viewMode === "gallery" ? "active-mini" : ""}`} onClick={() => setViewMode("gallery")}>{lang === "ko" ? "갤러리" : "Gallery"}</button>
            <button className="primary-btn" onClick={() => { resetComposer(); setShowComposer(true); }}>{lang === "ko" ? "글쓰기" : "Write"}</button>
          </div>
        </div>
        <div className="journal-search-row">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={lang === "ko" ? "제목/본문/태그/연결 검색" : "Search title/body/tag/links"} />
        </div>
      </section>

      {showComposer ? (
        <section className="card journal-composer" data-testid="tutorial-journal-composer">
          <div className="row">
            <h2>{editingId ? (lang === "ko" ? "게시글 수정" : "Edit Post") : (lang === "ko" ? "새 게시글" : "New Post")}</h2>
            <button className="ghost-btn" onClick={() => { setShowComposer(false); resetComposer(); }}>{lang === "ko" ? "닫기" : "Close"}</button>
          </div>
          <div className="song-form-grid">
            <label>{lang === "ko" ? "제목" : "Title"}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>{lang === "ko" ? "맥락" : "Context"}<select value={sourceContext} onChange={(event) => setSourceContext(event.target.value)}><option value="practice">{lang === "ko" ? "연습" : "Practice"}</option><option value="review">{lang === "ko" ? "회고" : "Review"}</option><option value="performance">{lang === "ko" ? "합주/공연" : "Performance"}</option><option value="archive">{lang === "ko" ? "아카이브" : "Archive"}</option></select></label>
          </div>
          <label>{lang === "ko" ? "본문" : "Body"}<textarea className="journal-body-textarea" value={body} onChange={(event) => setBody(event.target.value)} rows={12} placeholder={lang === "ko" ? "연습 기록과 메모를 자유롭게 작성하세요." : "Write your practice notes."} /></label>
          <div className="switch-row journal-composer-mini-toggle">
            <button className={`ghost-btn compact-add-btn journal-mini-pill ${showLinkSection ? "active-mini" : ""}`} onClick={() => setShowLinkSection((prev) => !prev)}>{showLinkSection ? (lang === "ko" ? "▤ 연결 접기" : "▤ Hide Links") : (lang === "ko" ? "▤ 연결 열기" : "▤ Show Links")}</button>
            <button className={`ghost-btn compact-add-btn journal-mini-pill ${showAttachmentSection ? "active-mini" : ""}`} onClick={() => setShowAttachmentSection((prev) => !prev)}>{showAttachmentSection ? (lang === "ko" ? "◫ 첨부 접기" : "◫ Hide Attachments") : (lang === "ko" ? "◫ 첨부 열기" : "◫ Show Attachments")}</button>
          </div>
          <div className="journal-tag-catalog-box">
            <div className="row">
              <strong>{lang === "ko" ? "태그 선택" : "Tag Catalog"}</strong>
              <div className="row">
                <button className="ghost-btn" type="button" onClick={() => setShowTagManager(true)}>
                  {lang === "ko" ? "태그 관리" : "Manage Tags"}
                </button>
                <button className={`ghost-btn ${showTagSection ? "active-mini" : ""}`} type="button" onClick={() => setShowTagSection((prev) => !prev)}>
                  {showTagSection ? (lang === "ko" ? "태그 접기" : "Hide Tags") : (lang === "ko" ? "태그 열기" : "Show Tags")}
                </button>
              </div>
            </div>

            {showTagSection ? (
              <>
                {tagCategoryGroups.length ? (
                  <div className="journal-tag-groups">
                    {tagCategoryGroups.map(([category, rows]) => {
                      const isOpen = openTagCategories[category] ?? false;
                      return (
                        <div key={category} className="journal-tag-group">
                          <button
                            type="button"
                            className={`ghost-btn journal-tag-category-toggle ${isOpen ? "active-mini" : ""}`}
                            onClick={() => setOpenTagCategories((prev) => ({ ...prev, [category]: !isOpen }))}
                          >
                            {isOpen ? "▾" : "▸"} {category} ({rows.length})
                          </button>
                          {isOpen ? (
                            <div className="journal-tag-chip-row">
                              {rows.map((row) => {
                                const selected = selectedCatalogTagIds.includes(row.id);
                                return (
                                  <button
                                    key={row.id}
                                    type="button"
                                    className={`achievement-chip journal-select-tag ${selected ? "is-selected" : ""}`}
                                    aria-pressed={selected}
                                    onClick={() => toggleInArray(row.id, selectedCatalogTagIds, setSelectedCatalogTagIds)}
                                  >
                                    {row.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <small className="muted">{lang === "ko" ? "등록된 태그가 없습니다. 태그 관리에서 추가하세요." : "No preset tags. Add tags from manager."}</small>
                )}
              </>
            ) : null}
            <small className="muted">
              {selectedCatalogLabels.length
                ? `${lang === "ko" ? "선택 태그" : "Selected"}: ${selectedCatalogLabels.join(", ")}`
                : lang === "ko"
                  ? "선택된 태그 없음"
                  : "No selected tags"}
            </small>
            <label>
              {lang === "ko" ? "자유 태그(쉼표)" : "Free Tags (comma)"}
              <input value={freeTargets} onChange={(event) => setFreeTargets(event.target.value)} />
            </label>
          </div>

          {showLinkSection ? (
            <div className="journal-link-grid">
              <div className="journal-link-picker">
                <small>{lang === "ko" ? "연결 곡" : "Linked Songs"}</small>
                <div className="journal-link-list grouped">
                  {songLinkGroups.map((group) => (
                    <details key={group.key} open={group.defaultOpen}>
                      <summary>{group.label}</summary>
                      <div className="journal-link-items">
                        {group.rows.map((song) => (
                          <label key={song.library_id} className="inline selectable-row">
                            <input type="checkbox" checked={selectedSongIds.includes(song.library_id)} onChange={() => toggleInArray(song.library_id, selectedSongIds, setSelectedSongIds)} />
                            <span>{song.title || song.library_id}{song.status ? ` · ${song.status}` : ""}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
              <div className="journal-link-picker">
                <small>{lang === "ko" ? "연결 드릴" : "Linked Drills"}</small>
                <div className="journal-link-list grouped">
                  {drillLinkGroups.map((group) => (
                    <details key={group.key} open={group.defaultOpen}>
                      <summary>{group.label}</summary>
                      <div className="journal-link-items">
                        {group.rows.map((drill) => (
                          <label key={`${drill.drill_id}_${drill.name || ""}`} className="inline selectable-row">
                            <input type="checkbox" checked={selectedDrillIds.includes(drill.drill_id)} onChange={() => toggleInArray(drill.drill_id, selectedDrillIds, setSelectedDrillIds)} />
                            <span>{drill.name || drill.drill_id}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {showAttachmentSection ? (
            <>
              <label>{lang === "ko" ? "첨부 파일 (최대 8개)" : "Attachments (max 8)"}<input type="file" multiple accept="image/*,video/*,audio/*" onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 8))} /><small className="muted">{files.length > 0 ? files.map((file) => file.name).join(", ") : (lang === "ko" ? "첨부 없음" : "No attachment")}</small></label>
              <button className="ghost-btn compact-add-btn" onClick={async () => { const clipped = await readClipboardImage(); if (!clipped) { setMessage(lang === "ko" ? "클립보드에 이미지가 없습니다." : "No image in clipboard."); return; } setFiles((prev) => [...prev, clipped].slice(0, 8)); }}>{lang === "ko" ? "클립보드 이미지 추가" : "Add Clipboard Image"}</button>
            </>
          ) : null}
          <div className="row"><button className="primary-btn" disabled={busySave} onClick={() => void submitComposer()}>{busySave ? (lang === "ko" ? "저장 중..." : "Saving...") : editingId ? (lang === "ko" ? "수정 저장" : "Save Changes") : (lang === "ko" ? "게시글 등록" : "Publish")}</button></div>
        </section>
      ) : null}

      {showTagManager ? (
        <section className="card journal-tag-manager" data-testid="journal-tag-manager">
          <div className="row">
            <h2>{lang === "ko" ? "태그 관리" : "Tag Manager"}</h2>
            <div className="row">
              <button className="ghost-btn" type="button" onClick={() => setShowTagManager(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
              <button className="primary-btn" type="button" onClick={() => void saveCatalog()}>
                {lang === "ko" ? "저장" : "Save"}
              </button>
            </div>
          </div>
          <div className="song-form-grid">
            <label>
              {lang === "ko" ? "새 태그" : "New Tag"}
              <input value={newTagLabel} onChange={(event) => setNewTagLabel(event.target.value)} />
            </label>
            <label>
              {lang === "ko" ? "카테고리" : "Category"}
              <input value={newTagCategory} onChange={(event) => setNewTagCategory(event.target.value)} placeholder={lang === "ko" ? "예: 기술/아이디어" : "e.g. Technique"} />
            </label>
          </div>
          <div className="row">
            <button className="ghost-btn" type="button" onClick={addCatalogTag}>
              {lang === "ko" ? "태그 추가" : "Add Tag"}
            </button>
          </div>
          <div className="journal-tag-edit-list">
            {catalogDraft.map((row) => (
              <div className="journal-tag-edit-row" key={row.id}>
                <input
                  value={row.label}
                  onChange={(event) => setCatalogValue(row.id, { label: event.target.value })}
                  placeholder={lang === "ko" ? "태그명" : "Tag label"}
                />
                <input
                  value={row.category}
                  onChange={(event) => setCatalogValue(row.id, { category: event.target.value })}
                  placeholder={lang === "ko" ? "카테고리" : "Category"}
                />
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={row.active !== false}
                    onChange={(event) => setCatalogValue(row.id, { active: event.target.checked })}
                  />
                  <span>{lang === "ko" ? "사용" : "Active"}</span>
                </label>
                <button className="ghost-btn danger-border" type="button" onClick={() => removeCatalogTag(row.id)}>
                  {lang === "ko" ? "삭제" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="row"><h2>{lang === "ko" ? "기록 피드" : "Journal Feed"}</h2><small className="muted">{loading ? (lang === "ko" ? "불러오는 중..." : "Loading...") : `${filtered.length}`}</small></div>
        <div className={viewMode === "gallery" ? "journal-gallery-grid" : "journal-list-grid"}>
          {filtered.map((item) => (
            <article key={item.post_id} className="record-post-card card">
              <div className="row"><small>{(item.created_at || "").replace("T", " ").slice(0, 16)}</small><div className="row"><button className="ghost-btn" onClick={() => openEdit(item)}>{lang === "ko" ? "수정" : "Edit"}</button><button className="ghost-btn danger-border" onClick={async () => { if (!window.confirm(lang === "ko" ? "이 게시글을 삭제할까요?" : "Delete this post?")) return; await deleteRecordPost(item.post_id); await loadItems(); await onRefresh(); }}>{lang === "ko" ? "삭제" : "Delete"}</button></div></div>
              <strong>{item.title || (lang === "ko" ? "무제" : "Untitled")}</strong>
              <small className="muted">{(item.body || "").slice(0, viewMode === "gallery" ? 180 : 320)}</small>
              {item.attachments.length ? <div className="record-inline-media">{item.attachments.map((attachment) => { const url = mediaUrl(attachment.path, attachment.url); if (!url) return null; if (attachment.media_type === "image") return <img key={attachment.attachment_id} src={url} alt={attachment.title || item.title} className="journal-thumb" />; if (attachment.media_type === "video") return <video key={attachment.attachment_id} src={url} className="journal-thumb" controls />; return <audio key={attachment.attachment_id} src={url} controls />; })}</div> : null}
              {(item.linked_song_titles?.length || item.linked_drill_titles?.length) ? <small className="muted">{(item.linked_song_titles || []).join(", ")}{item.linked_song_titles?.length && item.linked_drill_titles?.length ? " / " : ""}{(item.linked_drill_titles || []).join(", ")}</small> : null}
              <div className="gallery-tags">{(item.tags || []).slice(0, 10).map((tag) => <span key={`${item.post_id}-${tag}`} className="achievement-chip">{tag}</span>)}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
