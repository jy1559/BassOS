import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../i18n";
import type {
  JournalHeaderPreset,
  JournalStatusPreset,
  JournalTagPreset,
  JournalTemplatePreset,
  RecordPost,
} from "../../types/models";
import { JournalMarkdown } from "./JournalMarkdown";
import {
  emptyJournalMeta,
  filterSlashCommands,
  findSlashQuery,
  formatJournalDate,
  hasMeaningfulMeta,
  isYouTubeUrl,
  normalizeJournalMeta,
  serializeJournalMeta,
  type JournalMetaDraft,
  type SlashCommandSpec,
} from "./journalUtils";

type JournalExternalAttachmentInput = {
  media_type: "video";
  url: string;
  title: string;
  notes: string;
};

export type JournalComposerSubmitPayload = {
  title: string;
  body: string;
  post_type: string;
  header_id: string;
  status_id: string;
  template_id: string;
  meta: Record<string, unknown>;
  tags: string[];
  linked_song_ids: string[];
  linked_drill_ids: string[];
  free_targets: string[];
  source_context: string;
  external_attachments: JournalExternalAttachmentInput[];
};

type Props = {
  open: boolean;
  lang: Lang;
  busy: boolean;
  item: RecordPost | null;
  catalogs: {
    song_library: Array<Record<string, string>>;
    drill_library: Array<Record<string, string>>;
    drills: Array<Record<string, string>>;
  };
  tagCatalog: JournalTagPreset[];
  headerCatalog: JournalHeaderPreset[];
  statusCatalog: JournalStatusPreset[];
  templateCatalog: JournalTemplatePreset[];
  onClose: () => void;
  onOpenManager: (panel: "tags" | "headers" | "statuses" | "templates") => void;
  onSubmit: (payload: JournalComposerSubmitPayload, files: File[]) => Promise<void>;
};

type EditorTab = "write" | "preview";
type GroupedRows = {
  label: string;
  items: Array<Record<string, string>>;
};

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

