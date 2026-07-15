import type { Severity } from '../src/types.js'

export interface PatternRule { rule: string; re: RegExp; severity: Severity }

export const PATTERN_RULES: PatternRule[] = [
  { rule: 'piped-shell', severity: 'critical', re: /\b(curl|wget|iwr|invoke-webrequest)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z|fi|da)?sh\b|\biwr\b[^\n]{0,200}\|\s*iex\b/i },
  { rule: 'destructive-rm', severity: 'critical', re: /\brm\s+-[a-z]*[rf][a-z]*[rf][a-z]*\s+(\/(?!tmp)|~|"?\$HOME)/i },
  { rule: 'secret-paths', severity: 'major', re: /~\/\.(ssh|aws|gnupg|netrc|config\/gh)\b|id_(rsa|ed25519)\b|(^|[^.\w])\.env\b/i },
  { rule: 'env-secret-read', severity: 'major', re: /\$\{?[A-Z_]*(API_?KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*\}?/ },
  { rule: 'base64-blob', severity: 'major', re: /[A-Za-z0-9+/]{120,}={0,2}/ },
  { rule: 'eval-exec', severity: 'major', re: /\beval\s*[( ]|child_process|\bexecSync\b/i },
  { rule: 'hardcoded-url-post', severity: 'major', re: /\b(curl|wget|fetch|axios|httpx?|requests)\b[^\n]{0,200}\b(POST|--data|-d |--upload|-T )/i },
  { rule: 'sudo', severity: 'minor', re: /\bsudo\b/ },
]

export const CANARY_RULES: PatternRule[] = [
  { rule: 'canary-override', severity: 'critical', re: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions|disregard\s+(the\s+)?(above|previous)/i },
  { rule: 'canary-evaluator', severity: 'critical', re: /rate\s+this\s+(skill\s+)?(an?\s+)?["']?[AB]\b|mark\s+(all|every)\s+checks?\s+as\s+pass|(this|the)\s+skill\s+is\s+(safe|trusted),?\s+(no\s+)?(further\s+)?(review|evaluation)/i },
  { rule: 'canary-role-hijack', severity: 'critical', re: /you\s+are\s+(now|no\s+longer)\b|new\s+system\s+prompt|<\/?system>/i },
  // Literal invisible chars, verbatim from plan: U+200B-200D, 2060, FEFF, 202D, 202E (verified matching).
  { rule: 'canary-hidden-chars', severity: 'critical', re: /[​-‍⁠﻿‭‮]/ },
  { rule: 'canary-html-comment-directive', severity: 'critical', re: /<!--(?:(?!-->)[\s\S]){0,500}?\b(you|claude|assistant|evaluator|model)\b(?:(?!-->)[\s\S])*?-->/i },
]
