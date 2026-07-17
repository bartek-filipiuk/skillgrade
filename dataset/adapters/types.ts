// A discoverable skill: enough to fetch its SKILL.md and rank it by popularity.
export interface Candidate {
  sourceUrl: string // canonical https link to the SKILL.md (attribution + provenance)
  repo: string // "owner/name"
  path: string // path of SKILL.md within the repo
  ref: string // branch or sha
  stars: number // popularity signal (repo-level)
  pushedAt: string // ISO recency signal
}

// A source of candidates. New sources (ClawHub, aggregators) implement this — no core change.
export interface SourceAdapter {
  name: string
  discover(): AsyncIterable<Candidate>
}
