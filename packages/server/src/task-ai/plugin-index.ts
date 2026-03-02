import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface PluginInfo {
  name: string;
  description: string;
}

export interface PluginIndexEntry {
  plugin: string;
  description: string;
  keywords: string[];
  capabilities: string[];
  lastIndexed: string;
}

export interface PluginIndex {
  version: number;
  buildTime: string;
  pluginCount: number;
  plugins: PluginIndexEntry[];
  capabilityIndex: Record<string, string[]>; // capability -> plugin[]
  pluginListHash: string;
}

// ============================================================================
// Constants
// ============================================================================

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'this', 'can', 'do',
]);

const MIN_KEYWORD_LENGTH = 3;

// Capability inference patterns
const CAPABILITY_PATTERNS: Record<string, RegExp[]> = {
  'doc-parse': [/pdf/i, /docx?/i, /document/i, /parse/i, /xlsx?/i, /pptx?/i],
  'code-review': [/code.*review/i, /review.*code/i, /static.*analysis/i],
  'brainstorm': [/brainstorm/i, /explore/i, /design.*space/i, /ideate/i],
  'debugging': [/debug/i, /fix.*issue/i, /troubleshoot/i],
  'tdd': [/tdd/i, /test.*driven/i, /unit.*test/i, /\btest\b/i],
  'frontend-design': [/frontend/i, /\bui\b/i, /user.*interface/i, /css/i, /react/i],
};

// ============================================================================
// Keyword Extraction
// ============================================================================

/**
 * Extract meaningful keywords from a description.
 * Filters stop words and short words.
 */
export function extractKeywords(description: string): string[] {
  if (!description) return [];

  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= MIN_KEYWORD_LENGTH)
    .filter(w => !STOP_WORDS.has(w));

  // Deduplicate
  return [...new Set(words)];
}

// ============================================================================
// Capability Inference
// ============================================================================

/**
 * Infer capability slots from plugin name, description, and keywords.
 */
export function inferCapabilities(
  name: string,
  description: string,
  keywords: string[]
): string[] {
  const capabilities: string[] = [];
  const combinedText = `${name} ${description} ${keywords.join(' ')}`;

  for (const [capability, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(combinedText))) {
      capabilities.push(capability);
    }
  }

  // Always include domain-* as fallback if no specific capability matched
  if (capabilities.length === 0) {
    capabilities.push('domain-*');
  }

  return capabilities;
}

// ============================================================================
// Hash Generation
// ============================================================================

function hashPluginList(plugins: PluginInfo[]): string {
  const content = plugins
    .map(p => `${p.name}:${p.description}`)
    .sort()
    .join('|');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ============================================================================
// Index Building
// ============================================================================

/**
 * Build a plugin index with capability inverted index for O(1) slot lookup.
 */
export async function buildPluginIndex(availablePlugins: PluginInfo[]): Promise<PluginIndex> {
  const plugins: PluginIndexEntry[] = [];
  const capabilityIndex: Record<string, string[]> = {};

  for (const plugin of availablePlugins) {
    const keywords = extractKeywords(plugin.description);
    const capabilities = inferCapabilities(plugin.name, plugin.description, keywords);

    plugins.push({
      plugin: plugin.name,
      description: plugin.description,
      keywords,
      capabilities,
      lastIndexed: new Date().toISOString(),
    });

    // Build inverted index
    for (const cap of capabilities) {
      if (!capabilityIndex[cap]) {
        capabilityIndex[cap] = [];
      }
      capabilityIndex[cap].push(plugin.name);
    }
  }

  return {
    version: 1,
    buildTime: new Date().toISOString(),
    pluginCount: plugins.length,
    plugins,
    capabilityIndex,
    pluginListHash: hashPluginList(availablePlugins),
  };
}

// ============================================================================
// Slot Lookup
// ============================================================================

/**
 * Find plugins for a capability slot in O(1) time.
 */
export function findPluginsForSlot(index: PluginIndex, slot: string): string[] {
  return index.capabilityIndex[slot] ?? [];
}
