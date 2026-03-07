import { useEffect, useMemo, useState } from "react";
import {
  createRecordComment,
  createRecordPost,
  deleteRecordComment,
  deleteRecordPost,
  getRecordPostDetail,
  getRecords,
  putBasicSettings,
  updateRecordAttachment,
  updateRecordComment,
  updateRecordPost,
} from "../api";
import { JournalComposerModal } from "../components/journal/JournalComposerModal";
import type { JournalComposerSubmitPayload } from "../components/journal/JournalComposerModal";
import { JournalDetailOverlay } from "../components/journal/JournalDetailOverlay";
import { JournalManagerModal } from "../components/journal/JournalManagerModal";
import {
  excerptFromMarkdown,
  formatJournalBoardDate,
  formatJournalBoardTitle,
  getYouTubeThumbnailUrl,
  isYouTubeUrl,
  RECORD_VIEW_KEY,
  withAlpha,
} from "../components/journal/journalUtils";
import type { Lang } from "../i18n";
import type {
  JournalHeaderPreset,
  JournalTagPreset,
  JournalTemplatePreset,
  RecordComment,
  RecordPost,
  Settings,
} from "../types/models";

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
type SortMode = "created_desc" | "updated_desc";
type SearchScope = "title" | "title_body" | "tags" | "song" | "drill";
type FilterDraft = {
  q: string;
  search_scope: SearchScope;
  header_id: string;
  template_id: string;
  media_type: "all" | "image" | "video" | "audio";
  sort: SortMode;
  tag_ids: string[];
  free_tag_tokens: string[];
  pending_free_tag: string;
  song_library_ids: string[];
  drill_ids: string[];
};
type ManagerPanel = "" | "tags" | "headers" | "templates";
type DetailItem = RecordPost & { comments: RecordComment[] };
type GroupedRows = {
  label: string;
  items: Array<Record<string, string>>;
};
type TagGroup = {
  label: string;
  items: JournalTagPreset[];
};

function defaultViewMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(RECORD_VIEW_KEY);
  return stored === "gallery" ? "gallery" : "list";
}

function mediaUrl(path: string, url: string): string {
  if (url) return url;
  if (path) return `/media/${path}`;
  return "";
}

function firstAttachment(item: RecordPost) {
  return item.attachments.find((attachment) => Boolean(mediaUrl(attachment.path, attachment.url))) || null;
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  labels.forEach((label) => {
    const trimmed = label.trim();
    const lowered = trimmed.toLowerCase();
    if (!trimmed || seen.has(lowered)) return;
    seen.add(lowered);
    rows.push(trimmed);
  });
  return rows;
}

function splitLooseTokens(raw: string): string[] {
  return (raw || "")
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function drillIdentity(item: Record<string, string>): string {
  return item.drill_id || `${item.name || ""}_${item.area || ""}`;
}

function mergeDrills(
  drills: Array<Record<string, string>>,
  drillLibrary: Array<Record<string, string>>
): Array<Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  drills.forEach((item) => map.set(drillIdentity(item), { ...item }));
  drillLibrary.forEach((item) => map.set(drillIdentity(item), { ...(map.get(drillIdentity(item)) || {}), ...item }));
  return Array.from(map.values());
}

function groupRows(rows: Array<Record<string, string>>, key: string, fallback: string): GroupedRows[] {
  const groups = new Map<string, Array<Record<string, string>>>();
  rows.forEach((row) => {
    const label = String(row[key] || "").trim() || fallback;
    groups.set(label, [...(groups.get(label) || []), row]);
  });
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([label, items]) => ({ label, items }));
}

function groupTagCatalog(rows: JournalTagPreset[], fallback: string): TagGroup[] {
  const groups = new Map<string, JournalTagPreset[]>();
  rows.forEach((row) => {
    const label = String(row.category || "").trim() || fallback;
    groups.set(label, [...(groups.get(label) || []), row]);
  });
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([label, items]) => ({ label, items }));
}

function normalizeFilters(filters: FilterDraft): FilterDraft {
  return {
    ...filters,
    q: filters.q.trim(),
    free_tag_tokens: dedupeLabels([...filters.free_tag_tokens, ...splitLooseTokens(filters.pending_free_tag)]),
    pending_free_tag: "",
  };
}

