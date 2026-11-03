export async function consumeAiRequest(client, { dailyLimit, burstLimit, enforceDaily = true }) {
  try {
    const { data, error } = await client.rpc('consume_ai_request', {
      p_daily_limit: dailyLimit,
      p_burst_limit: burstLimit,
      p_enforce_daily: enforceDaily,
    })
    const decision = Array.isArray(data) ? data[0] : null
    if (error || typeof decision?.allowed !== 'boolean') return { available: false }
    return { available: true, allowed: decision.allowed, reason: decision.reason || null }
  } catch {
    return { available: false }
  }
}
