import type { WorklistItem } from './dedup.js'

// The payload each grading subagent receives: identity + source + the SKILL.md text.
// Content is UNTRUSTED data to evaluate — the grading prompt must frame it as such.
export function buildBatchInput(
  wave: WorklistItem[],
  readContent: (hash: string) => string,
): { hash: string; name: string; sourceUrl: string; content: string }[] {
  return wave.map((i) => ({ hash: i.skillMdHash, name: i.name, sourceUrl: i.primarySourceUrl, content: readContent(i.skillMdHash) }))
}
