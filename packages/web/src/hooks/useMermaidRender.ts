// ── Mermaid rendering — CDN lazy-load + DOM scan/replace ─────────────────
import { useEffect } from 'react';
import DOMPurify from 'dompurify';

// ── Pure / DOM helpers (unit-testable) ───────────────────────────────────

export interface MermaidBlock {
  pre: HTMLPreElement;
  source: string;
}

/** Scan container for `pre > code.language-mermaid` elements. */
export function findMermaidBlocks(container: HTMLElement): MermaidBlock[] {
  const codes = container.querySelectorAll<HTMLElement>('pre > code.language-mermaid');
  const blocks: MermaidBlock[] = [];
  for (const code of codes) {
    const pre = code.parentElement as HTMLPreElement;
    blocks.push({ pre, source: code.textContent ?? '' });
  }
  return blocks;
}

/** Replace a <pre> with rendered SVG or error message. */
export function replaceMermaidBlock(
  pre: HTMLPreElement,
  svgHtml: string | null,
  errorMsg?: string,
): void {
  const parent = pre.parentNode;
  if (!parent) return;

  if (svgHtml) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fv-mermaid-diagram';
    wrapper.innerHTML = DOMPurify.sanitize(svgHtml, { USE_PROFILES: { svg: true, svgFilters: true } });
    parent.replaceChild(wrapper, pre);
  } else {
    const errEl = document.createElement('div');
    errEl.className = 'fv-mermaid-error';
    errEl.textContent = `Mermaid error: ${errorMsg ?? 'Unknown error'}`;
    parent.replaceChild(errEl, pre);
  }
}

// ── CDN lazy-load singleton ──────────────────────────────────────────────

let loadPromise: Promise<any> | null = null;

async function loadMermaid(): Promise<any> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const CDN_URLS = [
      'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs',
      'https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs',
    ];
    let lastErr: unknown;
    for (const url of CDN_URLS) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          themeVariables: {
            fontFamily: 'var(--font-body)',
            primaryColor: '#e0f2fe',
            primaryTextColor: '#0c4a6e',
            primaryBorderColor: '#0ea5e9',
            lineColor: '#78716c',
          },
        });
        return mermaid;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  })();
  return loadPromise;
}

// ── React hook ───────────────────────────────────────────────────────────

let renderCounter = 0;

/**
 * After ReactMarkdown renders, scan for mermaid code blocks and render them as SVG.
 */
export function useMermaidRender(
  containerRef: React.RefObject<HTMLElement | null>,
  dependency: unknown,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const blocks = findMermaidBlocks(container);
    if (blocks.length === 0) return;

    let cancelled = false;

    (async () => {
      let mermaid: any;
      try {
        mermaid = await loadMermaid();
      } catch {
        if (cancelled) return;
        for (const { pre } of blocks) {
          replaceMermaidBlock(pre, null, 'Failed to load mermaid library');
        }
        return;
      }

      for (const { pre, source } of blocks) {
        if (cancelled) return;
        try {
          const id = `fv-mermaid-${++renderCounter}`;
          const { svg } = await mermaid.render(id, source);
          if (!cancelled) replaceMermaidBlock(pre, svg);
        } catch (e: any) {
          if (!cancelled) replaceMermaidBlock(pre, null, e?.message ?? String(e));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [dependency]);
}
