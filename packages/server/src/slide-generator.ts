import crypto from 'crypto';
import type { Notebook, SlideSection, CellOutput } from '@notebook-ai/shared';

/**
 * Summarises a single cell output into a short text description.
 */
function summariseOutput(output: CellOutput): string {
  switch (output.type) {
    case 'text': {
      const text = output.content.trim();
      if (text.length <= 200) return text;
      return text.slice(0, 200) + '...';
    }
    case 'tool_use': {
      const result = output.result ? ` -> ${output.result.slice(0, 80)}` : '';
      return `[Tool: ${output.name}]${result}`;
    }
    case 'error':
      return `[Error] ${output.message.slice(0, 120)}`;
    case 'thinking':
      return ''; // Omit thinking blocks from slide summaries
    case 'chart':
      return `[Chart: ${output.chart_type}]`;
    default:
      return '';
  }
}

/**
 * Extracts a title from source text by taking approximately the first 50
 * characters, breaking at a word boundary if possible.
 */
function extractTitle(source: string, maxLen = 50): string {
  const firstLine = source.split('\n')[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  const truncated = firstLine.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Generates an array of SlideSection objects from a notebook.
 *
 * - Creates a title section from notebook metadata
 * - For each prompt cell: extracts title from source, summarises outputs
 * - For each markdown cell: uses source as content
 * - Skips visualization cells (they have no meaningful text representation)
 */
export function generateSlide(notebook: Notebook): SlideSection[] {
  const sections: SlideSection[] = [];
  let order = 0;

  // Title section from notebook metadata
  sections.push({
    id: crypto.randomUUID(),
    title: notebook.metadata.title,
    content: `Notebook created ${notebook.metadata.created}${
      notebook.metadata.cwd ? `\nWorking directory: ${notebook.metadata.cwd}` : ''
    }`,
    cell_refs: [],
    order: order++,
  });

  for (const cell of notebook.cells) {
    switch (cell.type) {
      case 'prompt': {
        const title = extractTitle(cell.source);

        // Summarise outputs
        const outputSummaries = cell.outputs
          .map(summariseOutput)
          .filter((s) => s.length > 0);

        const content =
          outputSummaries.length > 0
            ? outputSummaries.join('\n\n')
            : '(no output yet)';

        sections.push({
          id: crypto.randomUUID(),
          title,
          content,
          cell_refs: [cell.id],
          order: order++,
        });
        break;
      }

      case 'markdown': {
        if (!cell.source.trim()) break;

        // Try to extract a heading from the markdown source for the title
        const lines = cell.source.trim().split('\n');
        const headingMatch = lines[0].match(/^#+\s+(.*)/);
        const title = headingMatch
          ? headingMatch[1].trim()
          : extractTitle(cell.source);

        const content = cell.source.trim();

        sections.push({
          id: crypto.randomUUID(),
          title,
          content,
          cell_refs: [cell.id],
          order: order++,
        });
        break;
      }

      case 'visualization': {
        // Skip visualization cells in the slide
        break;
      }
    }
  }

  return sections;
}
