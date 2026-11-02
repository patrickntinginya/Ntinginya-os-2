// Upload a file with REAL progress (supabase-js's storage upload has no progress callback), using XMLHttpRequest against the documented
// Storage REST endpoint:  POST {url}/storage/v1/object/{bucket}/{path}  with the user's access token and the raw file as the body.
// If the server rejects that style (400/415) the caller falls back to supabase-js (no progress bar, but the message still sends).
// NOT verified against a real Supabase project yet (see docs/VOICE.md).
export class UploadError extends Error { constructor(message, status) { super(message); this.name = 'UploadError'; this.status = status } }

export function uploadWithProgress({ url, headers = {}, body, contentType, onProgress, signal, XHR = typeof XMLHttpRequest === 'undefined' ? null : XMLHttpRequest, timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    if (!XHR) { reject(new UploadError('no_xhr', 0)); return }
    const x = new XHR()
    x.open('POST', url, true)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    if (contentType) x.setRequestHeader('Content-Type', contentType)
    x.timeout = timeoutMs
    if (x.upload) x.upload.onprogress = (e) => { if (onProgress && e && e.lengthComputable && e.total > 0) onProgress({ loaded: e.loaded, total: e.total, percent: Math.min(100, Math.floor((e.loaded / e.total) * 100)) }) }
    x.onload = () => { if (x.status >= 200 && x.status < 300) { if (onProgress) onProgress({ loaded: 1, total: 1, percent: 100 }); resolve({ status: x.status }) } else reject(new UploadError(String(x.responseText || x.statusText || 'upload_failed').slice(0, 300), x.status)) }
    x.onerror = () => reject(new UploadError('network', 0))
    x.ontimeout = () => reject(new UploadError('timeout', 0))
    x.onabort = () => { const e = new UploadError('aborted', 0); e.name = 'AbortError'; reject(e) }
    if (signal) { if (signal.aborted) { x.abort(); return } signal.addEventListener('abort', () => x.abort(), { once: true }) }
    x.send(body)
  })
}
