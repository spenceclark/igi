// Meta Model API, Responses API, stateless (spec §10.1): store false, encrypted reasoning replayed by
// the caller. Retries rate limits and transient failures; anything else is an error.
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1'
export const MODEL = process.env.META_MODEL ?? 'muse-spark-1.3'
const PRICE = { input: 1.25, cached: 0.15, output: 4.25 } // USD per 1M tokens, muse-spark-1.3 standard
const RETRYABLE = new Set([429, 500, 502, 503, 504])
const ATTEMPTS = 4
// The Vessel proxy requests go through instead of Meta directly, once a script calls useVessel (its --vessel flag).
// Vessel forwards each request unchanged to its `meta` backend and keeps a copy for inspection; null means direct.
let vessel: string | null = null

/** Sends every later request through Vessel: VESSEL_URL, or Vessel's default local address. */
export function useVessel(url = process.env.VESSEL_URL || 'http://127.0.0.1:4550') {
  vessel = url.replace(/\/+$/, '')
  return vessel
}

/**
 * Where a request goes and the headers that label it. Direct, Meta's base URL and no extra headers. Through
 * Vessel, its `meta` backend's path, the caller's tag (the agent or script) and, given one, a session name that
 * groups a run's requests. Vessel strips its own headers before forwarding; the API key passes through untouched.
 */
export function route(tag: string, session?: string): { base: string; headers: Record<string, string> } {
  if (!vessel) return { base: BASE, headers: {} }
  return { base: `${vessel}/b/meta/v1`, headers: { 'X-Vessel-Tags': tag, ...(session ? { 'X-Vessel-Session': session } : {}) } }
}

export type Usage = { input: number; cached: number; output: number; reasoning: number; costUsd: number }

// The fields IGI reads. Output items are replayed to the API unchanged, whatever else they carry.
export type OutputItem =
  | { type: 'reasoning'; id: string; encrypted_content?: string; summary?: unknown[] }
  | { type: 'message'; id?: string; role: 'assistant'; content?: { type: string; text?: string }[] }
  | { type: 'function_call'; id?: string; call_id: string; name: string; arguments: string }
export type InputItem = OutputItem | { role: 'user'; content: string } | { type: 'function_call_output'; call_id: string; output: string }
type ApiUsage = { input_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } }
export type ModelResponse = { status?: string; output?: OutputItem[]; usage?: ApiUsage; incomplete_details?: unknown }

/** Token counts and cost in USD for one response; cached input tokens are charged at the cached rate. */
export function costOf(u: ApiUsage | undefined): Usage {
  const input = u?.input_tokens ?? 0
  const cached = u?.input_tokens_details?.cached_tokens ?? 0
  const output = u?.output_tokens ?? 0
  const costUsd = ((input - cached) * PRICE.input + cached * PRICE.cached + output * PRICE.output) / 1e6
  return { input, cached, output, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0, costUsd }
}

/**
 * Sends one Responses API request and returns the parsed response, with the time taken and the attempts made.
 * Nothing is stored on Meta's side; the reasoning comes back encrypted for the caller to send again next turn.
 * Rate limits, server errors and network failures are retried up to ATTEMPTS times; any other error throws.
 * `session` names the run's session when the request goes through Vessel; the agent's tag is spark.
 */
export async function respond(body: Record<string, unknown>, opts: { session?: string } = {}): Promise<{ response: ModelResponse; ms: number; attempts: number }> {
  const key = process.env.MODEL_API_KEY
  if (!key) throw new Error('MODEL_API_KEY is not set (server/.env or the environment)')
  const { base, headers } = route('spark', opts.session)
  const started = performance.now()
  for (let attempt = 1; ; attempt++) {
    let status = 0
    let detail = ''
    let retryAfter = 0
    try {
      const res = await fetch(`${base}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ model: MODEL, store: false, include: ['reasoning.encrypted_content'], ...body }),
        signal: AbortSignal.timeout(300_000),
      })
      const text = await res.text()
      if (res.ok) return { response: JSON.parse(text) as ModelResponse, ms: Math.round(performance.now() - started), attempts: attempt }
      status = res.status
      detail = text.slice(0, 2000)
      retryAfter = Number(res.headers.get('retry-after') ?? 0)
    } catch (e) {
      detail = (e as Error).message // network error or timeout: retry
    }
    if ((status && !RETRYABLE.has(status)) || attempt >= ATTEMPTS) throw new Error(`model request failed (HTTP ${status || 'none'}, attempt ${attempt}): ${detail}`)
    // Wait as Retry-After asks, otherwise 2, 4 or 8 seconds plus up to half a second of jitter.
    await new Promise((r) => setTimeout(r, retryAfter ? retryAfter * 1000 : 2 ** attempt * 1000 + Math.random() * 500))
  }
}
