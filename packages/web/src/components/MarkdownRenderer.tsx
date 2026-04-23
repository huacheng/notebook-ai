import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { useRef } from 'react';
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

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const processed = preprocessMarkdown(content);
  useMermaidRender(ref, processed);
  return (
    <div className={`markdown-rendered${className ? ` ${className}` : ''}`} ref={ref}>
      <ReactMarkdown remarkPlugins={sharedRemarkPlugins} rehypePlugins={rehypePlugins} components={mdComponents}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
