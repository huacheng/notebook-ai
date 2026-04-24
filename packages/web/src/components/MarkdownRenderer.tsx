import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { memo, useMemo, useRef } from 'react';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { preprocessMarkdown } from '../utils/markdownPreprocess';
import { sharedRemarkPlugins, katexRehypePlugin } from '../utils/markdownPlugins';
import { SafeLink } from './SafeLink';

function mermaidCodeBlock({ className, children, ...rest }: any) {
  if (className === 'language-mermaid') {
    return <pre><code className={className} {...rest}>{children}</code></pre>;
  }
  return <code className={className} {...rest}>{children}</code>;
}

const mdComponents = { code: mermaidCodeBlock, a: SafeLink };
const rehypePlugins = [rehypeHighlight, katexRehypePlugin];

function MarkdownRendererBase({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const processed = useMemo(() => preprocessMarkdown(content), [content]);
  useMermaidRender(ref, processed);
  return (
    <div className={`markdown-rendered${className ? ` ${className}` : ''}`} ref={ref}>
      <ReactMarkdown remarkPlugins={sharedRemarkPlugins} rehypePlugins={rehypePlugins} components={mdComponents}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}

// memo: skip re-render when polling ticks fire with unchanged content (50ms interval in StreamingText).
export const MarkdownRenderer = memo(MarkdownRendererBase);