function splitLooseTags(raw: string): string[] {
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

export function JournalComposerModal({
  open,
  lang,
  busy,
  item,
  catalogs,
  tagCatalog,
  headerCatalog,
  statusCatalog,
  templateCatalog,
  onClose,
  onOpenManager,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceContext, setSourceContext] = useState("practice");
  const [headerId, setHeaderId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [freeTags, setFreeTags] = useState("");
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [selectedDrillIds, setSelectedDrillIds] = useState<string[]>([]);
  const [selectedCatalogTagIds, setSelectedCatalogTagIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [videoLinks, setVideoLinks] = useState<string[]>([]);
  const [pendingVideoLink, setPendingVideoLink] = useState("");
  const [openSongGroups, setOpenSongGroups] = useState<string[]>([]);
  const [openDrillGroups, setOpenDrillGroups] = useState<string[]>([]);
  const [songSectionOpen, setSongSectionOpen] = useState(false);
  const [drillSectionOpen, setDrillSectionOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("write");
  const [metaDraft, setMetaDraft] = useState<JournalMetaDraft>(emptyJournalMeta());
  const [slashQuery, setSlashQuery] = useState("");
  const [slashCommands, setSlashCommands] = useState<SlashCommandSpec[]>([]);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTagCatalog = useMemo(
    () =>
      tagCatalog
        .filter((entry) => entry.active !== false && String(entry.label || "").trim())
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [tagCatalog]
  );
  const activeHeaderCatalog = useMemo(
    () => headerCatalog.filter((entry) => entry.active !== false).sort((a, b) => a.order - b.order),
    [headerCatalog]
  );
  const activeStatusCatalog = useMemo(
    () => statusCatalog.filter((entry) => entry.active !== false).sort((a, b) => a.order - b.order),
    [statusCatalog]
  );
  const activeTemplateCatalog = useMemo(
    () => templateCatalog.filter((entry) => entry.active !== false).sort((a, b) => a.order - b.order),
    [templateCatalog]
  );
  const mergedDrills = useMemo(
    () =>
      mergeDrills(catalogs.drills, catalogs.drill_library)
        .filter((row) => String(row.drill_id || "").trim())
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [catalogs.drill_library, catalogs.drills]
  );
  const groupedSongs = useMemo(
    () =>
      groupRows(
        catalogs.song_library
          .filter((row) => String(row.library_id || "").trim())
          .sort((a, b) => (a.title || "").localeCompare(b.title || "")),
        "genre",
        lang === "ko" ? "기타 장르" : "Other"
      ),
    [catalogs.song_library, lang]
  );
  const groupedDrills = useMemo(
    () => groupRows(mergedDrills, "area", lang === "ko" ? "기타 유형" : "Other"),
    [lang, mergedDrills]
  );
  const existingAttachmentCount = item?.attachments.length || 0;
  const maxNewAttachmentCount = Math.max(0, 8 - existingAttachmentCount);
  const newAttachmentCount = files.length + videoLinks.length;
  const remainingAttachmentSlots = Math.max(0, maxNewAttachmentCount - newAttachmentCount);

  const toggleInArray = (value: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const toggleGroup = (label: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  };

  const appendFiles = (incoming: File[]) => {
    if (!incoming.length || maxNewAttachmentCount <= 0) return;
    setFiles((prev) => {
      const next = [...prev];
      incoming.forEach((file) => {
        if (next.some((item) => item.name === file.name && item.size === file.size && item.type === file.type)) return;
        next.push(file);
      });
      return next.slice(0, maxNewAttachmentCount);
    });
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  useEffect(() => {
    if (!open) return;
    const nextHeaderId = item?.header_id || activeHeaderCatalog[0]?.id || headerCatalog[0]?.id || "";
    const nextStatusId = item?.status_id || activeStatusCatalog[0]?.id || statusCatalog[0]?.id || "";
    const nextSongIds = item?.linked_song_ids || [];
    const nextDrillIds = item?.linked_drill_ids || [];
    setTitle(item?.title || "");
    setBody(item?.body || "");
    setSourceContext(item?.source_context || "practice");
    setHeaderId(nextHeaderId);
    setStatusId(nextStatusId);
    setTemplateId(item?.template_id || "");
    setSelectedSongIds(nextSongIds);
    setSelectedDrillIds(nextDrillIds);
    setFiles([]);
    setVideoLinks([]);
    setPendingVideoLink("");
    setEditorTab("write");
    setMetaDraft(normalizeJournalMeta(item?.meta));
    const nextOpenSongGroups = groupedSongs
      .filter((group, index) => index < 2 || group.items.some((song) => nextSongIds.includes(String(song.library_id || ""))))
      .map((group) => group.label);
    const nextOpenDrillGroups = groupedDrills
      .filter((group, index) => index < 2 || group.items.some((drill) => nextDrillIds.includes(String(drill.drill_id || ""))))
      .map((group) => group.label);
    setOpenSongGroups(dedupeLabels(nextOpenSongGroups));
    setOpenDrillGroups(dedupeLabels(nextOpenDrillGroups));
    setSongSectionOpen(Boolean(nextSongIds.length));
    setDrillSectionOpen(Boolean(nextDrillIds.length));
    const selectedPresetIds = activeTagCatalog
      .filter((preset) => (item?.tags || []).some((tag) => tag.trim().toLowerCase() === preset.label.trim().toLowerCase()))
      .map((preset) => preset.id);
    setSelectedCatalogTagIds(selectedPresetIds);
    const knownLabels = new Set(
      activeTagCatalog
        .filter((preset) => selectedPresetIds.includes(preset.id))
        .map((preset) => preset.label.trim().toLowerCase())
    );
    const fallbackFreeTags = (item?.tags || []).filter((tag) => !knownLabels.has(tag.trim().toLowerCase()));
    setFreeTags(dedupeLabels([...(item?.free_targets || []), ...fallbackFreeTags]).join(", "));
  }, [
    activeHeaderCatalog,
    activeStatusCatalog,
    activeTagCatalog,
    groupedDrills,
    groupedSongs,
    headerCatalog,
    item,
    open,
    statusCatalog,
  ]);

  useEffect(() => {
    if (!open) return;
    const selectionStart = textareaRef.current?.selectionStart ?? body.length;
    const query = findSlashQuery(body, selectionStart);
    setSlashQuery(query);
    setSlashCommands(query ? filterSlashCommands(query) : []);
  }, [body, open]);

  useEffect(() => {
    if (!open) return;
    modalRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePaste = (event: ClipboardEvent) => {
      const active = document.activeElement;
      if (modalRef.current && active && !modalRef.current.contains(active)) return;
      const clipboardItems = Array.from(event.clipboardData?.items || []);
      const imageFiles = clipboardItems
        .filter((clipboardItem) => clipboardItem.kind === "file" && clipboardItem.type.startsWith("image/"))
        .map((clipboardItem) => clipboardItem.getAsFile())
        .filter((clipboardItem): clipboardItem is File => Boolean(clipboardItem));
      if (!imageFiles.length) return;
      event.preventDefault();
      appendFiles(
        imageFiles.map(
          (file, index) =>
            new File([file], file.name || `clipboard-image-${Date.now()}-${index}.png`, {
              type: file.type,
            })
        )
      );
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open]);

  if (!open) return null;

  const selectedTemplate = activeTemplateCatalog.find((template) => template.id === templateId) || null;
  const selectedCatalogLabels = selectedCatalogTagIds
    .map((id) => activeTagCatalog.find((row) => row.id === id)?.label || "")
    .filter(Boolean);
  const hasExistingAttachments = (item?.attachments || []).length > 0;
  const attachmentLimitMessage =
    lang === "ko"
      ? "기존 첨부를 포함해 게시글당 최대 8개까지 보관할 수 있습니다."
      : "You can keep up to 8 attachments per post, including existing ones.";

  const addVideoLink = () => {
    const trimmed = pendingVideoLink.trim();
    if (!trimmed || !isYouTubeUrl(trimmed)) return;
    if (newAttachmentCount >= maxNewAttachmentCount) {
      window.alert(attachmentLimitMessage);
      return;
    }
    setVideoLinks((prev) => dedupeLabels([...prev, trimmed]).slice(0, maxNewAttachmentCount));
    setPendingVideoLink("");
  };

  const applyTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    const template = activeTemplateCatalog.find((row) => row.id === nextTemplateId);
    if (!template) return;
    const dirty = Boolean(
      title.trim() ||
      body.trim() ||
      freeTags.trim() ||
      selectedSongIds.length ||
      selectedDrillIds.length ||
      files.length ||
      videoLinks.length ||
      hasMeaningfulMeta(metaDraft)
    );
    if (dirty && !window.confirm(lang === "ko" ? "현재 입력값 위에 템플릿을 적용할까요?" : "Apply template over current draft?")) {
      return;
    }
    setHeaderId(template.header_id);
    setStatusId(template.status_id);
    setBody(template.body_markdown);
    setSourceContext(template.default_source_context);
    setFreeTags(dedupeLabels(template.default_tags).join(", "));
  };

  const applySlashCommand = (command: SlashCommandSpec) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const head = body.slice(0, selectionStart);
    const lineStart = head.lastIndexOf("\n") + 1;
    const nextValue = `${body.slice(0, lineStart)}${command.snippet}${body.slice(selectionEnd)}`;
    setBody(nextValue);
    setSlashQuery("");
    setSlashCommands([]);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = lineStart + command.snippet.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const submit = async () => {
    const header = activeHeaderCatalog.find((row) => row.id === headerId) || headerCatalog.find((row) => row.id === headerId);
    const selectedHeaderLabel = header?.label || (lang === "ko" ? "자유기록" : "Record");
    const freeTagList = dedupeLabels(splitLooseTags(freeTags));
    const mergedTags = dedupeLabels([...selectedCatalogLabels, ...freeTagList]);
    if (!title.trim() && !body.trim() && files.length === 0 && videoLinks.length === 0) return;
    if (newAttachmentCount > maxNewAttachmentCount) {
      window.alert(attachmentLimitMessage);
      return;
    }
    await onSubmit(
      {
        title: title.trim(),
        body,
        post_type: selectedHeaderLabel,
        header_id: headerId,
        status_id: statusId,
        template_id: templateId,
        meta: serializeJournalMeta(metaDraft),
        tags: mergedTags,
        linked_song_ids: selectedSongIds,
        linked_drill_ids: selectedDrillIds,
        free_targets: freeTagList,
        source_context: sourceContext,
        external_attachments: videoLinks.map((url) => ({ media_type: "video", url, title: "", notes: "" })),
      },
      files
    );
  };

  return (
    <div className="modal-backdrop journal-composer-backdrop" data-testid="journal-composer-modal" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal journal-composer-modal"
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
        <div className="journal-composer-head">
          <div>
            <h2>{item ? (lang === "ko" ? "게시글 수정" : "Edit Post") : (lang === "ko" ? "새 기록 쓰기" : "Write Entry")}</h2>
            {item?.created_at ? <small className="muted">{formatJournalDate(item.created_at)}</small> : null}
          </div>
          <div className="journal-composer-head-actions">
            <button className="ghost-btn compact-add-btn" onClick={() => onOpenManager("headers")}>
              {lang === "ko" ? "말머리 관리" : "Headers"}
            </button>
            <button className="ghost-btn compact-add-btn" onClick={() => onOpenManager("statuses")}>
              {lang === "ko" ? "상태 관리" : "Statuses"}
            </button>
            <button className="ghost-btn compact-add-btn" onClick={() => onOpenManager("templates")}>
              {lang === "ko" ? "템플릿 관리" : "Templates"}
            </button>
            <button className="ghost-btn compact-add-btn" onClick={() => onOpenManager("tags")}>
              {lang === "ko" ? "태그 관리" : "Tags"}
            </button>
            <button className="ghost-btn" onClick={onClose}>
              {lang === "ko" ? "닫기" : "Close"}
            </button>
          </div>
        </div>

        <div className="journal-composer-layout">
          <section className="journal-composer-main">
            <div className="journal-composer-title-row">
              <label>
                {lang === "ko" ? "제목" : "Title"}
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
            </div>

            <div className="journal-composer-meta-row">
              <label>
                {lang === "ko" ? "말머리" : "Header"}
                <select value={headerId} onChange={(event) => setHeaderId(event.target.value)}>
                  {activeHeaderCatalog.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label>
                {lang === "ko" ? "상태" : "Status"}
                <select value={statusId} onChange={(event) => setStatusId(event.target.value)}>
                  {activeStatusCatalog.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label>
                {lang === "ko" ? "템플릿" : "Template"}
                <select value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
                  <option value="">{lang === "ko" ? "선택 안 함" : "None"}</option>
                  {activeTemplateCatalog.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </label>
              <label>
                {lang === "ko" ? "맥락" : "Context"}
                <select value={sourceContext} onChange={(event) => setSourceContext(event.target.value)}>
                  <option value="practice">{lang === "ko" ? "연습" : "Practice"}</option>
                  <option value="review">{lang === "ko" ? "회고" : "Review"}</option>
                  <option value="performance">{lang === "ko" ? "합주/공연" : "Performance"}</option>
                  <option value="archive">{lang === "ko" ? "아카이브" : "Archive"}</option>
                </select>
              </label>
            </div>

            {editorTab === "write" ? (
              <div className="journal-editor-wrap">
                <textarea
                  ref={textareaRef}
                  className="journal-editor-textarea"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={18}
                  placeholder={lang === "ko" ? "Markdown으로 작성하세요. /todo, /quote 같은 명령을 줄 시작에서 써도 됩니다." : "Write in Markdown. Use /todo or /quote at line start."}
                />
                {slashCommands.length ? (
                  <div className="journal-slash-menu">
                    {slashCommands.map((command) => (
                      <button key={command.id} className="ghost-btn journal-slash-item" onClick={() => applySlashCommand(command)}>
                        <strong>{command.label}</strong>
                        <small>{command.keywords.join(" · ")}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="journal-editor-preview card">
                <JournalMarkdown body={body || (selectedTemplate?.body_markdown || "")} />
              </div>
            )}

            <section className="card journal-composer-inline-card">
              <div className="row journal-upload-head">
                <div className="journal-upload-head-title">
                  <strong>{lang === "ko" ? "첨부" : "Attachments"}</strong>
                  <small className="muted">
                    {lang === "ko" ? "이미지 업로드/붙여넣기, 영상 업로드/유튜브 링크, 오디오 업로드" : "Image upload/paste, video upload/YouTube link, audio upload"}
                  </small>
                </div>
                <div className="journal-upload-head-actions">
                  <button className="ghost-btn compact-add-btn" onClick={() => setEditorTab((prev) => (prev === "write" ? "preview" : "write"))}>
                    {editorTab === "write" ? (lang === "ko" ? "미리보기" : "Preview") : (lang === "ko" ? "작성" : "Write")}
                  </button>
                  <button className="ghost-btn compact-add-btn" disabled={maxNewAttachmentCount <= 0} onClick={() => fileInputRef.current?.click()}>
                    {lang === "ko" ? "첨부 추가" : "Add Files"}
                  </button>
                </div>
              </div>
              {hasExistingAttachments ? (
                <small className="muted">
                  {lang === "ko" ? `기존 첨부 ${item?.attachments.length}개는 유지됩니다.` : `${item?.attachments.length} existing attachments will be kept.`}
                </small>
              ) : null}
              <small className="muted">
                {lang === "ko"
                  ? `새로 추가 가능 ${remainingAttachmentSlots}개 / 총 8개 한도`
                  : `${remainingAttachmentSlots} new slots left / 8 total max`}
              </small>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept="image/*,video/*,audio/*"
                onChange={(event) => {
                  appendFiles(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              <div className="journal-upload-zone">
                <div className="journal-upload-inline-meta">
                  <small className="muted">
                    {lang === "ko" ? "이미지는 Ctrl+V로 바로 붙여넣을 수 있습니다." : "Paste images directly with Ctrl+V."}
                  </small>
                  <small className="muted">
                    {lang === "ko" ? `새 첨부 ${newAttachmentCount}/${maxNewAttachmentCount}` : `${newAttachmentCount}/${maxNewAttachmentCount} new`}
                  </small>
                </div>
                <div className="journal-link-input-row">
                  <input
                    value={pendingVideoLink}
                    onChange={(event) => setPendingVideoLink(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addVideoLink();
                      }
                    }}
                    placeholder={lang === "ko" ? "유튜브 링크 추가" : "Add YouTube link"}
                  />
                  <button className="ghost-btn compact-add-btn" onClick={addVideoLink} disabled={!isYouTubeUrl(pendingVideoLink) || remainingAttachmentSlots <= 0}>
                    {lang === "ko" ? "링크 추가" : "Add Link"}
                  </button>
                </div>
              </div>
              <div className="journal-upload-list">
                {files.map((file, index) => (
                  <div key={`${file.name}_${file.size}_${index}`} className="journal-upload-item">
                    <span>{file.name}</span>
                    <small>{file.type || (lang === "ko" ? "파일" : "File")}</small>
                    <button className="ghost-btn compact-add-btn" onClick={() => removeFileAt(index)}>
                      {lang === "ko" ? "제거" : "Remove"}
                    </button>
                  </div>
                ))}
                {videoLinks.map((url, index) => (
                  <div key={url} className="journal-upload-item">
                    <span>{lang === "ko" ? `유튜브 링크 ${index + 1}` : `YouTube Link ${index + 1}`}</span>
                    <small>{url}</small>
                    <button className="ghost-btn compact-add-btn" onClick={() => setVideoLinks((prev) => prev.filter((item) => item !== url))}>
                      {lang === "ko" ? "제거" : "Remove"}
                    </button>
                  </div>
                ))}
                {!files.length && !videoLinks.length ? (
                  <small className="muted">{lang === "ko" ? "새 첨부 없음" : "No new attachments"}</small>
                ) : null}
              </div>
            </section>
          </section>

          <aside className="journal-composer-side">
            <section className="card journal-composer-side-card">
              <div className="row"><strong>{lang === "ko" ? "연습 메타" : "Practice Meta"}</strong></div>
              <div className="journal-meta-grid">
                <label>{lang === "ko" ? "날짜" : "Date"}<input type="date" value={metaDraft.practice_date} onChange={(event) => setMetaDraft((prev) => ({ ...prev, practice_date: event.target.value }))} /></label>
                <label>{lang === "ko" ? "시간(분)" : "Minutes"}<input value={metaDraft.duration_min} onChange={(event) => setMetaDraft((prev) => ({ ...prev, duration_min: event.target.value }))} /></label>
                <label>BPM<input value={metaDraft.bpm} onChange={(event) => setMetaDraft((prev) => ({ ...prev, bpm: event.target.value }))} /></label>
                <label>{lang === "ko" ? "기록 종류" : "Recording"}<input value={metaDraft.recording_kind} onChange={(event) => setMetaDraft((prev) => ({ ...prev, recording_kind: event.target.value }))} placeholder={lang === "ko" ? "audio / video" : "audio / video"} /></label>
                <label>{lang === "ko" ? "포커스" : "Focus"}<input value={metaDraft.focus} onChange={(event) => setMetaDraft((prev) => ({ ...prev, focus: event.target.value }))} /></label>
                <label>{lang === "ko" ? "잘 된 점" : "Win"}<input value={metaDraft.today_win} onChange={(event) => setMetaDraft((prev) => ({ ...prev, today_win: event.target.value }))} /></label>
                <label>{lang === "ko" ? "이슈" : "Issue"}<input value={metaDraft.issue} onChange={(event) => setMetaDraft((prev) => ({ ...prev, issue: event.target.value }))} /></label>
                <label>{lang === "ko" ? "다음 액션" : "Next Action"}<input value={metaDraft.next_action} onChange={(event) => setMetaDraft((prev) => ({ ...prev, next_action: event.target.value }))} /></label>
              </div>
            </section>

            <section className="card journal-composer-side-card">
              <div className="row">
                <strong>{lang === "ko" ? "태그" : "Tags"}</strong>
                <button className="ghost-btn compact-add-btn" onClick={() => onOpenManager("tags")}>
                  {lang === "ko" ? "관리" : "Manage"}
                </button>
              </div>
              <div className="journal-chip-cloud">
                {activeTagCatalog.map((row) => {
                  const selected = selectedCatalogTagIds.includes(row.id);
                  return (
                    <button
                      key={row.id}
                      className={`achievement-chip journal-select-tag ${selected ? "is-selected" : ""}`}
                      onClick={() => toggleInArray(row.id, selectedCatalogTagIds, setSelectedCatalogTagIds)}
                    >
                      {row.label}
                    </button>
                  );
                })}
              </div>
              <label>
                {lang === "ko" ? "자유 태그" : "Free Tags"}
                <input value={freeTags} onChange={(event) => setFreeTags(event.target.value)} placeholder={lang === "ko" ? "쉼표로 구분" : "Comma separated"} />
              </label>
            </section>

            <section className="card journal-composer-side-card">
              <button className="ghost-btn journal-link-section-toggle" aria-expanded={songSectionOpen} onClick={() => setSongSectionOpen((prev) => !prev)}>
                <span className="journal-link-group-title">
                  <strong>{lang === "ko" ? "연결 곡" : "Linked Songs"}</strong>
                  <small>{lang === "ko" ? "필요할 때만 펼쳐서 선택" : "Open only when needed"}</small>
                </span>
                <span className="journal-link-group-meta">
                  <small>{selectedSongIds.length}</small>
                  <strong>{songSectionOpen ? "−" : "+"}</strong>
                </span>
              </button>
              {songSectionOpen ? (
                <div className="journal-link-groups">
                  {groupedSongs.map((group) => {
                    const selectedCount = group.items.filter((song) => selectedSongIds.includes(String(song.library_id || ""))).length;
                    const openGroup = openSongGroups.includes(group.label);
                    return (
                      <section key={group.label} className="journal-link-group">
                        <button className="ghost-btn journal-link-group-toggle" aria-expanded={openGroup} onClick={() => toggleGroup(group.label, openSongGroups, setOpenSongGroups)}>
                          <span className="journal-link-group-title">
                            <strong>{group.label}</strong>
                            <small>{lang === "ko" ? "곡 장르" : "Song Genre"}</small>
                          </span>
                          <span className="journal-link-group-meta">
                            <small>{selectedCount}/{group.items.length}</small>
                            <strong>{openGroup ? "−" : "+"}</strong>
                          </span>
                        </button>
                        {openGroup ? (
                          <div className="journal-link-scroll">
                            {group.items.map((song) => (
                              <label key={song.library_id} className="inline selectable-row journal-link-row">
                                <input type="checkbox" checked={selectedSongIds.includes(song.library_id)} onChange={() => toggleInArray(song.library_id, selectedSongIds, setSelectedSongIds)} />
                                <span>
                                  <strong>{song.title || song.library_id}</strong>
                                  <small>{[song.artist, song.status].filter(Boolean).join(" · ") || song.library_id}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="card journal-composer-side-card">
              <button className="ghost-btn journal-link-section-toggle" aria-expanded={drillSectionOpen} onClick={() => setDrillSectionOpen((prev) => !prev)}>
                <span className="journal-link-group-title">
                  <strong>{lang === "ko" ? "연결 드릴" : "Linked Drills"}</strong>
                  <small>{lang === "ko" ? "필요할 때만 펼쳐서 선택" : "Open only when needed"}</small>
                </span>
                <span className="journal-link-group-meta">
                  <small>{selectedDrillIds.length}</small>
                  <strong>{drillSectionOpen ? "−" : "+"}</strong>
                </span>
              </button>
              {drillSectionOpen ? (
                <div className="journal-link-groups">
                  {groupedDrills.map((group) => {
                    const selectedCount = group.items.filter((drill) => selectedDrillIds.includes(String(drill.drill_id || ""))).length;
                    const openGroup = openDrillGroups.includes(group.label);
                    return (
                      <section key={group.label} className="journal-link-group">
                        <button className="ghost-btn journal-link-group-toggle" aria-expanded={openGroup} onClick={() => toggleGroup(group.label, openDrillGroups, setOpenDrillGroups)}>
                          <span className="journal-link-group-title">
                            <strong>{group.label}</strong>
                            <small>{lang === "ko" ? "드릴 유형" : "Drill Type"}</small>
                          </span>
                          <span className="journal-link-group-meta">
                            <small>{selectedCount}/{group.items.length}</small>
                            <strong>{openGroup ? "−" : "+"}</strong>
                          </span>
                        </button>
                        {openGroup ? (
                          <div className="journal-link-scroll">
                            {group.items.map((drill) => (
                              <label key={drill.drill_id} className="inline selectable-row journal-link-row">
                                <input type="checkbox" checked={selectedDrillIds.includes(drill.drill_id)} onChange={() => toggleInArray(drill.drill_id, selectedDrillIds, setSelectedDrillIds)} />
                                <span>
                                  <strong>{drill.name || drill.drill_id}</strong>
                                  <small>{[drill.area, drill.tags].filter(Boolean).join(" · ") || drill.drill_id}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </section>
          </aside>
        </div>

        <div className="modal-actions journal-composer-footer">
          <button className="primary-btn" disabled={busy || (!title.trim() && !body.trim() && files.length === 0 && videoLinks.length === 0)} onClick={() => void submit()}>
            {busy ? (lang === "ko" ? "저장 중..." : "Saving...") : item ? (lang === "ko" ? "수정 저장" : "Save Changes") : (lang === "ko" ? "게시글 등록" : "Publish")}
          </button>
          <button className="ghost-btn" onClick={onClose}>
            {lang === "ko" ? "취소" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
