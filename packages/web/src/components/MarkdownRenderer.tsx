import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useRef } from 'react';
import { useMermaidRender } from '../hooks/useMermaidRender';

function mermaidCodeBlock({ className, children, ...rest }: any) {
  if (className === 'language-mermaid') {
    return <pre><code className={className} {...rest}>{children}</code></pre>;
  }
  return <code className={className} {...rest}>{children}</code>;
}

const mdComponents = { code: mermaidCodeBlock };

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useMermaidRender(ref, content);
  return (
    <div className={`markdown-rendered${className ? ` ${className}` : ''}`} ref={ref}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
