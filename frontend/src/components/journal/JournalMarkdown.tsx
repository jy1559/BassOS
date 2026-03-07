import type { RecordAttachment } from "../../types/models";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  extractAttachmentEmbeds,
  getYouTubeEmbedUrl,
  isYouTubeUrl,
  resolveRecordAttachmentUrl,
  type AttachmentEmbedSize,
} from "./journalUtils";

type Props = {
  body: string;
  className?: string;
  attachments?: RecordAttachment[];
  fallbackTitle?: string;
  onOpenAttachment?: (attachment: RecordAttachment) => void;
};

type AttachmentBlockProps = {
  attachment: RecordAttachment;
  size: AttachmentEmbedSize;
  fallbackTitle: string;
  onOpenAttachment?: (attachment: RecordAttachment) => void;
};

function MarkdownBlock({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
      }}
    >
      {value || ""}
    </ReactMarkdown>
  );
}

function AttachmentBlock({ attachment, size, fallbackTitle, onOpenAttachment }: AttachmentBlockProps) {
  const url = resolveRecordAttachmentUrl(attachment);
  if (!url) return null;

  const title = attachment.title || fallbackTitle;
  const notes = attachment.notes || "";
  const youtubeEmbedUrl = attachment.media_type === "video" && isYouTubeUrl(url) ? getYouTubeEmbedUrl(url) : "";
  const openAttachment = () => onOpenAttachment?.(attachment);

  return (
    <div
      className={`journal-inline-attachment is-${size} is-${attachment.media_type} ${onOpenAttachment ? "is-openable" : ""}`.trim()}
      data-testid="journal-inline-attachment"
    >
      <div className="journal-inline-attachment-media">
        {attachment.media_type === "image" ? (
          <img src={url} alt={title} className="journal-inline-attachment-image" onClick={openAttachment} />
        ) : attachment.media_type === "video" ? (
          youtubeEmbedUrl ? (
            <iframe
              src={youtubeEmbedUrl}
              title={title || "YouTube"}
              className="journal-inline-attachment-frame"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video src={url} className="journal-inline-attachment-video" controls preload="metadata" />
          )
        ) : (
          <audio src={url} className="journal-inline-attachment-audio" controls preload="metadata" />
        )}
      </div>
      {(title || notes || onOpenAttachment) ? (
        <div className="journal-inline-attachment-meta">
          {title ? <strong>{title}</strong> : null}
          {notes ? <small>{notes}</small> : null}
          {onOpenAttachment ? (
            <button type="button" className="ghost-btn compact-add-btn" onClick={openAttachment}>
              Open
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function JournalMarkdown({
  body,
  className = "",
  attachments = [],
  fallbackTitle = "",
  onOpenAttachment,
}: Props) {
  const embeds = attachments.length ? extractAttachmentEmbeds(body || "") : [];

  if (!embeds.length) {
    return (
      <div className={`journal-markdown ${className}`.trim()}>
        <MarkdownBlock value={body || ""} />
      </div>
    );
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  embeds.forEach((embed, index) => {
    const chunk = (body || "").slice(cursor, embed.start);
    if (chunk) {
      parts.push(<MarkdownBlock key={`md-${index}-${cursor}`} value={chunk} />);
    }

    const attachment = attachments[embed.index - 1];
    parts.push(
      attachment ? (
        <AttachmentBlock
          key={`attachment-${index}-${attachment.attachment_id}`}
          attachment={attachment}
          size={embed.size}
          fallbackTitle={fallbackTitle}
          onOpenAttachment={onOpenAttachment}
        />
      ) : (
        <div key={`attachment-missing-${index}`} className="journal-inline-attachment-missing muted">
          {`Attachment ${embed.index}`}
        </div>
      )
    );

    cursor = embed.end;
  });

  const tail = (body || "").slice(cursor);
  if (tail) {
    parts.push(<MarkdownBlock key={`md-tail-${cursor}`} value={tail} />);
  }

  return <div className={`journal-markdown ${className}`.trim()}>{parts}</div>;
}
