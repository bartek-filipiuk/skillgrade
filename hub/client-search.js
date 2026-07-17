// Pure, framework-free browse logic — imported by the hub page (as an ES module)
// and by the vitest test. No DOM here.
export const GRADE_ORDER = { A: 0, B: 1, C: 2, D: 3, F: 4, 'not-evaluated': 9 }

export function filterSort(index, opts) {
  const o = opts || {}
  const q = (o.q || '').toLowerCase()
  const minGrade = o.minGrade || 'F'
  const category = o.category || 'all'
  const sort = o.sort || 'grade'
  const maxRank = GRADE_ORDER[minGrade]
  let rows = index.filter(function (r) {
    if (q && !((r.name || '').toLowerCase().includes(q) || (r.tagline || '').toLowerCase().includes(q))) return false
    if (category !== 'all' && r.category !== category) return false
    if ((GRADE_ORDER[r.overall] != null ? GRADE_ORDER[r.overall] : 9) > maxRank) return false
    return true
  })
  rows = rows.slice().sort(function (a, b) {
    if (sort === 'popularity') return (b.popularity || 0) - (a.popularity || 0)
    if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
    return (GRADE_ORDER[a.overall] - GRADE_ORDER[b.overall]) || (b.popularity || 0) - (a.popularity || 0)
  })
  return rows
}

export function paginate(list, page, pageSize) {
  const start = page * pageSize
  const rows = list.slice(start, start + pageSize)
  return { rows: rows, hasMore: start + pageSize < list.length }
}
