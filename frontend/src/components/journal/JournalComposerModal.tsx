import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../i18n";
import type {
  JournalHeaderPreset,
  JournalTagPreset,
  JournalTemplatePreset,
  RecordAttachment,
  RecordPost,
} from "../../types/models";
import { JournalMarkdown } from "./JournalMarkdown";
import {
  buildAttachmentEmbedToken,
  excerptFromMarkdown,
  filterSlashCommands,
  findSlashQuery,
  formatJournalDate,
  getYouTubeThumbnailUrl,
  isYouTubeUrl,
  resolveRecordAttachmentUrl,
  type SlashCommandSpec,
} from "./journalUtils";

type JournalExternalAttachmentInput = {
  media_type: "video";
  url: string;
};

type JournalFileAttachmentInput = Record<string, never>;

type JournalAttachmentUpdateInput = {
  attachment_id: string;
  title: string;
  notes: string;
};

export type JournalComposerSubmitPayload = {
  title: string;
  body: string;
  post_type: string;
  header_id: string;
  template_id: string;
  meta: Record<string, unknown>;
  tags: string[];
  linked_song_ids: string[];
  linked_drill_ids: string[];
  free_targets: string[];
  file_attachments: JournalFileAttachmentInput[];
  external_attachments: JournalExternalAttachmentInput[];
  attachment_updates: JournalAttachmentUpdateInput[];
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
  templateCatalog: JournalTemplatePreset[];
  onClose: () => void;
  onOpenManager: (panel: "tags" | "headers" | "templates") => void;
  onSubmit: (payload: JournalComposerSubmitPayload, files: File[]) => Promise<void>;
};

type EditorTab = "write" | "preview";
type GroupedRows = {
  label: string;
  items: Array<Record<string, string>>;
};

type ExistingAttachmentDraft = RecordAttachment & {
  local_id: string;
};

type FileAttachmentDraft = {
  local_id: string;
  file: File;
  media_type: "image" | "video" | "audio";
  preview_url: string;
};

type ExternalAttachmentDraft = {
  local_id: string;
  media_type: "video";
  url: string;
};

