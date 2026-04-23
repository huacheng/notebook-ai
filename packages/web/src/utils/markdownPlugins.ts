/**
 * Shared remark/rehype plugin configuration for both MarkdownBody (Streamdown)
 * and MarkdownRenderer (react-markdown). Keeping these aligned ensures cell
 * prompt and cell output render identically.
 */

import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { katexStrict } from './markdownPreprocess';

// `unified`'s `Pluggable` accepts both bare functions and `[plugin, options]` tuples.
// Use `any` here since the renderer-side prop types (PluggableList) require a
// mutable array; the tuples we return satisfy them at the call site.
type AnyPluggable = any;

/** remark plugins shared across renderers. Order matters: cjk before gfm; math after gfm. */
export const sharedRemarkPlugins: AnyPluggable[] = [
  remarkCjkFriendly,
  [remarkGfm, { singleTilde: false }],
  [remarkMath, { singleDollarTextMath: false }],
];

/** rehype-katex options. Project-specific: relax unicode warnings for CJK \text{} usage. */
export const katexOptions = { strict: katexStrict };

/** rehype plugin tuple for KaTeX. Pair with project's chosen syntax-highlight plugin. */
export const katexRehypePlugin: AnyPluggable = [rehypeKatex, katexOptions];
