import { useEffect, useMemo, useState } from "react";
import {
  createRecordComment,
  createRecordPost,
  deleteRecordComment,
  deleteRecordPost,
  getRecordPostDetail,
  getRecords,
  putBasicSettings,
  updateRecordComment,
  updateRecordPost,
} from "../api";
import { JournalComposerModal } from "../components/journal/JournalComposerModal";
import type { JournalComposerSubmitPayload } from "../components/journal/JournalComposerModal";
import { JournalDetailOverlay } from "../components/journal/JournalDetailOverlay";
import { JournalManagerModal } from "../components/journal/JournalManagerModal";
import { excerptFromMarkdown, formatJournalDate, getYouTubeThumbnailUrl, isYouTubeUrl, RECORD_VIEW_KEY, withAlpha } from "../components/journal/journalUtils";
import type { Lang } from "../i18n";
import type {
  JournalHeaderPreset,
  JournalStatusPreset,
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
type FilterDraft = {
  q: string;
  header_id: string;
  status_id: string;
  template_id: string;
  media_type: "all" | "image" | "video" | "audio";
  sort: SortMode;
};
type ManagerPanel = "" | "tags" | "headers" | "statuses" | "templates";
type DetailItem = RecordPost & { comments: RecordComment[] };

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

export function GalleryPage({ lang, catalogs, settings, onSettingsChange, onRefresh, setMessage }: Props) {
  const initialFilters = useMemo<FilterDraft>(
    () => ({ q: "", header_id: "", status_id: "", template_id: "", media_type: "all", sort: "created_desc" }),
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
    () => Array.isArray(settings.profile?.journal_tag_catalog) ? [...(settings.profile.journal_tag_catalog || [])].sort((a, b) => a.order - b.order) : [],
    [settings.profile?.journal_tag_catalog]
  );
  const headerCatalog = useMemo<JournalHeaderPreset[]>(
    () => Array.isArray(settings.profile?.journal_header_catalog) ? [...(settings.profile.journal_header_catalog || [])].sort((a, b) => a.order - b.order) : [],
    [settings.profile?.journal_header_catalog]
  );
  const statusCatalog = useMemo<JournalStatusPreset[]>(
    () => Array.isArray(settings.profile?.journal_status_catalog) ? [...(settings.profile.journal_status_catalog || [])].sort((a, b) => a.order - b.order) : [],
    [settings.profile?.journal_status_catalog]
  );
  const templateCatalog = useMemo<JournalTemplatePreset[]>(
    () => Array.isArray(settings.profile?.journal_template_catalog) ? [...(settings.profile.journal_template_catalog || [])].sort((a, b) => a.order - b.order) : [],
    [settings.profile?.journal_template_catalog]
  );

  const loadItems = async (filters: FilterDraft = appliedFilters) => {
    setLoading(true);
    try {
      const nextItems = await getRecords({
        limit: 1200,
        q: filters.q.trim(),
        header_id: filters.header_id,
        status_id: filters.status_id,
        template_id: filters.template_id,
        media_type: filters.media_type,
        sort: filters.sort,
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
    const next = { ...draftFilters, q: draftFilters.q.trim() };
    setAppliedFilters(next);
    await loadItems(next);
  };

  const resetFilters = async () => {
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
    await loadItems(initialFilters);
  };

  const submitComposer = async (payload: JournalComposerSubmitPayload, files: File[]) => {
    if (!payload.title.trim() && !payload.body.trim() && files.length === 0 && payload.external_attachments.length === 0) {
      setMessage(lang === "ko" ? "제목/본문/첨부 중 하나는 입력하세요." : "Fill title/body or add attachment.");
      return;
    }
    setBusySave(true);
    try {
      if (editingItem) await updateRecordPost(editingItem.post_id, payload, files);
      else await createRecordPost(payload, files);
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
    journal_status_catalog?: JournalStatusPreset[];
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

  return (
    <div className="page-grid journal-page-shell">
      <section className="card journal-header-board">
        <div className="journal-toolbar">
          <div className="journal-summary-inline">
            <strong>{lang === "ko" ? "기록장" : "Journal"}</strong>
            <small>{lang === "ko" ? `글 ${items.length}개` : `${items.length} posts`}</small>
            <small>{lang === "ko" ? `댓글 ${items.reduce((sum, item) => sum + item.comment_count, 0)}개` : `${items.reduce((sum, item) => sum + item.comment_count, 0)} comments`}</small>
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
          <label>{lang === "ko" ? "검색어" : "Search"}<input value={draftFilters.q} onChange={(event) => setDraftFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder={lang === "ko" ? "제목/본문/태그/메타 검색" : "Search title/body/tag/meta"} /></label>
          <label>{lang === "ko" ? "말머리" : "Header"}<select value={draftFilters.header_id} onChange={(event) => setDraftFilters((prev) => ({ ...prev, header_id: event.target.value }))}><option value="">{lang === "ko" ? "전체" : "All"}</option>{headerCatalog.filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          <label>{lang === "ko" ? "상태" : "Status"}<select value={draftFilters.status_id} onChange={(event) => setDraftFilters((prev) => ({ ...prev, status_id: event.target.value }))}><option value="">{lang === "ko" ? "전체" : "All"}</option>{statusCatalog.filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          <label>{lang === "ko" ? "템플릿" : "Template"}<select value={draftFilters.template_id} onChange={(event) => setDraftFilters((prev) => ({ ...prev, template_id: event.target.value }))}><option value="">{lang === "ko" ? "전체" : "All"}</option>{templateCatalog.filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>{lang === "ko" ? "미디어" : "Media"}<select value={draftFilters.media_type} onChange={(event) => setDraftFilters((prev) => ({ ...prev, media_type: event.target.value as FilterDraft["media_type"] }))}><option value="all">{lang === "ko" ? "전체" : "All"}</option><option value="image">{lang === "ko" ? "이미지" : "Image"}</option><option value="video">{lang === "ko" ? "영상" : "Video"}</option><option value="audio">{lang === "ko" ? "오디오" : "Audio"}</option></select></label>
          <label>{lang === "ko" ? "정렬" : "Sort"}<select value={draftFilters.sort} onChange={(event) => setDraftFilters((prev) => ({ ...prev, sort: event.target.value as SortMode }))}><option value="created_desc">{lang === "ko" ? "작성일 최신순" : "Newest Created"}</option><option value="updated_desc">{lang === "ko" ? "수정일 최신순" : "Latest Updated"}</option></select></label>
          <div className="journal-filter-actions">
            <button type="submit" className="primary-btn">{lang === "ko" ? "검색" : "Search"}</button>
            <button type="button" className="ghost-btn" onClick={() => void resetFilters()}>{lang === "ko" ? "초기화" : "Reset"}</button>
          </div>
        </form>
      </section>

      <section className="card journal-feed-card">
        <div className="row"><h2>{lang === "ko" ? "기록 게시판" : "Journal Board"}</h2><small className="muted">{loading ? (lang === "ko" ? "불러오는 중..." : "Loading...") : `${items.length}`}</small></div>
        {viewMode === "list" ? (
          <div className="journal-board-list">
            {items.map((item) => (
              <article key={item.post_id} className="journal-board-row" onClick={() => void openDetail(item.post_id)}>
                <div className="journal-board-row-left">
                  <span className="journal-badge" style={{ borderColor: item.header_color || "#5c6e7c", background: withAlpha(item.header_color || "#5c6e7c", 0.14) }}>{item.header_label}</span>
                  <span className="journal-badge subtle" style={{ borderColor: item.status_color || "#66727d", background: withAlpha(item.status_color || "#66727d", 0.12) }}>{item.status_label}</span>
                </div>
                <div className="journal-board-row-main">
                  <strong>{item.title || (lang === "ko" ? "무제" : "Untitled")}</strong>
                  <p>{excerptFromMarkdown(item.body || "", 120)}</p>
                  <div className="journal-board-row-meta">
                    {item.tags.length ? <small>{item.tags.slice(0, 3).join(" · ")}</small> : null}
                    {(item.linked_song_titles?.length || item.linked_drill_titles?.length) ? (
                      <small>
                        {(item.linked_song_titles || []).join(", ")}
                        {item.linked_song_titles?.length && item.linked_drill_titles?.length ? " / " : ""}
                        {(item.linked_drill_titles || []).join(", ")}
                      </small>
                    ) : null}
                    {item.attachments.length ? <small>{lang === "ko" ? `첨부 ${item.attachments.length}` : `${item.attachments.length} files`}</small> : null}
                    <small>{lang === "ko" ? `댓글 ${item.comment_count}` : `${item.comment_count} comments`}</small>
                  </div>
                </div>
                <div className="journal-board-row-right"><small>{formatJournalDate(item.created_at)}</small></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="journal-gallery-grid board-mode">
            {items.map((item) => {
              const attachment = firstAttachment(item);
              const thumbUrl = attachment ? mediaUrl(attachment.path, attachment.url) : "";
              const youtubeThumbUrl = attachment?.media_type === "video" && isYouTubeUrl(thumbUrl) ? getYouTubeThumbnailUrl(thumbUrl) : "";
              return (
                <article key={item.post_id} className="record-post-card card journal-gallery-card" onClick={() => void openDetail(item.post_id)}>
                  <div className="journal-gallery-card-head"><span className="journal-badge" style={{ borderColor: item.header_color || "#5c6e7c", background: withAlpha(item.header_color || "#5c6e7c", 0.14) }}>{item.header_label}</span><small>{formatJournalDate(item.created_at)}</small></div>
                  {attachment && thumbUrl ? attachment.media_type === "image" ? <img src={thumbUrl} alt={item.title} className="journal-gallery-cover" /> : attachment.media_type === "video" ? youtubeThumbUrl ? <div className="journal-gallery-youtube-wrap"><img src={youtubeThumbUrl} alt={item.title} className="journal-gallery-cover" /><span className="journal-gallery-youtube-badge">YouTube</span></div> : <video src={thumbUrl} className="journal-gallery-cover" muted /> : <div className="journal-gallery-audio">♪</div> : <div className="journal-gallery-text-cover">{excerptFromMarkdown(item.body || "", 84) || (lang === "ko" ? "텍스트 기록" : "Text note")}</div>}
                  <strong>{item.title || (lang === "ko" ? "무제" : "Untitled")}</strong>
                  <p>{excerptFromMarkdown(item.body || "", 90)}</p>
                  <div className="journal-gallery-card-foot"><span className="journal-badge subtle" style={{ borderColor: item.status_color || "#66727d", background: withAlpha(item.status_color || "#66727d", 0.12) }}>{item.status_label}</span><small>{lang === "ko" ? `댓글 ${item.comment_count}` : `${item.comment_count} comments`}</small></div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <JournalComposerModal open={composerOpen} lang={lang} busy={busySave} item={editingItem} catalogs={catalogs} tagCatalog={tagCatalog} headerCatalog={headerCatalog} statusCatalog={statusCatalog} templateCatalog={templateCatalog} onClose={() => { setComposerOpen(false); setEditingItem(null); }} onOpenManager={setManagerPanel} onSubmit={submitComposer} />

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
        statusCatalog={statusCatalog}
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
