import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface PluginCandidate {
  plugin: string;
  slot: string;
  relevanceScore: number;
}

export interface PluginPreferences {
  slotBindings: Map<string, string>;
  disabledPlugins: Set<string>;
  disabledSlots: Set<string>;
  confidenceThreshold: 'high' | 'medium' | 'low';
  trustLevelMinimum: 'verified' | 'trusted' | 'any';
}

interface SettingsFile {
  'task-ai'?: {
    'plugin-delegation'?: {
      slotBindings?: Record<string, string>;
      disabledPlugins?: string[];
      disabledSlots?: string[];
      confidenceThreshold?: 'high' | 'medium' | 'low';
      trustLevelMinimum?: 'verified' | 'trusted' | 'any';
    };
  };
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_PREFERENCES: PluginPreferences = {
  slotBindings: new Map(),
  disabledPlugins: new Set(),
  disabledSlots: new Set(),
  confidenceThreshold: 'low',
  trustLevelMinimum: 'any',
};

// ============================================================================
// Preferences Loading
// ============================================================================

/**
 * Load plugin preferences from settings file.
 * Returns defaults if file doesn't exist or is invalid.
 */
export function loadPreferences(settingsPath: string): PluginPreferences {
  try {
    if (!fs.existsSync(settingsPath)) {
      return { ...DEFAULT_PREFERENCES };
    }

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings: SettingsFile = JSON.parse(content);

    const delegation = settings['task-ai']?.['plugin-delegation'];
    if (!delegation) {
      return { ...DEFAULT_PREFERENCES };
    }

    return {
      slotBindings: new Map(Object.entries(delegation.slotBindings ?? {})),
      disabledPlugins: new Set(delegation.disabledPlugins ?? []),
      disabledSlots: new Set(delegation.disabledSlots ?? []),
      confidenceThreshold: delegation.confidenceThreshold ?? 'low',
      trustLevelMinimum: delegation.trustLevelMinimum ?? 'any',
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

// ============================================================================
// Preferences Application
// ============================================================================

/**
 * Apply user preferences to filter and order plugin candidates.
 */
export function applyPreferences(
  slot: string,
  candidates: PluginCandidate[],
  prefs: PluginPreferences
): PluginCandidate[] {
  // Check if slot is disabled
  if (prefs.disabledSlots.has(slot)) {
    return [];
  }

  // Check for slot binding
  if (prefs.slotBindings.has(slot)) {
    const boundPlugin = prefs.slotBindings.get(slot);
    const bound = candidates.find(c => c.plugin === boundPlugin);
    return bound ? [bound] : [];
  }

  // Filter out disabled plugins
  return candidates.filter(c => !prefs.disabledPlugins.has(c.plugin));
}
