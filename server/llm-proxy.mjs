// Optional AI-assist proxy for the intelligent report reader.
//
//   ANTHROPIC_API_KEY=...  node server/llm-proxy.mjs          (listens on http://localhost:8787)
//   then set VITE_LLM_PROXY_URL=http://localhost:8787 in .env.local and restart the app.
//
// It receives only the labels the rule-based dictionary could not resolve (label, a few sample values and the
// cell location) and asks Claude which drilling concept each one is. The API key never reaches the browser.
// NOTE: written against the Anthropic TypeScript SDK but not exercised during development (no API key).
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();            // credentials from the environment
const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.ALLOW_ORIGIN ?? 'http://localhost:5173';

const SYSTEM = `You map column or row labels from oil and gas drilling reports onto a fixed dictionary of drilling concepts.
For each item you receive the label as written, a few sample values and where it sits in the workbook.
Choose the single best concept key from the provided list, or null when none fits - do not force a match.
Answer with JSON only, no prose: {"results":[{"key":"<item key>","concept":"<concept key or null>","confidence":<0..1>,"reason":"<short>"}]}`;

async function classify(body) {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ concepts: body.concepts, items: body.items }) }],
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The model declined this request.'), { status: 422 });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw Object.assign(new Error('The model did not return JSON.'), { status: 502 });
  return JSON.parse(text.slice(start, end + 1));
}

http.createServer(async (req, res) => {
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') return send(204, {});
  if (req.method !== 'POST' || req.url !== '/classify') return send(404, { error: 'not found' });
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) return send(413, { error: 'request too large' }); }
    const body = JSON.parse(raw);
    if (!Array.isArray(body.items) || !Array.isArray(body.concepts)) return send(400, { error: 'items and concepts are required' });
    send(200, await classify(body));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) send(401, { error: 'Anthropic credentials are missing or invalid on the proxy.' });
    else if (error instanceof Anthropic.RateLimitError) send(429, { error: 'Rate limited - try again shortly.' });
    else if (error instanceof Anthropic.APIError) send(error.status ?? 502, { error: error.message });
    else send(error.status ?? 500, { error: error.message ?? String(error) });
  }
}).listen(PORT, () => console.log(`AI-assist proxy on http://localhost:${PORT} (allowing ${ORIGIN})`));