function buildLinkedSummary(item: RecordPost, lang: Lang): string {
  const bits: string[] = [];
  if (item.linked_song_titles?.length) {
    const first = item.linked_song_titles[0];
    const rest = item.linked_song_titles.length - 1;
    bits.push(lang === "ko" ? `곡 ${first}${rest > 0 ? ` 외 ${rest}` : ""}` : `Song ${first}${rest > 0 ? ` +${rest}` : ""}`);
  }
  if (item.linked_drill_titles?.length) {
    const first = item.linked_drill_titles[0];
    const rest = item.linked_drill_titles.length - 1;
    bits.push(lang === "ko" ? `드릴 ${first}${rest > 0 ? ` 외 ${rest}` : ""}` : `Drill ${first}${rest > 0 ? ` +${rest}` : ""}`);
  }
  if (item.attachments.length) {
    bits.push(lang === "ko" ? `첨부 ${item.attachments.length}` : `${item.attachments.length} files`);
  }
  return bits.join(" · ");
}

function isTextSearchScope(scope: SearchScope): boolean {
  return scope === "title" || scope === "title_body";
}

export function GalleryPage({
  lang,
  catalogs,
  settings,
  onSettingsChange,
  onRefresh,
  setMessage,
}: Props) {
  const initialFilters = useMemo<FilterDraft>(
    () => ({
      q: "",
      search_scope: "title_body",
      header_id: "",
      template_id: "",
      media_type: "all",
      sort: "created_desc",
      tag_ids: [],
      free_tag_tokens: [],
      pending_free_tag: "",
      song_library_ids: [],
      drill_ids: [],
    }),
    []
  );
  const [items, setItems] = useState<RecordPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => defaultViewMode());
  const [draftFilters, setDraftFilters] = useState<FilterDraft>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterDraft>(initialFilters);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecordPost | null>(null);
  const [busySave, setBusySave] = useState(false);
  const [detailPostId, setDetailPostId] = useState("");
  const [detailItem, setDetailItem] = useState<DetailItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [managerPanel, setManagerPanel] = useState<ManagerPanel>("");

  const tagCatalog = useMemo<JournalTagPreset[]>(
    () => (Array.isArray(settings.profile?.journal_tag_catalog) ? [...(settings.profile.journal_tag_catalog || [])].sort((a, b) => a.order - b.order) : []),
    [settings.profile?.journal_tag_catalog]
  );
  const activeTagCatalog = useMemo(
    () => tagCatalog.filter((entry) => entry.active !== false && String(entry.label || "").trim()),
    [tagCatalog]
  );
  const tagCatalogGroups = useMemo(
    () => groupTagCatalog(activeTagCatalog, lang === "ko" ? "기타" : "Other"),
    [activeTagCatalog, lang]
  );
  const headerCatalog = useMemo<JournalHeaderPreset[]>(
    () => (Array.isArray(settings.profile?.journal_header_catalog) ? [...(settings.profile.journal_header_catalog || [])].sort((a, b) => a.order - b.order) : []),
    [settings.profile?.journal_header_catalog]
  );
  const templateCatalog = useMemo<JournalTemplatePreset[]>(
    () => (Array.isArray(settings.profile?.journal_template_catalog) ? [...(settings.profile.journal_template_catalog || [])].sort((a, b) => a.order - b.order) : []),
    [settings.profile?.journal_template_catalog]
  );
  const mergedDrills = useMemo(
    () =>
      mergeDrills(catalogs.drills, catalogs.drill_library)
        .filter((row) => String(row.drill_id || "").trim())
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko")),
    [catalogs.drill_library, catalogs.drills]
  );
  const groupedSongs = useMemo(
    () =>
      groupRows(
        catalogs.song_library
          .filter((row) => String(row.library_id || "").trim())
          .sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko")),
        "genre",
        lang === "ko" ? "기타 장르" : "Other"
      ),
    [catalogs.song_library, lang]
  );
  const groupedDrills = useMemo(
    () => groupRows(mergedDrills, "area", lang === "ko" ? "기타 유형" : "Other"),
    [lang, mergedDrills]
  );
  const tagLabelById = useMemo(() => new Map(activeTagCatalog.map((row) => [row.id, row.label])), [activeTagCatalog]);

  const resolveTagLabels = (filters: FilterDraft) =>
    dedupeLabels([
      ...filters.tag_ids.map((id) => tagLabelById.get(id) || ""),
      ...filters.free_tag_tokens,
    ]);

  const loadItems = async (filters: FilterDraft = appliedFilters) => {
    const normalized = normalizeFilters(filters);
    const tagLabels = resolveTagLabels(normalized);
    setLoading(true);
    try {
      const nextItems = await getRecords({
        limit: 1200,
        q: isTextSearchScope(normalized.search_scope) ? normalized.q : "",
        search_scope: normalized.search_scope,
        header_id: normalized.header_id,
        template_id: normalized.template_id,
        media_type: normalized.media_type,
        tag_labels: normalized.search_scope === "tags" ? tagLabels : [],
        song_library_ids: normalized.search_scope === "song" ? normalized.song_library_ids : [],
        drill_ids: normalized.search_scope === "drill" ? normalized.drill_ids : [],
        sort: normalized.sort,
      });
      setItems(nextItems);
      if (detailPostId && !nextItems.some((row) => row.post_id === detailPostId)) {
        setDetailPostId("");
        setDetailItem(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : lang === "ko" ? "기록장 데이터를 불러오지 못했습니다." : "Failed to load journal data.");
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (postId: string) => {
    setDetailPostId(postId);
    setDetailLoading(true);
    try {
      const nextItem = await getRecordPostDetail(postId);
      setDetailItem(nextItem as DetailItem);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : lang === "ko" ? "상세 글을 불러오지 못했습니다." : "Failed to load post detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detailPostId) return;
    const nextItem = await getRecordPostDetail(detailPostId);
    setDetailItem(nextItem as DetailItem);
  };

  useEffect(() => {
    void loadItems(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    localStorage.setItem(RECORD_VIEW_KEY, viewMode);
  }, [viewMode]);

  const applyFilters = async () => {
    const next = normalizeFilters(draftFilters);
    setDraftFilters(next);
    setAppliedFilters(next);
    await loadItems(next);
  };

  const resetFilters = async () => {
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
    await loadItems(initialFilters);
  };

  const submitComposer = async (payload: JournalComposerSubmitPayload, files: File[]) => {
    if (
      !payload.title.trim() &&
      !payload.body.trim() &&
      files.length === 0 &&
      payload.external_attachments.length === 0 &&
      payload.attachment_updates.length === 0
    ) {
      setMessage(lang === "ko" ? "제목/본문/첨부 중 하나는 입력하세요." : "Fill title/body or add attachment.");
      return;
    }
    setBusySave(true);
    try {
      if (editingItem) {
        const { attachment_updates, ...postPatch } = payload;
        await updateRecordPost(editingItem.post_id, postPatch, files);
        await Promise.all(
          attachment_updates.map((attachment) =>
            updateRecordAttachment(editingItem.post_id, attachment.attachment_id, {
              title: attachment.title,
              notes: attachment.notes,
            })
          )
        );
      } else {
        const { attachment_updates: _attachmentUpdates, ...createPayload } = payload;
        await createRecordPost(createPayload, files);
      }
      setComposerOpen(false);
      setEditingItem(null);
      await loadItems(appliedFilters);
      await onRefresh();
      if (detailPostId) await refreshDetail();
      setMessage(lang === "ko" ? "저장되었습니다." : "Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : lang === "ko" ? "저장 중 오류가 발생했습니다." : "Failed while saving.");
    } finally {
      setBusySave(false);
    }
  };

  const deletePost = async (item: RecordPost) => {
    await deleteRecordPost(item.post_id);
    await loadItems(appliedFilters);
    await onRefresh();
    if (detailPostId === item.post_id) {
      setDetailPostId("");
      setDetailItem(null);
    }
    setMessage(lang === "ko" ? "게시글을 삭제했습니다." : "Post deleted.");
  };

  const saveManager = async (payload: {
    journal_tag_catalog?: JournalTagPreset[];
    journal_header_catalog?: JournalHeaderPreset[];
    journal_template_catalog?: JournalTemplatePreset[];
  }) => {
    const updated = await putBasicSettings({ profile: { ...settings.profile, ...payload } });
    onSettingsChange(updated);
    setManagerPanel("");
    setMessage(lang === "ko" ? "기록장 설정을 저장했습니다." : "Journal settings saved.");
  };

  const detailIndex = items.findIndex((row) => row.post_id === detailPostId);
  const canPrev = detailIndex > 0;
  const canNext = detailIndex >= 0 && detailIndex < items.length - 1;
  const totalComments = items.reduce((sum, item) => sum + item.comment_count, 0);
  const textSearchActive = isTextSearchScope(draftFilters.search_scope);
  const searchPlaceholder =
    draftFilters.search_scope === "title"
      ? lang === "ko"
        ? "제목만 검색"
        : "Search titles only"
      : draftFilters.search_scope === "title_body"
        ? lang === "ko"
          ? "제목 + 본문 검색"
          : "Search title + body"
        : lang === "ko"
        ? "아래에서 태그/곡/드릴을 선택하세요"
        : "Use the selector below";

  return (
    <div className="page-grid journal-page-shell">
      <section className="card journal-header-board">
        <div className="journal-toolbar">
          <div className="journal-summary-inline">
            <strong>{lang === "ko" ? "기록장" : "Journal"}</strong>
            <small>{lang === "ko" ? `글 ${items.length}개` : `${items.length} posts`}</small>
            <small>{lang === "ko" ? `댓글 ${totalComments}개` : `${totalComments} comments`}</small>
          </div>
          <div className="journal-actions">
            <button className={`ghost-btn ${viewMode === "list" ? "active-mini" : ""}`} onClick={() => setViewMode("list")}>{lang === "ko" ? "리스트" : "List"}</button>
            <button className={`ghost-btn ${viewMode === "gallery" ? "active-mini" : ""}`} onClick={() => setViewMode("gallery")}>{lang === "ko" ? "갤러리" : "Gallery"}</button>
            <button className="ghost-btn compact-add-btn" onClick={() => setManagerPanel("headers")}>{lang === "ko" ? "말머리" : "Headers"}</button>
            <button className="ghost-btn compact-add-btn" onClick={() => setManagerPanel("templates")}>{lang === "ko" ? "템플릿" : "Templates"}</button>
            <button className="primary-btn" onClick={() => { setEditingItem(null); setComposerOpen(true); }}>{lang === "ko" ? "글쓰기" : "Write"}</button>
          </div>
        </div>

        <form className="journal-filter-board" onSubmit={(event) => { event.preventDefault(); void applyFilters(); }}>
          <div className="journal-filter-top-row">
            <label className="journal-filter-cell compact">
              {lang === "ko" ? "말머리" : "Header"}
              <select value={draftFilters.header_id} onChange={(event) => setDraftFilters((prev) => ({ ...prev, header_id: event.target.value }))}>
                <option value="">{lang === "ko" ? "전체" : "All"}</option>
                {headerCatalog.filter((row) => row.active !== false).map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </select>
            </label>
            <label className="journal-filter-cell compact">
              {lang === "ko" ? "검색 기준" : "Mode"}
              <select value={draftFilters.search_scope} onChange={(event) => setDraftFilters((prev) => ({ ...prev, search_scope: event.target.value as SearchScope }))}>
                <option value="title">{lang === "ko" ? "제목" : "Title"}</option>
                <option value="title_body">{lang === "ko" ? "제목+본문" : "Title + Body"}</option>
                <option value="tags">{lang === "ko" ? "태그" : "Tags"}</option>
                <option value="song">{lang === "ko" ? "곡" : "Song"}</option>
                <option value="drill">{lang === "ko" ? "드릴" : "Drill"}</option>
              </select>
            </label>
            <label className="journal-filter-cell wide">
              {lang === "ko" ? "검색어" : "Search"}
              <input
                value={draftFilters.q}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, q: event.target.value }))}
                placeholder={searchPlaceholder}
                disabled={!textSearchActive}
              />
            </label>
          </div>

          {draftFilters.search_scope === "tags" ? (
            <div className="journal-filter-mode-panel">
              <div className="journal-filter-mode-grid">
                <section className="journal-filter-mode-card">
                  <div className="row">
                    <strong>{lang === "ko" ? "고정 태그" : "Preset Tags"}</strong>
                    <small className="muted">{lang === "ko" ? "다중 선택" : "Multi-select"}</small>
                  </div>
                  <div className="journal-filter-group-grid">
                    {tagCatalogGroups.map((group) => (
                      <section key={group.label} className="journal-filter-group-card">
                        <div className="row">
                          <strong>{group.label}</strong>
                          <small className="muted">{group.items.filter((row) => draftFilters.tag_ids.includes(row.id)).length}/{group.items.length}</small>
                        </div>
                        <div className="journal-chip-cloud journal-filter-chip-cloud">
                          {group.items.map((row) => {
                            const selected = draftFilters.tag_ids.includes(row.id);
                            return (
                              <button
                                key={row.id}
                                type="button"
                                className={`achievement-chip journal-select-tag ${selected ? "is-selected" : ""}`}
                                onClick={() =>
                                  setDraftFilters((prev) => ({
                                    ...prev,
                                    tag_ids: prev.tag_ids.includes(row.id) ? prev.tag_ids.filter((id) => id !== row.id) : [...prev.tag_ids, row.id],
                                  }))
                                }
                              >
                                {row.label}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>

                <section className="journal-filter-mode-card">
                  <div className="row">
                    <strong>{lang === "ko" ? "자유 태그" : "Free Tags"}</strong>
                    <small className="muted">{lang === "ko" ? "쉼표 / Enter로 추가" : "Comma / Enter to add"}</small>
                  </div>
                  <div className="journal-chip-cloud journal-filter-chip-cloud">
                    {draftFilters.free_tag_tokens.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="achievement-chip journal-select-tag is-selected"
                        onClick={() =>
                          setDraftFilters((prev) => ({
                            ...prev,
                            free_tag_tokens: prev.free_tag_tokens.filter((item) => item !== tag),
                          }))
                        }
                      >
                        {tag} ×
                      </button>
                    ))}
                    {!draftFilters.free_tag_tokens.length ? (
                      <small className="muted">{lang === "ko" ? "추가된 자유 태그 없음" : "No free tags yet"}</small>
                    ) : null}
                  </div>
                  <div className="journal-filter-tag-input-row">
                    <input
                      aria-label={lang === "ko" ? "자유 태그 검색" : "Free tag search"}
                      value={draftFilters.pending_free_tag}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, pending_free_tag: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== ",") return;
                        event.preventDefault();
                        setDraftFilters((prev) => normalizeFilters(prev));
                      }}
                      placeholder={lang === "ko" ? "예: 슬랩, 루틴" : "ex. slap, routine"}
                    />
                    <button type="button" className="ghost-btn compact-add-btn" onClick={() => setDraftFilters((prev) => normalizeFilters(prev))}>
                      {lang === "ko" ? "추가" : "Add"}
                    </button>
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {draftFilters.search_scope === "song" ? (
            <div className="journal-filter-mode-panel">
              <section className="journal-filter-mode-card">
                <div className="row">
                  <strong>{lang === "ko" ? "곡 선택" : "Songs"}</strong>
                  <small className="muted">{lang === "ko" ? "장르별 선택" : "Grouped by genre"}</small>
                </div>
                <div className="journal-filter-group-grid">
                  {groupedSongs.map((group) => (
                    <section key={group.label} className="journal-filter-group-card">
                      <div className="row">
                        <strong>{group.label}</strong>
                        <small className="muted">{group.items.filter((row) => draftFilters.song_library_ids.includes(String(row.library_id || ""))).length}/{group.items.length}</small>
                      </div>
                      <div className="journal-chip-cloud journal-filter-chip-cloud">
                        {group.items.map((row) => {
                          const libraryId = String(row.library_id || "");
                          const selected = draftFilters.song_library_ids.includes(libraryId);
                          return (
                            <button
                              key={libraryId}
                              type="button"
                              className={`achievement-chip journal-select-tag ${selected ? "is-selected" : ""}`}
                              onClick={() =>
                                setDraftFilters((prev) => ({
                                  ...prev,
                                  song_library_ids: prev.song_library_ids.includes(libraryId)
                                    ? prev.song_library_ids.filter((id) => id !== libraryId)
                                    : [...prev.song_library_ids, libraryId],
                                }))
                              }
                            >
                              {row.title || libraryId}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {draftFilters.search_scope === "drill" ? (
            <div className="journal-filter-mode-panel">
              <section className="journal-filter-mode-card">
                <div className="row">
                  <strong>{lang === "ko" ? "드릴 선택" : "Drills"}</strong>
                  <small className="muted">{lang === "ko" ? "유형별 선택" : "Grouped by area"}</small>
                </div>
                <div className="journal-filter-group-grid">
                  {groupedDrills.map((group) => (
                    <section key={group.label} className="journal-filter-group-card">
                      <div className="row">
                        <strong>{group.label}</strong>
                        <small className="muted">{group.items.filter((row) => draftFilters.drill_ids.includes(String(row.drill_id || ""))).length}/{group.items.length}</small>
                      </div>
                      <div className="journal-chip-cloud journal-filter-chip-cloud">
                        {group.items.map((row) => {
                          const drillId = String(row.drill_id || "");
                          const selected = draftFilters.drill_ids.includes(drillId);
                          return (
                            <button
                              key={drillId}
                              type="button"
                              className={`achievement-chip journal-select-tag ${selected ? "is-selected" : ""}`}
                              onClick={() =>
                                setDraftFilters((prev) => ({
                                  ...prev,
                                  drill_ids: prev.drill_ids.includes(drillId)
                                    ? prev.drill_ids.filter((id) => id !== drillId)
                                    : [...prev.drill_ids, drillId],
                                }))
                              }
                            >
                              {row.name || drillId}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          <div className="journal-filter-bottom-row">
            <label className="journal-filter-cell">
              {lang === "ko" ? "템플릿" : "Template"}
              <select value={draftFilters.template_id} onChange={(event) => setDraftFilters((prev) => ({ ...prev, template_id: event.target.value }))}>
                <option value="">{lang === "ko" ? "전체" : "All"}</option>
                {templateCatalog.filter((row) => row.active !== false).map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label className="journal-filter-cell">
              {lang === "ko" ? "미디어" : "Media"}
              <select value={draftFilters.media_type} onChange={(event) => setDraftFilters((prev) => ({ ...prev, media_type: event.target.value as FilterDraft["media_type"] }))}>
                <option value="all">{lang === "ko" ? "전체" : "All"}</option>
                <option value="image">{lang === "ko" ? "이미지" : "Image"}</option>
                <option value="video">{lang === "ko" ? "영상" : "Video"}</option>
                <option value="audio">{lang === "ko" ? "오디오" : "Audio"}</option>
              </select>
            </label>
            <label className="journal-filter-cell">
              {lang === "ko" ? "정렬" : "Sort"}
              <select value={draftFilters.sort} onChange={(event) => setDraftFilters((prev) => ({ ...prev, sort: event.target.value as SortMode }))}>
                <option value="created_desc">{lang === "ko" ? "작성일 최신순" : "Newest Created"}</option>
                <option value="updated_desc">{lang === "ko" ? "수정일 최신순" : "Latest Updated"}</option>
              </select>
            </label>
            <div className="journal-filter-actions">
              <button type="submit" className="primary-btn">{lang === "ko" ? "검색" : "Search"}</button>
              <button type="button" className="ghost-btn" onClick={() => void resetFilters()}>{lang === "ko" ? "초기화" : "Reset"}</button>
            </div>
          </div>
        </form>
      </section>

      <section className="card journal-feed-card">
        <div className="row"><h2>{lang === "ko" ? "기록 게시판" : "Journal Board"}</h2><small className="muted">{loading ? (lang === "ko" ? "불러오는 중..." : "Loading...") : `${items.length}`}</small></div>
        {viewMode === "list" ? (
          <div className="journal-board-list">
            {items.map((item) => {
              const compactTitle = formatJournalBoardTitle(item.title, item.comment_count, lang === "ko" ? "무제" : "Untitled");
              const compactExcerpt = excerptFromMarkdown(item.body || "", 68);
              const linkedSummary = buildLinkedSummary(item, lang);
              const fullTitle = `${item.title || (lang === "ko" ? "무제" : "Untitled")}${item.comment_count > 0 ? ` (${item.comment_count})` : ""}`;
              return (
                <article key={item.post_id} className="journal-board-row" onClick={() => void openDetail(item.post_id)}>
                  <div className="journal-board-row-left">
                    <span className="journal-badge journal-badge-compact" style={{ borderColor: item.header_color || "#5c6e7c", background: withAlpha(item.header_color || "#5c6e7c", 0.14) }}>{item.header_label}</span>
                  </div>
                  <div className="journal-board-row-main">
                    <strong title={fullTitle}>
                      {compactTitle}
                      {compactExcerpt ? <span className="journal-board-inline-divider"> : </span> : null}
                      {compactExcerpt ? <span className="journal-board-row-excerpt">{compactExcerpt}</span> : null}
                    </strong>
                    {linkedSummary ? <small>{linkedSummary}</small> : null}
                  </div>
                  <div className="journal-board-row-right"><small>{formatJournalBoardDate(item.created_at)}</small></div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="journal-gallery-grid board-mode">
            {items.map((item) => {
              const attachment = firstAttachment(item);
              const thumbUrl = attachment ? mediaUrl(attachment.path, attachment.url) : "";
              const youtubeThumbUrl = attachment?.media_type === "video" && isYouTubeUrl(thumbUrl) ? getYouTubeThumbnailUrl(thumbUrl) : "";
              return (
                <article key={item.post_id} className="record-post-card card journal-gallery-card" onClick={() => void openDetail(item.post_id)}>
                  <div className="journal-gallery-card-head"><span className="journal-badge" style={{ borderColor: item.header_color || "#5c6e7c", background: withAlpha(item.header_color || "#5c6e7c", 0.14) }}>{item.header_label}</span><small>{formatJournalBoardDate(item.created_at)}</small></div>
                  {attachment && thumbUrl ? attachment.media_type === "image" ? <img src={thumbUrl} alt={item.title} className="journal-gallery-cover" /> : attachment.media_type === "video" ? youtubeThumbUrl ? <div className="journal-gallery-youtube-wrap"><img src={youtubeThumbUrl} alt={item.title} className="journal-gallery-cover" /><span className="journal-gallery-youtube-badge">YouTube</span></div> : <video src={thumbUrl} className="journal-gallery-cover" muted /> : <div className="journal-gallery-audio">♪</div> : <div className="journal-gallery-text-cover">{excerptFromMarkdown(item.body || "", 84) || (lang === "ko" ? "텍스트 기록" : "Text note")}</div>}
                  <strong>{formatJournalBoardTitle(item.title, item.comment_count, lang === "ko" ? "무제" : "Untitled", 42)}</strong>
                  <p>{excerptFromMarkdown(item.body || "", 90)}</p>
                  <div className="journal-gallery-card-foot"><small>{buildLinkedSummary(item, lang) || (lang === "ko" ? "텍스트" : "Text")}</small></div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <JournalComposerModal open={composerOpen} lang={lang} busy={busySave} item={editingItem} catalogs={catalogs} tagCatalog={tagCatalog} headerCatalog={headerCatalog} templateCatalog={templateCatalog} onClose={() => { setComposerOpen(false); setEditingItem(null); }} onOpenManager={setManagerPanel} onSubmit={submitComposer} />

      <JournalDetailOverlay
        lang={lang}
        item={detailItem}
        loading={detailLoading}
        canPrev={canPrev}
        canNext={canNext}
        onClose={() => { setDetailPostId(""); setDetailItem(null); }}
        onPrev={() => { if (canPrev) void openDetail(items[detailIndex - 1].post_id); }}
        onNext={() => { if (canNext) void openDetail(items[detailIndex + 1].post_id); }}
        onEdit={(item) => { setEditingItem(item); setComposerOpen(true); setDetailPostId(""); setDetailItem(null); }}
        onDelete={async (item) => { await deletePost(item); }}
        onCreateComment={async (body, parentCommentId) => { if (!detailPostId) return; await createRecordComment(detailPostId, { body, parent_comment_id: parentCommentId }); await refreshDetail(); await loadItems(appliedFilters); }}
        onUpdateComment={async (commentId, body) => { if (!detailPostId) return; await updateRecordComment(detailPostId, commentId, { body }); await refreshDetail(); await loadItems(appliedFilters); }}
        onDeleteComment={async (commentId) => { if (!detailPostId) return; await deleteRecordComment(detailPostId, commentId); await refreshDetail(); await loadItems(appliedFilters); }}
      />

      <JournalManagerModal
        open={Boolean(managerPanel)}
        panel={managerPanel}
        lang={lang}
        tagCatalog={tagCatalog}
        headerCatalog={headerCatalog}
        templateCatalog={templateCatalog}
        onClose={() => setManagerPanel("")}
        onSave={async (payload) => {
          try {
            await saveManager(payload);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : lang === "ko" ? "관리 저장에 실패했습니다." : "Failed to save manager.");
          }
        }}
      />
    </div>
  );
}
