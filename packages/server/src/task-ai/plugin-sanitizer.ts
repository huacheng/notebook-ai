import { createHash } from 'crypto';

export interface SanitizeResult {
  sanitized: string;
  original: string;
  findings: SanitizeFindings;
  risk_level: 'none' | 'low' | 'medium' | 'high';
}

export interface SanitizeFindings {
  categories_triggered: number[];
  modifications: number;
  hash_original: string;
  hash_sanitized: string;
}

interface SanitizeCategory {
  id: number;
  name: string;
  pattern?: RegExp;
  maxLength?: number;
  skip?: boolean;
}

const SANITIZE_CATEGORIES: SanitizeCategory[] = [
  // Category 1: Direct instruction + social engineering
  {
    id: 1,
    name: 'direct_instruction',
    pattern: /<!--[\s\S]*?-->|<\/?system>|ignore\s+previous/gi,
  },
  // Category 2: Markup format exploitation (unclosed code blocks)
  {
    id: 2,
    name: 'markup_exploit',
    pattern: /```[\s\S]*?```\s*$/g,
    skip: true, // Only detect, don't remove valid code blocks
  },
  // Category 3: Unicode hidden attacks
  {
    id: 3,
    name: 'unicode_hidden',
    pattern: /[\u200B-\u200D\u2060\u202A-\u202E\uFEFF]/g,
  },
  // Category 4: ANSI / terminal sequences
  {
    id: 4,
    name: 'ansi_terminal',
    pattern: /\x1b\[[0-9;]*[a-zA-Z]/g,
  },
  // Category 5: Resource exhaustion (length limit)
  {
    id: 5,
    name: 'resource_exhaust',
    maxLength: 600, // Allow 20% overflow buffer from 500 char limit
  },
  // Category 6: System format impersonation
  {
    id: 6,
    name: 'system_impersonate',
    pattern: /\{"step":|\.auto-signal|task-ai\(/g,
  },
  // Category 7: Encoding obfuscation
  {
    id: 7,
    name: 'encoding_obfuscate',
    pattern: /base64\s*-d|\\x[0-9a-fA-F]{2}/gi,
  },
  // Category 8: Two-stage loading
  {
    id: 8,
    name: 'two_stage_load',
    pattern: /curl\s+[^\n]*\||wget\s+[^\n]*\||\beval\s*\(/gi,
  },
  // Category 9: Cross-document domain convergence (N/A for output)
  {
    id: 9,
    name: 'domain_convergence',
    skip: true,
  },
  // Category 10: Command semantics injection
  {
    id: 10,
    name: 'command_injection',
    pattern: /--require=|--eval=|LD_PRELOAD/gi,
  },
];

// High-risk categories that should result in 'high' risk level
const HIGH_RISK_CATEGORIES = [1, 6, 7, 8, 10];

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function calculateRisk(findings: SanitizeFindings): SanitizeResult['risk_level'] {
  // Any high-risk category triggers 'high' risk level
  if (findings.categories_triggered.some(c => HIGH_RISK_CATEGORIES.includes(c))) {
    return 'high';
  }

  // 3+ modifications without high-risk categories
  if (findings.modifications >= 3) {
    return 'medium';
  }

  // Any modifications at all
  if (findings.modifications >= 1) {
    return 'low';
  }

  return 'none';
}

export function sanitizePluginOutput(raw: string): SanitizeResult {
  let sanitized = raw;
  const findings: SanitizeFindings = {
    categories_triggered: [],
    modifications: 0,
    hash_original: hash(raw),
    hash_sanitized: '',
  };

  for (const cat of SANITIZE_CATEGORIES) {
    if (cat.skip) continue;

    // Pattern-based sanitization
    if (cat.pattern) {
      const before = sanitized;
      sanitized = sanitized.replace(cat.pattern, '[REDACTED]');
      if (sanitized !== before) {
        if (!findings.categories_triggered.includes(cat.id)) {
          findings.categories_triggered.push(cat.id);
        }
        findings.modifications++;
      }
    }

    // Length-based truncation
    if (cat.maxLength && sanitized.length > cat.maxLength) {
      sanitized = sanitized.slice(0, cat.maxLength) + '...[TRUNCATED]';
      if (!findings.categories_triggered.includes(cat.id)) {
        findings.categories_triggered.push(cat.id);
      }
      findings.modifications++;
    }
  }

  findings.hash_sanitized = hash(sanitized);

  const risk_level = calculateRisk(findings);

  return { sanitized, original: raw, findings, risk_level };
}
