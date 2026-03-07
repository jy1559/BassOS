import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  body: string;
  className?: string;
};

export function JournalMarkdown({ body, className = "" }: Props) {
  return (
    <div className={`journal-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {body || ""}
      </ReactMarkdown>
    </div>
  );
}
