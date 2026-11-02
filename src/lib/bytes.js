export function formatBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return '0 B'
  if (v < 1024) return `${Math.round(v)} B`
  if (v < 1048576) return `${Math.round(v / 1024)} KB`
  return `${(v / 1048576).toFixed(1)} MB`
}
