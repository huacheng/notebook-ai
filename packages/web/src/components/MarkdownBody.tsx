import { memo, useMemo, useRef } from 'react';
import { Streamdown } from 'streamdown';
import rehypeHighlight from 'rehype-highlight';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { preprocessMarkdown } from '../utils/markdownPreprocess';
import { sharedRemarkPlugins, katexRehypePlugin } from '../utils/markdownPlugins';
import 'streamdown/styles.css';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

interface MarkdownBodyProps {
  content: string;
  className?: string;
}

// Streamdown decorates standard tags with Tailwind utility classes and replaces
// links with non-navigating <button> elements; the project styles plain HTML via
// `.markdown-body` rules, so emit standard tags here.
import { SafeLink } from './SafeLink';

const sdComponents = {
  strong: ({ node: _n, ...props }: any) => <strong {...props} />,
  a: SafeLink,
};

const rehypePlugins = [rehypeHighlight, katexRehypePlugin];

function MarkdownBodyBase({ content, className }: MarkdownBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const processed = useMemo(() => preprocessMarkdown(content), [content]);
  useMermaidRender(ref, processed);
  return (
    <div className={`markdown-body${className ? ` ${className}` : ''}`} ref={ref}>
      <Streamdown components={sdComponents} remarkPlugins={sharedRemarkPlugins} rehypePlugins={rehypePlugins}>
        {processed}
      </Streamdown>
    </div>
  );
}

// memo: skip re-render when parent re-renders with same content/className
export const MarkdownBody = memo(MarkdownBodyBase);
