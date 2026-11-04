export async function consumeAiRequest(client, { purpose = 'chat' } = {}) {
  try {
    const rpc = purpose === 'ping'
      ? 'consume_ai_ping'
      : purpose === 'safe_mode_support'
        ? 'consume_ai_safe_mode_support'
        : 'consume_ai_request'
    const { data, error } = await client.rpc(rpc)
    const decision = Array.isArray(data) ? data[0] : null
    if (error || typeof decision?.allowed !== 'boolean') return { available: false }
    return { available: true, allowed: decision.allowed, reason: decision.reason || null }
  } catch {
    return { available: false }
  }
}
