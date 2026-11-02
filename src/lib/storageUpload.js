// One tested way to upload a file to a private Storage bucket, with REAL progress when possible (chat attachments, voice messages, voice posts and comments).
// Tries the Storage REST endpoint through XMLHttpRequest (the only way to get upload progress in a browser); if the server refuses that request style
// (400/415) it falls back to supabase-js, which has no progress callback but is the supported path. Aborts and real failures (network, timeout, 401/403/413)
// are NOT retried through the fallback. Not yet verified against a real Supabase project (docs/VOICE.md).
import { uploadWithProgress } from './uploadProgress.js'
import { baseMime } from './voiceFormat.js'

const check = ({ error }) => { if (error) throw error }

export async function uploadToBucket(client, bucket, path, file, { onProgress = null, signal = null, uploadFn = uploadWithProgress } = {}) {
  const type = baseMime(file.type) || undefined // "audio/webm;codecs=opus" -> "audio/webm": bucket allow-lists compare the plain type
  if (onProgress && client.supabaseUrl && client.auth && client.auth.getSession) {
    const { data } = await client.auth.getSession()
    const token = data && data.session && data.session.access_token
    if (token) {
      try {
        await uploadFn({ url: `${client.supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, headers: { Authorization: `Bearer ${token}`, apikey: client.supabaseKey, 'x-upsert': 'false' }, body: file, contentType: type, onProgress, signal })
        return
      } catch (e) {
        if (!(e && (e.status === 400 || e.status === 415))) throw e
      }
    }
  }
  check(await client.storage.from(bucket).upload(path, file, { contentType: type, upsert: false }))
}

/**
 * True when Storage says the object is already there (HTTP 409 / "The resource already exists"). A chat upload path contains the message's own
 * client id and only its sender can write under it, so this means "this very attempt was already uploaded": a RETRY after a failed message insert
 * may continue instead of failing for ever. (Never use this for paths that are not unique to one attempt.)
 */
export function isAlreadyUploaded(e) {
  if (!e) return false
  const status = Number(e.status ?? e.statusCode)
  const msg = String(e.message || e.error || '').toLowerCase()
  return status === 409 || /already exists|duplicate/.test(msg)
}
