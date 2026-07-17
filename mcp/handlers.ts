import type { SkillIndex } from './index-build.js'
import { lookupSkill, auditSkills, searchSkills } from './lookup.js'

function wrap<T>(structuredContent: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent }
}

// Thin, pure wrappers: query logic + MCP content envelope. Tested directly; server.ts just registers them.
export function makeHandlers(index: SkillIndex) {
  return {
    lookup: async (args: { hash?: string; name?: string }) => wrap(lookupSkill(index, args)),
    audit: async (args: { skills: { name?: string; hash?: string }[] }) => wrap(auditSkills(index, args.skills)),
    search: async (args: { query: string }) => wrap({ results: searchSkills(index, args.query) }),
  }
}
