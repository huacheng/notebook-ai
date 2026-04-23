/**
 * Safe link renderer shared by MarkdownBody and MarkdownRenderer.
 * - Filters non-navigable schemes (javascript:, data:, vbscript:, etc.) → renders as span
 * - External http(s) links open in new tab with rel="noopener noreferrer"
 */

const SAFE_SCHEMES = /^(?:https?:|mailto:|tel:|ftp:|\/|\.\/|\.\.\/|#)/i;
const EXTERNAL = /^https?:\/\//i;

export function SafeLink({ node: _n, href, children, ...rest }: any) {
  const safe = typeof href === 'string' && SAFE_SCHEMES.test(href);
  if (!safe) return <span {...rest}>{children}</span>;
  return EXTERNAL.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>
  ) : (
    <a href={href} {...rest}>{children}</a>
  );
}
