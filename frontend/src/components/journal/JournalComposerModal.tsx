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
  normalizeJournalMeta,
  serializeJournalMeta,
  type JournalMetaDraft,
  type SlashCommandSpec,
} from "./journalUtils";

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
  const [editorTab, setEditorTab] = useState<EditorTab>("write");
  const [metaDraft, setMetaDraft] = useState<JournalMetaDraft>(emptyJournalMeta());
  const [slashQuery, setSlashQuery] = useState("");
  const [slashCommands, setSlashCommands] = useState<SlashCommandSpec[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeTagCatalog = useMemo(
    () =>
      tagCatalog
        .filter((item) => item.active !== false && String(item.label || "").trim())
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [tagCatalog]
  );
  const activeHeaderCatalog = useMemo(
    () => headerCatalog.filter((item) => item.active !== false).sort((a, b) => a.order - b.order),
    [headerCatalog]
  );
  const activeStatusCatalog = useMemo(
    () => statusCatalog.filter((item) => item.active !== false).sort((a, b) => a.order - b.order),
    [statusCatalog]
  );
  const activeTemplateCatalog = useMemo(
    () => templateCatalog.filter((item) => item.active !== false).sort((a, b) => a.order - b.order),
    [templateCatalog]
  );
  const mergedDrills = useMemo(
    () =>
      mergeDrills(catalogs.drills, catalogs.drill_library)
        .filter((row) => String(row.drill_id || "").trim())
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [catalogs.drill_library, catalogs.drills]
  );

  useEffect(() => {
    if (!open) return;
    const selectedHeaderId =
      item?.header_id || activeHeaderCatalog[0]?.id || headerCatalog[0]?.id || "";
    const selectedStatusId =
      item?.status_id || activeStatusCatalog[0]?.id || statusCatalog[0]?.id || "";
    setTitle(item?.title || "");
    setBody(item?.body || "");
    setSourceContext(item?.source_context || "practice");
    setHeaderId(selectedHeaderId);
    setStatusId(selectedStatusId);
    setTemplateId(item?.template_id || "");
    setSelectedSongIds(item?.linked_song_ids || []);
    setSelectedDrillIds(item?.linked_drill_ids || []);
    setFiles([]);
    setEditorTab("write");
    setMetaDraft(normalizeJournalMeta(item?.meta));
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

  if (!open) return null;

  const selectedTemplate = activeTemplateCatalog.find((template) => template.id === templateId) || null;
  const selectedCatalogLabels = selectedCatalogTagIds
    .map((id) => activeTagCatalog.find((row) => row.id === id)?.label || "")
    .filter(Boolean);
  const hasExistingAttachments = (item?.attachments || []).length > 0;

  const toggleInArray = (value: string, current: string[], setter: (next: string[]) => void) => {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
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
    if (!title.trim() && !body.trim() && files.length === 0) return;
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
      },
      files
    );
  };

  return (
    <div className="modal-backdrop journal-composer-backdrop" data-testid="journal-composer-modal" onClick={onClose}>
      <div className="modal journal-composer-modal" onClick={(event) => event.stopPropagation()}>
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
            <button className="ghost-btn" onClick={onClose}>{lang === "ko" ? "닫기" : "Close"}</button>
          </div>
        </div>

        <div className="journal-composer-layout">
          <section className="journal-composer-main">
            <div className="journal-composer-grid">
              <label>
                {lang === "ko" ? "제목" : "Title"}
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
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

            <div className="journal-editor-tab-row">
              <button className={`ghost-btn ${editorTab === "write" ? "active-mini" : ""}`} onClick={() => setEditorTab("write")}>
                {lang === "ko" ? "작성" : "Write"}
              </button>
              <button className={`ghost-btn ${editorTab === "preview" ? "active-mini" : ""}`} onClick={() => setEditorTab("preview")}>
                {lang === "ko" ? "미리보기" : "Preview"}
              </button>
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
              <div className="row"><strong>{lang === "ko" ? "연결 곡" : "Linked Songs"}</strong></div>
              <div className="journal-link-scroll">
                {catalogs.song_library
                  .filter((row) => String(row.library_id || "").trim())
                  .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
                  .map((song) => (
                    <label key={song.library_id} className="inline selectable-row">
                      <input type="checkbox" checked={selectedSongIds.includes(song.library_id)} onChange={() => toggleInArray(song.library_id, selectedSongIds, setSelectedSongIds)} />
                      <span>{song.title || song.library_id}</span>
                    </label>
                  ))}
              </div>
            </section>

            <section className="card journal-composer-side-card">
              <div className="row"><strong>{lang === "ko" ? "연결 드릴" : "Linked Drills"}</strong></div>
              <div className="journal-link-scroll">
                {mergedDrills.map((drill) => (
                  <label key={drill.drill_id} className="inline selectable-row">
                    <input type="checkbox" checked={selectedDrillIds.includes(drill.drill_id)} onChange={() => toggleInArray(drill.drill_id, selectedDrillIds, setSelectedDrillIds)} />
                    <span>{drill.name || drill.drill_id}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="card journal-composer-side-card">
              <div className="row"><strong>{lang === "ko" ? "첨부" : "Attachments"}</strong></div>
              {hasExistingAttachments ? (
                <small className="muted">
                  {lang === "ko" ? `기존 첨부 ${item?.attachments.length}개는 유지됩니다.` : `${item?.attachments.length} existing attachments will be kept.`}
                </small>
              ) : null}
              <input type="file" multiple accept="image/*,video/*,audio/*" onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 8))} />
              <small className="muted">
                {files.length ? files.map((file) => file.name).join(", ") : lang === "ko" ? "새 첨부 없음" : "No new files"}
              </small>
            </section>
          </aside>
        </div>

        <div className="modal-actions journal-composer-footer">
          <button className="primary-btn" disabled={busy || (!title.trim() && !body.trim() && files.length === 0)} onClick={() => void submit()}>
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
