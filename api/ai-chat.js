// Vercel serverless function: /api/ai-chat (native Node runtime).
// All logic lives in ./_lib/ai/ (folders starting with "_" are not exposed as routes by Vercel).
import { handleAiRequest } from './_lib/ai/handler.js'
import { toWebRequest, sendWebResponse } from './_lib/ai/nodeAdapter.js'

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  try {
    await sendWebResponse(res, await handleAiRequest(await toWebRequest(req)))
  } catch (e) {
    // Never include stack traces or request data in the response or the log.
    console.error('ai-chat adapter failed:', e?.code || e?.name || 'unknown')
    if (!res.headersSent) {
      res.statusCode = e?.code === 'too_large' ? 413 : 500
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
    }
    res.end(JSON.stringify({ error: e?.code === 'too_large' ? 'too_large' : 'server_error', message: 'Something went wrong. Please try again.' }))
  }
}
