/**
 * Shared utilities for prompt queue UI components.
 */

/**
 * Truncate prompt text for display in queue list.
 * @param text The prompt text to truncate
 * @param maxLen Maximum length before truncation (default: 80 for desktop, 60 for mobile)
 */
export function truncatePrompt(text: string, maxLen = 80): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}
