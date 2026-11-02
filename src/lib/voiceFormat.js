// Voice message formats and limits. The limits are ALSO enforced by the database (migration 011: <= 5 min, <= 5 MB, audio MIME, duration required),
// so a modified client cannot skip them; the checks here give the person a friendly message before anything is uploaded.
export const VOICE = {
  maxMs: 300000, // 5 minutes
  minMs: 500, // shorter recordings are almost always an accidental tap
  maxBytes: 5242880, // 5 MB
  bitrate: 24000, // Opus at 24 kbit/s is clear for speech and about 180 KB per minute
  bitrateMp4: 32000, // AAC (Safari / iOS) needs a little more for the same clarity
}
// The container types the chat bucket accepts for a recording (a subset of its allow-list).
export const VOICE_BASES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac']
// Best first. Chrome / Edge / Firefox / Android WebView -> WebM or Ogg Opus; Safari / iOS -> MP4 AAC.
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac']

/** "audio/webm;codecs=opus" -> "audio/webm" (the bucket compares the plain type). */
export const baseMime = (m) => String(m || '').split(';')[0].trim().toLowerCase()
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac' }
export const voiceExt = (base) => EXT[baseMime(base)] || 'webm'

/** { mime, base, bitrate } for the first format this browser can record, or null when MediaRecorder cannot record audio at all. */
export function pickVoiceFormat(Rec) {
  if (!Rec) return null
  if (typeof Rec.isTypeSupported !== 'function') return { mime: '', base: '', bitrate: VOICE.bitrate } // let the browser choose; the real type is read from the recording
  for (const mime of CANDIDATES) {
    if (Rec.isTypeSupported(mime)) { const base = baseMime(mime); return { mime, base, bitrate: base === 'audio/mp4' || base === 'audio/aac' ? VOICE.bitrateMp4 : VOICE.bitrate } }
  }
  return null
}

const p2 = (n) => String(n).padStart(2, '0')
export function voiceFileName(base, d = new Date()) {
  return `voice-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${voiceExt(base)}`
}

/** null when the recording may be sent, else an English phrase (the screens pass it through tr()). */
export function validateVoice({ durationMs, size, mime } = {}) {
  if (!Number.isFinite(durationMs) || durationMs < VOICE.minMs) return 'That recording is too short.'
  if (durationMs > VOICE.maxMs + 1500) return 'Voice messages can be up to 5 minutes long.'
  if (!(size > 0)) return 'The recording is empty.'
  if (size > VOICE.maxBytes) return 'That voice message is larger than 5 MB.'
  if (!VOICE_BASES.includes(baseMime(mime))) return 'This device recorded in a format that cannot be sent.'
  return null
}

/** 0:07, 1:05, 12:30. */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  return `${Math.floor(s / 60)}:${p2(s % 60)}`
}

/**
 * Where playback is, 0..1. A MediaRecorder WebM file usually reports `duration = Infinity`, so the length we STORED when recording is the truth;
 * the element's own duration is used only when nothing was stored.
 */
export function playbackFraction(currentSec, storedMs, elementDurationSec) {
  const total = storedMs > 0 ? storedMs / 1000 : Number.isFinite(elementDurationSec) && elementDurationSec > 0 ? elementDurationSec : 0
  if (!total) return 0
  return Math.min(1, Math.max(0, (Number(currentSec) || 0) / total))
}
