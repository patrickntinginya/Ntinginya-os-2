/** Remove characters that have a special meaning inside a PostgREST filter. */
export const cleanTerm = (raw) => String(raw ?? '').replace(/[,()%*\\":;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
