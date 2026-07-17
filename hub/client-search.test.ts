import { describe, it, expect } from 'vitest'
// @ts-expect-error plain JS module, no types
import { filterSort, paginate } from './client-search.js'

const idx = [
  { name: 'alpha', overall: 'A', category: 'workflow', tagline: 'x', popularity: 3 },
  { name: 'bravo', overall: 'D', category: 'security', tagline: 'y', popularity: 9 },
  { name: 'charlie', overall: 'B', category: 'workflow', tagline: 'z', popularity: 1 },
]

describe('filterSort', () => {
  it('filters by query substring (name/tagline)', () => {
    expect(filterSort(idx, { q: 'brav' }).map((r: any) => r.name)).toEqual(['bravo'])
  })
  it('filters by minGrade (A best)', () => {
    expect(filterSort(idx, { minGrade: 'B' }).map((r: any) => r.name).sort()).toEqual(['alpha', 'charlie'])
  })
  it('filters by category', () => {
    expect(filterSort(idx, { category: 'security' }).map((r: any) => r.name)).toEqual(['bravo'])
  })
  it('sorts by popularity desc', () => {
    expect(filterSort(idx, { sort: 'popularity' }).map((r: any) => r.name)).toEqual(['bravo', 'alpha', 'charlie'])
  })
})

describe('paginate', () => {
  it('slices a page and reports hasMore', () => {
    expect(paginate([1, 2, 3, 4, 5], 0, 2)).toEqual({ rows: [1, 2], hasMore: true })
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ rows: [5], hasMore: false })
  })
})
