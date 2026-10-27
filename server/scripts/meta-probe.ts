// Gate B probe for the Meta Model API (spec §10.1): one tool-calling round trip on Chat Completions
// and one on the Responses API (stateless: store false, encrypted reasoning replayed), recording
// latency, rate-limit headers, usage and estimated cost. Prints JSON to stdout.
// Run: node --env-file-if-exists=.env scripts/meta-probe.ts   (needs MODEL_API_KEY)
const KEY = process.env.MODEL_API_KEY
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1'
const MODEL = process.env.META_MODEL ?? 'muse-spark-1.3'
const PRICE = { input: 1.25, cached: 0.15, output: 4.25 } // USD per 1M tokens, muse-spark-1.3 standard
if (!KEY) {
  console.error('MODEL_API_KEY is not set. Put it in server/.env (gitignored) or the environment.')
  process.exit(2)
}

const PROMPT =
  'Portfolio P1 holdings should sum to 100% by weight. Use the read_data tool to check, then answer in one sentence with the total.'
const TOOL = {
  name: 'read_data',
  description: 'Returns rows from one review source. Numbers are decimal strings.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: ['holdings'] },
      portfolio: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['source', 'portfolio', 'limit'],
    additionalProperties: false,
  },
}
const ROWS = [
  { portfolio: 'P1', holding: 'Fund A', weight: '0.1250' },
  { portfolio: 'P1', holding: 'Fund B', weight: '0.3333' },
  { portfolio: 'P1', holding: 'Fund C', weight: '0.5417' },
]

type Call = Record<string, unknown>
const calls: Call[] = []

async function post(surface: string, step: number, path: string, body: unknown): Promise<any> {
  const t = performance.now()
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const ms = Math.round(performance.now() - t)
  const text = await res.text()
  const rate = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-ratelimit') || k === 'retry-after'))
  const call: Call = { surface, step, status: res.status, ms, rate, headerNames: [...res.headers.keys()] }
  calls.push(call)
  if (!res.ok) {
    call.error = text.slice(0, 2000)
    throw new Error(`${surface} step ${step}: HTTP ${res.status}`)
  }
  const json = JSON.parse(text)
  const u = json.usage ?? {}
  const input = u.prompt_tokens ?? u.input_tokens ?? 0
  const output = u.completion_tokens ?? u.output_tokens ?? 0
  const cached = (u.prompt_tokens_details ?? u.input_tokens_details)?.cached_tokens ?? 0
  call.usage = u
  call.costUsd = Number((((input - cached) * PRICE.input + cached * PRICE.cached + output * PRICE.output) / 1e6).toFixed(6))
  return json
}

// Validates arguments the way IGI will: never trust the model's JSON.
function runTool(name: string, rawArgs: string) {
  const args = JSON.parse(rawArgs)
  if (name !== 'read_data' || args.source !== 'holdings') return { error: `unknown tool or source` }
  return { rows: ROWS.filter((r) => r.portfolio === args.portfolio).slice(0, args.limit) }
}

async function chatCompletions() {
  const messages: any[] = [{ role: 'user', content: PROMPT }]
  const req = { model: MODEL, tools: [{ type: 'function', function: TOOL }], reasoning_effort: 'medium', max_completion_tokens: 4000 }
  const first = await post('chat', 1, '/chat/completions', { ...req, messages })
  const msg = first.choices[0].message
  calls.at(-1)!.finish = first.choices[0].finish_reason
  calls.at(-1)!.toolCalls = msg.tool_calls?.map((c: any) => ({ name: c.function.name, arguments: c.function.arguments }))
  if (!msg.tool_calls?.length) throw new Error('chat: no tool call')
  messages.push(msg)
  for (const c of msg.tool_calls) messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(runTool(c.function.name, c.function.arguments)) })
  const second = await post('chat', 2, '/chat/completions', { ...req, messages })
  calls.at(-1)!.finish = second.choices[0].finish_reason
  calls.at(-1)!.answer = second.choices[0].message.content
}

async function responses() {
  const input: any[] = [{ role: 'user', content: PROMPT }]
  const req = {
    model: MODEL,
    tools: [{ type: 'function', ...TOOL }],
    reasoning: { effort: 'medium' },
    max_output_tokens: 4000,
    store: false,
    include: ['reasoning.encrypted_content'],
  }
  const first = await post('responses', 1, '/responses', { ...req, input })
  const items: any[] = first.output ?? []
  const fnCalls = items.filter((i) => i.type === 'function_call')
  // An output-token cut-off mid-reasoning also yields no function call; record which it was.
  calls.at(-1)!.responseStatus = first.status
  calls.at(-1)!.incomplete = first.incomplete_details
  calls.at(-1)!.outputTypes = items.map((i) => i.type)
  calls.at(-1)!.encryptedReasoning = items.some((i) => i.type === 'reasoning' && i.encrypted_content)
  calls.at(-1)!.toolCalls = fnCalls.map((c) => ({ name: c.name, arguments: c.arguments }))
  if (!fnCalls.length) throw new Error('responses: no function call')
  // Replay everything the model produced (reasoning needs a summary field), then the tool outputs.
  for (const i of items) input.push(i.type === 'reasoning' ? { ...i, summary: i.summary ?? [] } : i)
  for (const c of fnCalls) input.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(runTool(c.name, c.arguments)) })
  const second = await post('responses', 2, '/responses', { ...req, input })
  calls.at(-1)!.outputTypes = second.output?.map((i: any) => i.type)
  calls.at(-1)!.answer = second.output_text ?? second.output?.filter((i: any) => i.type === 'message').flatMap((m: any) => m.content.map((c: any) => c.text)).join('')
}

const results: Record<string, string> = {}
for (const [name, fn] of [['chat', chatCompletions], ['responses', responses]] as const) {
  try {
    await fn()
    results[name] = 'ok'
  } catch (e) {
    results[name] = (e as Error).message
  }
}
const totalCostUsd = Number(calls.reduce((s, c) => s + ((c.costUsd as number) ?? 0), 0).toFixed(6))
console.log(JSON.stringify({ at: new Date().toISOString(), model: MODEL, results, totalCostUsd, calls }, null, 2))
process.exit(Object.values(results).every((r) => r === 'ok') ? 0 : 1)
