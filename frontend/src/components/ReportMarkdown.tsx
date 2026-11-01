import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function ReportMarkdown({
  text,
  references = [],
  inspect,
}: {
  text: string;
  references?: readonly string[];
  inspect?: (reference: string) => void;
}) {
  return (
    <div className="report-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: () => null,
          code: ({ children }) =>
            references.includes(String(children)) && inspect ? (
              <button
                className="quiet-button"
                onClick={() => inspect(String(children))}
              >
                <code>{children}</code>
              </button>
            ) : (
              <code>{children}</code>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
