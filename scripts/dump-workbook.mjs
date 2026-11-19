// Read-only dump of every populated cell in a workbook (for inspecting real reports).
// Usage: node scripts/dump-workbook.mjs <file.xlsx> [out.txt]
import XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'node:fs'

const [file, out] = process.argv.slice(2)
const wb = XLSX.read(readFileSync(file), { cellNF: true, cellStyles: true, cellFormula: true, cellDates: false })
const lines = []
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const meta = wb.Workbook?.Sheets?.find((s) => s.name === name)
  lines.push(`\n===== SHEET "${name}" ref=${ws['!ref']} hidden=${meta?.Hidden ?? 0} merges=${(ws['!merges'] || []).length}`)
  for (const m of ws['!merges'] || []) lines.push(`  MERGE ${XLSX.utils.encode_range(m)}`)
  const hr = (ws['!rows'] || []).map((r, i) => (r?.hidden ? i + 1 : null)).filter(Boolean)
  const hc = (ws['!cols'] || []).map((c, i) => (c?.hidden ? XLSX.utils.encode_col(i) : null)).filter(Boolean)
  if (hr.length) lines.push(`  HIDDEN ROWS ${hr.join(',')}`)
  if (hc.length) lines.push(`  HIDDEN COLS ${hc.join(',')}`)
  const keys = Object.keys(ws).filter((k) => !k.startsWith('!'))
  keys.sort((a, b) => {
    const A = XLSX.utils.decode_cell(a), B = XLSX.utils.decode_cell(b)
    return A.r - B.r || A.c - B.c
  })
  for (const k of keys) {
    const c = ws[k]
    if (c.v === undefined || c.v === null || c.v === '') continue
    const v = typeof c.v === 'string' ? JSON.stringify(c.v) : String(c.v)
    lines.push(`  ${k} [${c.t}] ${v}${c.w && c.w !== String(c.v) ? `  w=${JSON.stringify(c.w)}` : ''}${c.f ? `  f==${c.f}` : ''}`)
  }
}
const text = lines.join('\n')
if (out) writeFileSync(out, text)
else console.log(text)
