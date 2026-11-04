export async function consumeAiRequest(client) {
  try {
    const { data, error } = await client.rpc('consume_ai_request')
    const decision = Array.isArray(data) ? data[0] : null
    if (error || typeof decision?.allowed !== 'boolean') return { available: false }
    return { available: true, allowed: decision.allowed, reason: decision.reason || null }
  } catch {
    return { available: false }
  }
}
