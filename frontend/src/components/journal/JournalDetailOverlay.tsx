import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../i18n";
import type { RecordComment, RecordPost } from "../../types/models";
import { JournalMarkdown } from "./JournalMarkdown";
import {
  clampCommentDepth,
  formatJournalDate,
  getYouTubeEmbedUrl,
  isYouTubeUrl,
  withAlpha,
} from "./journalUtils";

type DetailItem = RecordPost & { comments: RecordComment[] };

type Props = {
  lang: Lang;
  item: DetailItem | null;
  loading: boolean;
  canPrev: boolean;
  canNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEdit: (item: RecordPost) => void;
  onDelete: (item: RecordPost) => Promise<void>;
  onCreateComment: (body: string, parentCommentId?: string) => Promise<void>;
  onUpdateComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
};

function mediaUrl(path: string, url: string): string {
  if (url) return url;
  if (path) return `/media/${path}`;
  return "";
}

export function JournalDetailOverlay({
  lang,
  item,
  loading,
  canPrev,
  canNext,
  onClose,
  onPrev,
  onNext,
  onEdit,
  onDelete,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
}: Props) {
  const [replyTargetId, setReplyTargetId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [editCommentId, setEditCommentId] = useState("");
  const [editCommentBody, setEditCommentBody] = useState("");
  const [busyComment, setBusyComment] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const commentMap = useMemo(() => {
    const map = new Map<string, number>();
    (item?.comments || []).forEach((comment) => {
      if (comment.parent_comment_id) {
        map.set(comment.parent_comment_id, (map.get(comment.parent_comment_id) ?? 0) + 1);
      }
    });
    return map;
  }, [item?.comments]);

  const resetCommentEditor = () => {
    setReplyTargetId("");
    setCommentBody("");
    setEditCommentId("");
    setEditCommentBody("");
  };

  useEffect(() => {
    if (!item && !loading) {
      resetCommentEditor();
    }
  }, [item, loading]);

  useEffect(() => {
    if (item || loading) {
      modalRef.current?.focus();
    }
  }, [item, loading]);

  if (!item && !loading) return null;

  const submitComment = async () => {
    if (!commentBody.trim()) return;
    setBusyComment(true);
    try {
      await onCreateComment(commentBody, replyTargetId || undefined);
      setCommentBody("");
      setReplyTargetId("");
    } finally {
      setBusyComment(false);
    }
  };

  const submitCommentEdit = async () => {
    if (!editCommentId || !editCommentBody.trim()) return;
    setBusyComment(true);
    try {
      await onUpdateComment(editCommentId, editCommentBody);
      setEditCommentId("");
      setEditCommentBody("");
    } finally {
      setBusyComment(false);
    }
  };

  return (
    <div className="modal-backdrop journal-detail-backdrop" data-testid="journal-detail-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal journal-detail-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="journal-detail-head">
          <div className="journal-detail-head-main">
            <div className="journal-detail-pill-row">
              {item ? (
                <span
                  className="journal-badge"
                  style={{ borderColor: item.header_color || "#5c6e7c", background: withAlpha(item.header_color || "#5c6e7c", 0.14) }}
                >
                  {item.header_label || (lang === "ko" ? "기록" : "Entry")}
                </span>
              ) : null}
              <small className="muted">{item ? formatJournalDate(item.created_at) : lang === "ko" ? "불러오는 중..." : "Loading..."}</small>
              {item?.updated_at && item.updated_at !== item.created_at ? (
                <small className="muted">{lang === "ko" ? `수정 ${formatJournalDate(item.updated_at)}` : `Edited ${formatJournalDate(item.updated_at)}`}</small>
              ) : null}
            </div>
            <h2>{item?.title || (lang === "ko" ? "상세 보기" : "Detail")}</h2>
          </div>
          <div className="journal-detail-head-actions">
            <button className="ghost-btn compact-add-btn" onClick={onPrev} disabled={!canPrev || loading}>
              {lang === "ko" ? "이전 글" : "Prev"}
            </button>
            <button className="ghost-btn compact-add-btn" onClick={onNext} disabled={!canNext || loading}>
              {lang === "ko" ? "다음 글" : "Next"}
            </button>
            {item ? (
              <>
                <button className="ghost-btn" onClick={() => onEdit(item)}>
                  {lang === "ko" ? "수정" : "Edit"}
                </button>
                <button
                  className="ghost-btn danger-border"
                  onClick={async () => {
                    if (!window.confirm(lang === "ko" ? "이 게시글을 삭제할까요?" : "Delete this post?")) return;
                    await onDelete(item);
                  }}
                >
                  {lang === "ko" ? "삭제" : "Delete"}
                </button>
              </>
            ) : null}
            <button className="ghost-btn" onClick={onClose}>
              {lang === "ko" ? "닫기" : "Close"}
            </button>
          </div>
        </div>

        {loading || !item ? (
          <div className="journal-detail-loading">{lang === "ko" ? "불러오는 중..." : "Loading..."}</div>
        ) : (
          <div className="journal-detail-body">
            <div className="journal-detail-summary">
              {(item.linked_song_titles?.length || item.linked_drill_titles?.length) ? (
                <div className="journal-detail-summary-block">
                  <strong>{lang === "ko" ? "연결 항목" : "Linked"}</strong>
                  <p>
                    {(item.linked_song_titles || []).join(", ")}
                    {item.linked_song_titles?.length && item.linked_drill_titles?.length ? " / " : ""}
                    {(item.linked_drill_titles || []).join(", ")}
                  </p>
                </div>
              ) : null}
              {item.template_name ? (
                <div className="journal-detail-summary-block">
                  <strong>{lang === "ko" ? "템플릿" : "Template"}</strong>
                  <p>{item.template_name}</p>
                </div>
              ) : null}
              <div className="journal-detail-summary-block">
                <strong>{lang === "ko" ? "메모 흐름" : "Thread"}</strong>
                <p>{lang === "ko" ? `${item.comment_count}개 댓글` : `${item.comment_count} comments`}</p>
              </div>
            </div>

            {item.tags.length ? (
              <section className="journal-detail-tags card">
                <div className="row"><strong>{lang === "ko" ? "태그" : "Tags"}</strong></div>
                <div className="journal-chip-cloud">
                  {item.tags.map((tag) => (
                    <span key={tag} className="journal-badge subtle">{tag}</span>
                  ))}
                </div>
              </section>
            ) : null}

            {Object.values(item.meta || {}).some((value) => String(value || "").trim()) ? (
              <section className="journal-detail-meta card">
                <div className="row"><strong>{lang === "ko" ? "연습 메타" : "Practice Meta"}</strong></div>
                <div className="journal-detail-meta-grid">
                  {item.meta.practice_date ? <span><strong>{lang === "ko" ? "날짜" : "Date"}</strong>{item.meta.practice_date}</span> : null}
                  {item.meta.duration_min ? <span><strong>{lang === "ko" ? "시간" : "Duration"}</strong>{item.meta.duration_min}m</span> : null}
                  {item.meta.bpm ? <span><strong>BPM</strong>{String(item.meta.bpm)}</span> : null}
                  {item.meta.recording_kind ? <span><strong>{lang === "ko" ? "기록" : "Recording"}</strong>{String(item.meta.recording_kind)}</span> : null}
                  {item.meta.focus ? <span><strong>{lang === "ko" ? "포커스" : "Focus"}</strong>{String(item.meta.focus)}</span> : null}
                  {item.meta.today_win ? <span><strong>{lang === "ko" ? "잘 된 점" : "Win"}</strong>{String(item.meta.today_win)}</span> : null}
                  {item.meta.issue ? <span><strong>{lang === "ko" ? "이슈" : "Issue"}</strong>{String(item.meta.issue)}</span> : null}
                  {item.meta.next_action ? <span><strong>{lang === "ko" ? "다음 액션" : "Next"}</strong>{String(item.meta.next_action)}</span> : null}
                </div>
              </section>
            ) : null}

            <section className="journal-detail-content card">
              <JournalMarkdown body={item.body || ""} />
            </section>

            {item.attachments.length ? (
              <section className="journal-detail-media card">
                <div className="row"><strong>{lang === "ko" ? "첨부" : "Attachments"}</strong></div>
                <div className="journal-detail-media-grid">
                  {item.attachments.map((attachment) => {
                    const url = mediaUrl(attachment.path, attachment.url);
                    if (!url) return null;
                    if (attachment.media_type === "image") {
                      return (
                        <article key={attachment.attachment_id} className="journal-detail-media-item">
                          <img src={url} alt={attachment.title || item.title} className="journal-detail-thumb" />
                          {attachment.title ? <small>{attachment.title}</small> : null}
                        </article>
                      );
                    }
                    if (attachment.media_type === "video") {
                      const embedUrl = isYouTubeUrl(url) ? getYouTubeEmbedUrl(url) : "";
                      if (embedUrl) {
                        return (
                          <article key={attachment.attachment_id} className="journal-detail-media-item">
                            <iframe
                              src={embedUrl}
                              title={attachment.title || item.title || "YouTube"}
                              className="journal-youtube-frame"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                            <small>{attachment.title || url}</small>
                          </article>
                        );
                      }
                      return (
                        <article key={attachment.attachment_id} className="journal-detail-media-item">
                          <video src={url} className="journal-detail-thumb" controls />
                          {attachment.title ? <small>{attachment.title}</small> : null}
                        </article>
                      );
                    }
                    return (
                      <article key={attachment.attachment_id} className="journal-detail-media-item">
                        <audio src={url} controls />
                        {attachment.title ? <small>{attachment.title}</small> : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="journal-detail-comments card">
              <div className="row">
                <strong>{lang === "ko" ? "업데이트 스레드" : "Update Thread"}</strong>
                <small className="muted">{lang === "ko" ? `${item.comments.length}개` : `${item.comments.length}`}</small>
              </div>

              <div className="journal-comment-write-box">
                {replyTargetId ? (
                  <small className="muted">
                    {lang === "ko" ? "답글 작성 중" : "Replying"}
                    <button className="ghost-btn compact-add-btn" onClick={() => setReplyTargetId("")}>
                      {lang === "ko" ? "취소" : "Cancel"}
                    </button>
                  </small>
                ) : null}
                <textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  rows={3}
                  placeholder={lang === "ko" ? "후속 메모나 생각을 남겨보세요." : "Leave a follow-up note."}
                />
                <div className="journal-comment-write-actions">
                  <button className="primary-btn" disabled={busyComment || !commentBody.trim()} onClick={() => void submitComment()}>
                    {busyComment ? (lang === "ko" ? "저장 중..." : "Saving...") : lang === "ko" ? "댓글 등록" : "Post Comment"}
                  </button>
                </div>
              </div>

              <div className="journal-comment-list">
                {item.comments.map((comment) => {
                  const indentLevel = clampCommentDepth(comment.depth);
                  const hasChildren = (commentMap.get(comment.comment_id) ?? 0) > 0;
                  const isEditing = editCommentId === comment.comment_id;
                  return (
                    <article
                      key={comment.comment_id}
                      className={`journal-comment-row ${comment.deleted ? "is-deleted" : ""}`}
                      style={{ marginLeft: `${indentLevel * 18}px` }}
                    >
                      <div className="journal-comment-head">
                        <small>{formatJournalDate(comment.created_at)}</small>
                        {comment.updated_at && comment.updated_at !== comment.created_at ? <small>{lang === "ko" ? "수정됨" : "Edited"}</small> : null}
                      </div>
                      {isEditing ? (
                        <div className="journal-comment-edit-box">
                          <textarea value={editCommentBody} onChange={(event) => setEditCommentBody(event.target.value)} rows={3} />
                          <div className="journal-comment-edit-actions">
                            <button className="primary-btn" disabled={busyComment || !editCommentBody.trim()} onClick={() => void submitCommentEdit()}>
                              {lang === "ko" ? "저장" : "Save"}
                            </button>
                            <button className="ghost-btn" onClick={() => { setEditCommentId(""); setEditCommentBody(""); }}>
                              {lang === "ko" ? "취소" : "Cancel"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p>{comment.deleted ? (lang === "ko" ? "삭제된 댓글입니다." : "Deleted comment.") : comment.body}</p>
                      )}
                      <div className="journal-comment-actions">
                        <button className="ghost-btn compact-add-btn" onClick={() => setReplyTargetId(comment.comment_id)}>
                          {lang === "ko" ? "답글" : "Reply"}
                        </button>
                        {!comment.deleted ? (
                          <button className="ghost-btn compact-add-btn" onClick={() => { setEditCommentId(comment.comment_id); setEditCommentBody(comment.body); }}>
                            {lang === "ko" ? "수정" : "Edit"}
                          </button>
                        ) : null}
                        <button
                          className="ghost-btn compact-add-btn danger-border"
                          onClick={async () => {
                            if (!window.confirm(lang === "ko" ? (hasChildren ? "댓글 본문만 삭제할까요?" : "댓글을 삭제할까요?") : hasChildren ? "Soft-delete this comment?" : "Delete this comment?")) return;
                            await onDeleteComment(comment.comment_id);
                            if (editCommentId === comment.comment_id) {
                              setEditCommentId("");
                              setEditCommentBody("");
                            }
                          }}
                        >
                          {lang === "ko" ? "삭제" : "Delete"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