type TemplatePickerProps = {
  open: boolean;
  lang: Lang;
  selectedTemplateId: string;
  templates: JournalTemplatePreset[];
  headers: JournalHeaderPreset[];
  onClose: () => void;
  onPick: (templateId: string) => void;
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

function nextAttachmentDraftId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferAttachmentMediaType(file: File): "image" | "video" | "audio" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "audio";
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

function attachmentKindLabel(mediaType: "image" | "video" | "audio", lang: Lang): string {
  if (mediaType === "video") return lang === "ko" ? "영상" : "Video";
  if (mediaType === "audio") return lang === "ko" ? "오디오" : "Audio";
  return lang === "ko" ? "이미지" : "Image";
}

function attachmentShortLabel(mediaType: "image" | "video" | "audio"): string {
  if (mediaType === "video") return "V";
  if (mediaType === "audio") return "A";
  return "I";
}

function attachmentTitle(order: number, mediaType: "image" | "video" | "audio", lang: Lang): string {
  return `${attachmentKindLabel(mediaType, lang)} #${order}`;
}

function TemplatePickerModal({
  open,
  lang,
  selectedTemplateId,
  templates,
  headers,
  onClose,
  onPick,
}: TemplatePickerProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    modalRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const headerMap = new Map(headers.map((row) => [row.id, row]));

  return (
    <div className="modal-backdrop journal-template-picker-backdrop" data-testid="journal-template-picker" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal journal-template-picker-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="journal-template-picker-head">
          <div>
            <h3>{lang === "ko" ? "템플릿 사용" : "Use Template"}</h3>
            <small className="muted">
              {lang === "ko" ? "카드 형태로 템플릿 미리보기를 보고 적용하세요." : "Pick a template from the gallery preview."}
            </small>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            {lang === "ko" ? "닫기" : "Close"}
          </button>
        </div>
        <div className="journal-template-picker-grid">
          {templates.map((template) => {
            const header = headerMap.get(template.header_id);
            const preview = template.body_markdown.trim() || (lang === "ko" ? "본문 예시가 없습니다." : "No body preview.");
            return (
              <article key={template.id} className={`journal-template-picker-card ${template.id === selectedTemplateId ? "is-selected" : ""}`}>
                <div className="journal-template-picker-meta">
                  {header ? <span className="journal-badge subtle">{header.label}</span> : null}
                </div>
                <div className="journal-template-picker-copy">
                  <strong>{template.name}</strong>
                  <p>{template.description || excerptFromMarkdown(preview, 96)}</p>
                </div>
                {template.default_tags.length ? (
                  <div className="journal-chip-cloud">
                    {template.default_tags.slice(0, 4).map((tag) => (
                      <span key={`${template.id}_${tag}`} className="journal-badge subtle">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="journal-template-picker-preview">
                  <JournalMarkdown body={preview} fallbackTitle={template.name} />
                </div>
                <button type="button" className="primary-btn" data-testid={`journal-template-pick-${template.id}`} onClick={() => onPick(template.id)}>
                  {lang === "ko" ? "이 템플릿 사용" : "Use This Template"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function JournalComposerModal({
  open,
  lang,
  busy,
  item,
  catalogs,
  tagCatalog,
  headerCatalog,
  templateCatalog,
  onClose,
  onOpenManager,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [headerId, setHeaderId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [freeTags, setFreeTags] = useState("");
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [selectedDrillIds, setSelectedDrillIds] = useState<string[]>([]);
  const [selectedCatalogTagIds, setSelectedCatalogTagIds] = useState<string[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<ExistingAttachmentDraft[]>([]);
  const [fileAttachments, setFileAttachments] = useState<FileAttachmentDraft[]>([]);
  const [videoAttachments, setVideoAttachments] = useState<ExternalAttachmentDraft[]>([]);
  const [pendingVideoLink, setPendingVideoLink] = useState("");
  const [openSongGroups, setOpenSongGroups] = useState<string[]>([]);
  const [openDrillGroups, setOpenDrillGroups] = useState<string[]>([]);
  const [songSectionOpen, setSongSectionOpen] = useState(false);
  const [drillSectionOpen, setDrillSectionOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("write");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashCommands, setSlashCommands] = useState<SlashCommandSpec[]>([]);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileAttachmentsRef = useRef<FileAttachmentDraft[]>([]);

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
  const activeTemplateCatalog = useMemo(
    () => templateCatalog.filter((entry) => entry.active !== false).sort((a, b) => a.order - b.order),
    [templateCatalog]
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
  const existingAttachmentCount = item?.attachments.length || 0;
  const maxNewAttachmentCount = Math.max(0, 8 - existingAttachmentCount);
  const newAttachmentCount = fileAttachments.length + videoAttachments.length;
  const remainingAttachmentSlots = Math.max(0, maxNewAttachmentCount - newAttachmentCount);
  const previewAttachments = useMemo<RecordAttachment[]>(
    () => [
      ...existingAttachments.map((attachment, index) => ({
        ...attachment,
        sort_order: index + 1,
      })),
      ...fileAttachments.map((attachment, index) => ({
        attachment_id: attachment.local_id,
        post_id: item?.post_id || "",
        created_at: item?.created_at || "",
        media_type: attachment.media_type,
        path: "",
        url: "",
        preview_url: attachment.preview_url,
        sort_order: existingAttachments.length + index + 1,
      })),
      ...videoAttachments.map((attachment, index) => ({
        attachment_id: attachment.local_id,
        post_id: item?.post_id || "",
        created_at: item?.created_at || "",
        media_type: "video" as const,
        path: "",
        url: attachment.url,
        sort_order: existingAttachments.length + fileAttachments.length + index + 1,
      })),
    ],
    [existingAttachments, fileAttachments, item?.created_at, item?.post_id, videoAttachments]
  );

  const toggleInArray = (value: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const toggleGroup = (label: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  };

  const revokeFileDrafts = (drafts: FileAttachmentDraft[]) => {
    drafts.forEach((draft) => {
      if (draft.preview_url) URL.revokeObjectURL(draft.preview_url);
    });
  };

  const appendFiles = (incoming: File[]) => {
    if (!incoming.length || maxNewAttachmentCount <= 0) return;
    setFileAttachments((prev) => {
      const next = [...prev];
      incoming.forEach((file) => {
        if (next.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.type === file.type)) return;
        next.push({
          local_id: nextAttachmentDraftId("file"),
          file,
          media_type: inferAttachmentMediaType(file),
          preview_url: URL.createObjectURL(file),
        });
      });
      const limited = next.slice(0, maxNewAttachmentCount);
      revokeFileDrafts(next.slice(maxNewAttachmentCount));
      return limited;
    });
  };

  const removeFile = (localId: string) => {
    setFileAttachments((prev) => {
      const target = prev.find((item) => item.local_id === localId);
      if (target?.preview_url) URL.revokeObjectURL(target.preview_url);
      return prev.filter((item) => item.local_id !== localId);
    });
  };

  const removeVideoLink = (localId: string) => {
    setVideoAttachments((prev) => prev.filter((attachment) => attachment.local_id !== localId));
  };

  const insertTextAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setBody((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}${text}`);
      return;
    }
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const nextValue = `${body.slice(0, selectionStart)}${text}${body.slice(selectionEnd)}`;
    setBody(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = selectionStart + text.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const insertAttachmentEmbed = (index: number, size: "small" | "medium" | "large") => {
    insertTextAtCursor(`${body && !body.endsWith("\n") ? "\n" : ""}${buildAttachmentEmbedToken(index, size)}\n`);
  };

  const renderAttachmentPreview = (attachment: {
    media_type: "image" | "video" | "audio";
    preview_url?: string;
    path?: string;
    url?: string;
    title?: string;
    file_name?: string;
  }, order: number) => {
    const url = resolveRecordAttachmentUrl(attachment);
    if (attachment.media_type === "image" && url) {
      return <img src={url} alt={attachment.title || attachment.file_name || attachmentTitle(order, "image", lang)} className="journal-upload-preview" />;
    }
    if (attachment.media_type === "video" && url) {
      const youtubeThumbnail = isYouTubeUrl(url) ? getYouTubeThumbnailUrl(url) : "";
      if (youtubeThumbnail) {
        return (
          <div className="journal-upload-preview-stack">
            <img src={youtubeThumbnail} alt={attachmentTitle(order, "video", lang)} className="journal-upload-preview" />
            <span className="journal-upload-preview-badge">YouTube</span>
          </div>
        );
      }
      return <video src={url} className="journal-upload-preview" muted preload="metadata" playsInline />;
    }
    if (attachment.media_type === "audio") {
      return (
        <div className="journal-upload-preview journal-upload-preview-fallback journal-upload-preview-audio">
          <strong>{lang === "ko" ? "오디오" : "Audio"}</strong>
        </div>
      );
    }
    return (
      <div className="journal-upload-preview journal-upload-preview-fallback">
        <strong>{attachment.file_name || attachmentKindLabel(attachment.media_type, lang)}</strong>
      </div>
    );
  };

  useEffect(() => {
    fileAttachmentsRef.current = fileAttachments;
  }, [fileAttachments]);

  useEffect(() => {
    if (!open) return;
    const nextHeaderId = item?.header_id || activeHeaderCatalog[0]?.id || headerCatalog[0]?.id || "";
    const nextSongIds = item?.linked_song_ids || [];
    const nextDrillIds = item?.linked_drill_ids || [];
    setTitle(item?.title || "");
    setBody(item?.body || "");
    setHeaderId(nextHeaderId);
    setTemplateId(item?.template_id || "");
    setSelectedSongIds(nextSongIds);
    setSelectedDrillIds(nextDrillIds);
    setExistingAttachments(
      (item?.attachments || []).map((attachment, index) => ({
        ...attachment,
        local_id: `existing_${attachment.attachment_id || index}`,
      }))
    );
    setFileAttachments((prev) => {
      revokeFileDrafts(prev);
      return [];
    });
    setVideoAttachments([]);
    setPendingVideoLink("");
    setEditorTab("write");
    setTemplatePickerOpen(false);
    setOpenSongGroups([]);
    setOpenDrillGroups([]);
    setSongSectionOpen(false);
    setDrillSectionOpen(false);
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
    activeTagCatalog,
    groupedDrills,
    groupedSongs,
    headerCatalog,
    item,
    open,
  ]);

  useEffect(
    () => () => {
      revokeFileDrafts(fileAttachmentsRef.current);
    },
    []
  );

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
  const hasExistingAttachments = existingAttachments.length > 0;
  const attachmentLimitMessage =
    lang === "ko"
      ? "기존 첨부를 포함해 게시글당 최대 8개까지 보관할 수 있습니다."
      : "You can keep up to 8 attachments per post, including existing ones.";
  const currentTemplatePreview =
    selectedTemplate?.description ||
    excerptFromMarkdown(selectedTemplate?.body_markdown || "", 110) ||
    (lang === "ko" ? "아직 템플릿을 선택하지 않았습니다." : "No template selected yet.");

  const addVideoLink = () => {
    const trimmed = pendingVideoLink.trim();
    if (!trimmed || !isYouTubeUrl(trimmed)) return;
    if (newAttachmentCount >= maxNewAttachmentCount) {
      window.alert(attachmentLimitMessage);
      return;
    }
    setVideoAttachments((prev) =>
      [
        ...prev,
        {
          local_id: nextAttachmentDraftId("youtube"),
          media_type: "video" as const,
          url: trimmed,
        },
      ].slice(0, maxNewAttachmentCount)
    );
    setPendingVideoLink("");
  };

  const applyTemplate = (nextTemplateId: string) => {
    const template = activeTemplateCatalog.find((row) => row.id === nextTemplateId);
    if (!template) return;
    const dirty = Boolean(
      title.trim() ||
      body.trim() ||
      freeTags.trim() ||
      selectedSongIds.length ||
      selectedDrillIds.length ||
      fileAttachments.length ||
      videoAttachments.length
    );
    if (dirty && !window.confirm(lang === "ko" ? "현재 입력값 위에 템플릿을 적용할까요?" : "Apply template over current draft?")) {
      return;
    }
    setTemplateId(nextTemplateId);
    setHeaderId(template.header_id);
    setBody(template.body_markdown);
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
    if (!title.trim() && !body.trim() && fileAttachments.length === 0 && videoAttachments.length === 0 && existingAttachments.length === 0) return;
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
        template_id: templateId,
        meta: {},
        tags: mergedTags,
        linked_song_ids: selectedSongIds,
        linked_drill_ids: selectedDrillIds,
        free_targets: freeTagList,
        file_attachments: fileAttachments.map(() => ({})),
        external_attachments: videoAttachments.map((attachment) => ({
          media_type: "video",
          url: attachment.url,
        })),
        attachment_updates: [],
      },
      fileAttachments.map((attachment) => attachment.file)
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
            if (templatePickerOpen) {
              setTemplatePickerOpen(false);
              return;
            }
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
            <button type="button" className="ghost-btn" onClick={onClose}>
              {lang === "ko" ? "닫기" : "Close"}
            </button>
          </div>
        </div>

        <div className="journal-composer-layout">
          <section className="journal-composer-main">
            <div className="journal-composer-title-row">
              <label className="journal-composer-header-inline">
                <small>{lang === "ko" ? "말머리" : "Header"}</small>
                <select value={headerId} onChange={(event) => setHeaderId(event.target.value)}>
                  {activeHeaderCatalog.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label className="journal-composer-title-field">
                <span>{lang === "ko" ? "제목" : "Title"}</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <div className="journal-composer-title-actions">
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => setTemplatePickerOpen(true)}>
                  {lang === "ko" ? "템플릿 사용" : "Use Template"}
                </button>
              </div>
            </div>
            {selectedTemplate ? (
              <small className="muted journal-template-inline-summary">
                {`${selectedTemplate.name} · ${currentTemplatePreview}`}
              </small>
            ) : null}
            {editorTab === "write" ? (
              <div className="journal-editor-wrap">
                <textarea
                  ref={textareaRef}
                  className="journal-editor-textarea"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={18}
                  placeholder={
                    lang === "ko"
                      ? "Markdown으로 작성하세요. 첨부 카드의 S/M/L 버튼으로 본문에 바로 넣을 수 있습니다."
                      : "Write in Markdown. Use the S/M/L attachment buttons to insert media into the body."
                  }
                />
                {slashCommands.length ? (
                  <div className="journal-slash-menu">
                    {slashCommands.map((command) => (
                      <button type="button" key={command.id} className="ghost-btn journal-slash-item" onClick={() => applySlashCommand(command)}>
                        <strong>{command.label}</strong>
                        <small>{command.keywords.join(" · ")}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="journal-editor-preview card">
                <JournalMarkdown
                  body={body || (selectedTemplate?.body_markdown || "")}
                  attachments={previewAttachments}
                  fallbackTitle={title || selectedTemplate?.name || ""}
                />
              </div>
            )}

          </section>

          <aside className="journal-composer-side">
            <section className="card journal-composer-side-card">
              <div className="row">
                <strong>{lang === "ko" ? "태그" : "Tags"}</strong>
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => onOpenManager("tags")}>
                  {lang === "ko" ? "태그 관리" : "Tags"}
                </button>
              </div>
              <div className="journal-chip-cloud">
                {activeTagCatalog.map((row) => {
                  const selected = selectedCatalogTagIds.includes(row.id);
                  return (
                    <button
                      type="button"
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
              <button type="button" className="ghost-btn journal-link-section-toggle" aria-expanded={songSectionOpen} onClick={() => setSongSectionOpen((prev) => !prev)}>
                <span className="journal-link-group-title">
                  <strong>{lang === "ko" ? "연결 곡" : "Linked Songs"}</strong>
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
                        <button type="button" className="ghost-btn journal-link-group-toggle" aria-expanded={openGroup} onClick={() => toggleGroup(group.label, openSongGroups, setOpenSongGroups)}>
                          <span className="journal-link-group-title">
                            <strong>{group.label}</strong>
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
              <button type="button" className="ghost-btn journal-link-section-toggle" aria-expanded={drillSectionOpen} onClick={() => setDrillSectionOpen((prev) => !prev)}>
                <span className="journal-link-group-title">
                  <strong>{lang === "ko" ? "연결 드릴" : "Linked Drills"}</strong>
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
                        <button type="button" className="ghost-btn journal-link-group-toggle" aria-expanded={openGroup} onClick={() => toggleGroup(group.label, openDrillGroups, setOpenDrillGroups)}>
                          <span className="journal-link-group-title">
                            <strong>{group.label}</strong>
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

            <section className="card journal-composer-side-card">
              <div className="row journal-upload-head">
                <div className="journal-upload-head-title">
                  <strong>{lang === "ko" ? "첨부" : "Attachments"}</strong>
                  <small className="muted">
                    {lang === "ko"
                      ? "이미지 업로드/붙여넣기, 영상 업로드/유튜브 링크, 오디오 업로드"
                      : "Image upload/paste, video upload/YouTube link, audio upload"}
                  </small>
                </div>
                <div className="journal-upload-head-actions">
                  <button type="button" className="ghost-btn compact-add-btn" disabled={maxNewAttachmentCount <= 0} onClick={() => fileInputRef.current?.click()}>
                    {lang === "ko" ? "첨부 추가" : "Add Files"}
                  </button>
                </div>
              </div>
              {hasExistingAttachments ? (
                <small className="muted">
                  {lang === "ko" ? `기존 첨부 ${item?.attachments.length}개는 그대로 둡니다.` : `${item?.attachments.length} existing attachments will stay.`}
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
                  <button type="button" className="ghost-btn compact-add-btn" onClick={addVideoLink} disabled={!isYouTubeUrl(pendingVideoLink) || remainingAttachmentSlots <= 0}>
                    {lang === "ko" ? "링크 추가" : "Add Link"}
                  </button>
                </div>
              </div>
              <div className="journal-upload-list journal-upload-list-compact">
                {existingAttachments.map((attachment, index) => {
                  const order = index + 1;
                  return (
                    <article key={attachment.local_id} className="journal-upload-card">
                      <div className="journal-upload-card-preview">{renderAttachmentPreview(attachment, order)}</div>
                      <div className="journal-upload-card-head">
                        <strong>{attachmentTitle(order, attachment.media_type, lang)}</strong>
                        <small className="muted">{lang === "ko" ? "유지" : "Kept"}</small>
                      </div>
                      <div className="journal-upload-insert-actions">
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "small")}>S</button>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "medium")}>M</button>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "large")}>L</button>
                      </div>
                    </article>
                  );
                })}
                {fileAttachments.map((attachment, index) => {
                  const order = existingAttachments.length + index + 1;
                  return (
                    <article key={attachment.local_id} className="journal-upload-card">
                      <div className="journal-upload-card-preview">
                        {renderAttachmentPreview(
                          {
                            media_type: attachment.media_type,
                            preview_url: attachment.preview_url,
                            file_name: attachment.file.name,
                          },
                          order
                        )}
                      </div>
                      <div className="journal-upload-card-head">
                        <strong>{attachmentTitle(order, attachment.media_type, lang)}</strong>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => removeFile(attachment.local_id)}>
                          {lang === "ko" ? "삭제" : "Remove"}
                        </button>
                      </div>
                      <div className="journal-upload-card-meta">
                        <small>{attachment.file.name}</small>
                        <small className="journal-upload-type-pill">{attachmentShortLabel(attachment.media_type)}</small>
                      </div>
                      <div className="journal-upload-insert-actions">
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "small")}>S</button>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "medium")}>M</button>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "large")}>L</button>
                      </div>
                    </article>
                  );
                })}
                {videoAttachments.map((attachment, index) => {
                  const order = existingAttachments.length + fileAttachments.length + index + 1;
                  return (
                    <article key={attachment.local_id} className="journal-upload-card">
                      <div className="journal-upload-card-preview">{renderAttachmentPreview({ media_type: "video", url: attachment.url }, order)}</div>
                      <div className="journal-upload-card-head">
                        <strong>{attachmentTitle(order, "video", lang)}</strong>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => removeVideoLink(attachment.local_id)}>
                          {lang === "ko" ? "삭제" : "Remove"}
                        </button>
                      </div>
                      <div className="journal-upload-card-meta">
                        <small>{attachment.url}</small>
                        <small className="journal-upload-type-pill">YT</small>
                      </div>
                      <div className="journal-upload-insert-actions">
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "small")}>S</button>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "medium")}>M</button>
                        <button type="button" className="ghost-btn compact-add-btn" onClick={() => insertAttachmentEmbed(order, "large")}>L</button>
                      </div>
                    </article>
                  );
                })}
                {!previewAttachments.length ? <small className="muted">{lang === "ko" ? "아직 첨부가 없습니다." : "No attachments yet."}</small> : null}
              </div>
            </section>
          </aside>
        </div>

        <div className="modal-actions journal-composer-footer">
          <button type="button" className="ghost-btn compact-add-btn" onClick={() => setEditorTab((prev) => (prev === "write" ? "preview" : "write"))}>
            {editorTab === "write" ? (lang === "ko" ? "미리보기" : "Preview") : (lang === "ko" ? "작성" : "Write")}
          </button>
          <button className="primary-btn" disabled={busy || (!title.trim() && !body.trim() && previewAttachments.length === 0)} onClick={() => void submit()}>
            {busy ? (lang === "ko" ? "저장 중..." : "Saving...") : item ? (lang === "ko" ? "수정 저장" : "Save Changes") : (lang === "ko" ? "게시글 등록" : "Publish")}
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            {lang === "ko" ? "취소" : "Cancel"}
          </button>
        </div>

        <TemplatePickerModal
          open={templatePickerOpen}
          lang={lang}
          selectedTemplateId={templateId}
          templates={activeTemplateCatalog}
          headers={activeHeaderCatalog}
          onClose={() => setTemplatePickerOpen(false)}
          onPick={(nextTemplateId) => {
            applyTemplate(nextTemplateId);
            setTemplatePickerOpen(false);
          }}
        />
      </div>
    </div>
  );
}
