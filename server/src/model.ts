// Meta Model API, Responses API, stateless (spec §10.1): store false, encrypted reasoning replayed by
// the caller. Retries rate limits and transient failures; anything else is an error.
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1'
export const MODEL = process.env.META_MODEL ?? 'muse-spark-1.3'
const PRICE = { input: 1.25, cached: 0.15, output: 4.25 } // USD per 1M tokens, muse-spark-1.3 standard
const RETRYABLE = new Set([429, 500, 502, 503, 504])
const ATTEMPTS = 4

export type Usage = { input: number; cached: number; output: number; reasoning: number; costUsd: number }

export function costOf(u: any): Usage {
  const input = u?.input_tokens ?? 0
  const cached = u?.input_tokens_details?.cached_tokens ?? 0
  const output = u?.output_tokens ?? 0
  const costUsd = ((input - cached) * PRICE.input + cached * PRICE.cached + output * PRICE.output) / 1e6
  return { input, cached, output, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0, costUsd }
}

export async function respond(body: Record<string, unknown>): Promise<{ response: any; ms: number; attempts: number }> {
  const key = process.env.MODEL_API_KEY
  if (!key) throw new Error('MODEL_API_KEY is not set (server/.env or the environment)')
  const started = performance.now()
  for (let attempt = 1; ; attempt++) {
    let status = 0
    let detail = ''
    let retryAfter = 0
    try {
      const res = await fetch(`${BASE}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, store: false, include: ['reasoning.encrypted_content'], ...body }),
        signal: AbortSignal.timeout(300_000),
      })
      const text = await res.text()
      if (res.ok) return { response: JSON.parse(text), ms: Math.round(performance.now() - started), attempts: attempt }
      status = res.status
      detail = text.slice(0, 2000)
      retryAfter = Number(res.headers.get('retry-after') ?? 0)
    } catch (e) {
      detail = (e as Error).message // network error or timeout: retry
    }
    if ((status && !RETRYABLE.has(status)) || attempt >= ATTEMPTS) throw new Error(`model request failed (HTTP ${status || 'none'}, attempt ${attempt}): ${detail}`)
    await new Promise((r) => setTimeout(r, retryAfter ? retryAfter * 1000 : 2 ** attempt * 1000 + Math.random() * 500))
  }
}
