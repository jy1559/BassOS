import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../i18n";
import type {
  JournalHeaderPreset,
  JournalTagPreset,
  JournalTemplatePreset,
} from "../../types/models";

type ManagerPanel = "" | "tags" | "headers" | "templates";
type TemplateDraftRow = JournalTemplatePreset & { default_tags_input: string };

type Props = {
  open: boolean;
  panel: ManagerPanel;
  lang: Lang;
  tagCatalog: JournalTagPreset[];
  headerCatalog: JournalHeaderPreset[];
  templateCatalog: JournalTemplatePreset[];
  onClose: () => void;
  onSave: (payload: {
    journal_tag_catalog?: JournalTagPreset[];
    journal_header_catalog?: JournalHeaderPreset[];
    journal_template_catalog?: JournalTemplatePreset[];
  }) => Promise<void>;
};

function nextLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHex(input: string, fallback = "#5c6e7c"): string {
  const token = String(input || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(token)) return token;
  return fallback;
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  labels.forEach((label) => {
    const trimmed = label.trim();
    const lowered = trimmed.toLowerCase();
    if (!trimmed || seen.has(lowered)) return;
    seen.add(lowered);
    out.push(trimmed);
  });
  return out;
}

function splitLooseTags(raw: string): string[] {
  return (raw || "")
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeTagCatalog(rows: JournalTagPreset[]): JournalTagPreset[] {
  const seen = new Set<string>();
  const out: JournalTagPreset[] = [];
  rows.forEach((row, index) => {
    const label = String(row.label || "").trim();
    const lowered = label.toLowerCase();
    if (!label || seen.has(lowered)) return;
    seen.add(lowered);
    out.push({
      id: String(row.id || nextLocalId("tag")).trim(),
      label,
      category: String(row.category || "기타").trim() || "기타",
      active: row.active !== false,
      order: index,
    });
  });
  return out;
}

function sanitizeHeaderCatalog(rows: JournalHeaderPreset[]): JournalHeaderPreset[] {
  const seen = new Set<string>();
  const out: JournalHeaderPreset[] = [];
  rows.forEach((row, index) => {
    const label = String(row.label || "").trim();
    const lowered = label.toLowerCase();
    if (!label || seen.has(lowered)) return;
    seen.add(lowered);
    out.push({
      id: String(row.id || nextLocalId("header")).trim(),
      label,
      color: normalizeHex(row.color, "#5c6e7c"),
      active: row.active !== false,
      order: index,
    });
  });
  return out;
}

function sanitizeTemplateCatalog(
  rows: TemplateDraftRow[],
  headerCatalog: JournalHeaderPreset[]
): JournalTemplatePreset[] {
  const activeHeaderId = headerCatalog.find((row) => row.active !== false)?.id || headerCatalog[0]?.id || "";
  const seen = new Set<string>();
  const out: JournalTemplatePreset[] = [];
  rows.forEach((row, index) => {
    const name = String(row.name || "").trim();
    const lowered = name.toLowerCase();
    if (!name || seen.has(lowered)) return;
    seen.add(lowered);
    out.push({
      id: String(row.id || nextLocalId("template")).trim(),
      name,
      description: String(row.description || "").trim(),
      header_id: headerCatalog.some((item) => item.id === row.header_id) ? row.header_id : activeHeaderId,
      default_tags: dedupeLabels(splitLooseTags(row.default_tags_input || row.default_tags.join(", "))),
      default_source_context: ["practice", "review", "performance", "archive"].includes(row.default_source_context)
        ? row.default_source_context
        : "practice",
      body_markdown: String(row.body_markdown || ""),
      active: row.active !== false,
      order: index,
    });
  });
  return out;
}

export function JournalManagerModal({
  open,
  panel,
  lang,
  tagCatalog,
  headerCatalog,
  templateCatalog,
  onClose,
  onSave,
}: Props) {
  const [tagDraft, setTagDraft] = useState<JournalTagPreset[]>([]);
  const [headerDraft, setHeaderDraft] = useState<JournalHeaderPreset[]>([]);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraftRow[]>([]);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTagDraft(tagCatalog);
    setHeaderDraft(headerCatalog);
    setTemplateDraft(templateCatalog.map((row) => ({ ...row, default_tags_input: row.default_tags.join(", ") })));
  }, [headerCatalog, open, tagCatalog, templateCatalog]);

  useEffect(() => {
    if (!open) return;
    modalRef.current?.focus();
  }, [open]);

  if (!open || !panel) return null;

  const title =
    panel === "tags"
      ? lang === "ko" ? "태그 관리" : "Tag Manager"
      : panel === "headers"
        ? lang === "ko" ? "말머리 관리" : "Header Manager"
        : lang === "ko" ? "템플릿 관리" : "Template Manager";

  const submit = async () => {
    if (panel === "tags") {
      await onSave({ journal_tag_catalog: sanitizeTagCatalog(tagDraft) });
      return;
    }
    if (panel === "headers") {
      await onSave({ journal_header_catalog: sanitizeHeaderCatalog(headerDraft) });
      return;
    }
    const nextHeaders = sanitizeHeaderCatalog(headerDraft.length ? headerDraft : headerCatalog);
    await onSave({ journal_template_catalog: sanitizeTemplateCatalog(templateDraft, nextHeaders) });
  };

  return (
    <div
      className="modal-backdrop journal-manager-backdrop"
      data-testid={
        panel === "tags"
          ? "journal-tag-manager"
          : panel === "headers"
            ? "journal-header-manager"
            : "journal-template-manager"
      }
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="modal journal-manager-modal"
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
        <div className="row">
          <h2>{title}</h2>
          <div className="row">
            <button className="ghost-btn" onClick={onClose}>{lang === "ko" ? "닫기" : "Close"}</button>
            <button className="primary-btn" onClick={() => void submit()}>{lang === "ko" ? "저장" : "Save"}</button>
          </div>
        </div>

        {panel === "tags" ? (
          <div className="journal-manager-list">
            {tagDraft.map((row, index) => (
              <div className="journal-manager-row" key={row.id || index}>
                <input value={row.label} onChange={(event) => setTagDraft((prev) => prev.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} placeholder={lang === "ko" ? "태그명" : "Tag"} />
                <input value={row.category} onChange={(event) => setTagDraft((prev) => prev.map((item, i) => i === index ? { ...item, category: event.target.value } : item))} placeholder={lang === "ko" ? "카테고리" : "Category"} />
                <label className="inline"><input type="checkbox" checked={row.active !== false} onChange={(event) => setTagDraft((prev) => prev.map((item, i) => i === index ? { ...item, active: event.target.checked } : item))} /><span>{lang === "ko" ? "사용" : "Active"}</span></label>
                <button className="ghost-btn danger-border" onClick={() => setTagDraft((prev) => prev.filter((_, i) => i !== index))}>{lang === "ko" ? "삭제" : "Delete"}</button>
              </div>
            ))}
            <button className="ghost-btn" onClick={() => setTagDraft((prev) => [...prev, { id: nextLocalId("tag"), label: "", category: "기타", active: true, order: prev.length }])}>
              {lang === "ko" ? "태그 추가" : "Add Tag"}
            </button>
          </div>
        ) : null}

        {panel === "headers" ? (
          <div className="journal-manager-list">
            {headerDraft.map((row, index) => (
              <div className="journal-manager-row" key={row.id || index}>
                <input value={row.label} onChange={(event) => setHeaderDraft((prev) => prev.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} placeholder={lang === "ko" ? "말머리" : "Header"} />
                <input type="color" value={normalizeHex(row.color)} onChange={(event) => setHeaderDraft((prev) => prev.map((item, i) => i === index ? { ...item, color: event.target.value } : item))} />
                <label className="inline"><input type="checkbox" checked={row.active !== false} onChange={(event) => setHeaderDraft((prev) => prev.map((item, i) => i === index ? { ...item, active: event.target.checked } : item))} /><span>{lang === "ko" ? "사용" : "Active"}</span></label>
                <button className="ghost-btn danger-border" onClick={() => setHeaderDraft((prev) => prev.filter((_, i) => i !== index))}>{lang === "ko" ? "삭제" : "Delete"}</button>
              </div>
            ))}
            <button className="ghost-btn" onClick={() => setHeaderDraft((prev) => [...prev, { id: nextLocalId("header"), label: "", color: "#5c6e7c", active: true, order: prev.length }])}>
              {lang === "ko" ? "말머리 추가" : "Add Header"}
            </button>
          </div>
        ) : null}

        {panel === "templates" ? (
          <div className="journal-manager-list templates">
            {templateDraft.map((row, index) => (
              <div className="journal-template-manager-card" key={row.id || index}>
                <div className="journal-manager-row">
                  <input value={row.name} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder={lang === "ko" ? "템플릿 이름" : "Template name"} />
                  <label className="inline"><input type="checkbox" checked={row.active !== false} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, active: event.target.checked } : item))} /><span>{lang === "ko" ? "사용" : "Active"}</span></label>
                  <button className="ghost-btn danger-border" onClick={() => setTemplateDraft((prev) => prev.filter((_, i) => i !== index))}>{lang === "ko" ? "삭제" : "Delete"}</button>
                </div>
                <input value={row.description} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} placeholder={lang === "ko" ? "설명" : "Description"} />
                <div className="journal-manager-row">
                  <select value={row.header_id} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, header_id: event.target.value } : item))}>
                    {headerCatalog.map((header) => <option key={header.id} value={header.id}>{header.label}</option>)}
                  </select>
                  <select value={row.default_source_context} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, default_source_context: event.target.value as JournalTemplatePreset["default_source_context"] } : item))}>
                    <option value="practice">{lang === "ko" ? "연습" : "Practice"}</option>
                    <option value="review">{lang === "ko" ? "회고" : "Review"}</option>
                    <option value="performance">{lang === "ko" ? "합주/공연" : "Performance"}</option>
                    <option value="archive">{lang === "ko" ? "아카이브" : "Archive"}</option>
                  </select>
                </div>
                <input value={row.default_tags_input} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, default_tags_input: event.target.value } : item))} placeholder={lang === "ko" ? "기본 태그(쉼표)" : "Default tags"} />
                <textarea value={row.body_markdown} onChange={(event) => setTemplateDraft((prev) => prev.map((item, i) => i === index ? { ...item, body_markdown: event.target.value } : item))} rows={8} placeholder={lang === "ko" ? "템플릿 Markdown" : "Template Markdown"} />
              </div>
            ))}
            <button
              className="ghost-btn"
              onClick={() =>
                setTemplateDraft((prev) => [
                  ...prev,
                  {
                    id: nextLocalId("template"),
                    name: "",
                    description: "",
                    header_id: headerCatalog[0]?.id || "",
                    default_tags: [],
                    default_tags_input: "",
                    default_source_context: "practice",
                    body_markdown: "",
                    active: true,
                    order: prev.length,
                  },
                ])
              }
            >
              {lang === "ko" ? "템플릿 추가" : "Add Template"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
