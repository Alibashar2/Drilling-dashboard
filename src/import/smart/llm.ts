// Optional AI assistance for labels the rule-based dictionary cannot resolve. The engine is fully functional
// without it. When VITE_LLM_PROXY_URL is set, unresolved labels can be sent to a small backend proxy
// (server/llm-proxy.mjs) that asks Claude to map them onto the drilling dictionary. The API key lives only on
// the proxy. Answers come back as *suggestions* (status "suspected") that the engineer confirms.
import { CONCEPTS } from './dictionary';
import type { Unresolved } from './engine';

const env = import.meta.env as Record<string, string | undefined>;
export const LLM_PROXY_URL = env?.VITE_LLM_PROXY_URL?.trim() || '';
export const llmAvailable = () => !!LLM_PROXY_URL;

export interface LlmSuggestion { key: string; concept: string | null; confidence: number; reason: string }

export async function llmClassifyLabels(items: Unresolved[]): Promise<LlmSuggestion[]> {
  if (!LLM_PROXY_URL) throw new Error('AI assistance is not configured (set VITE_LLM_PROXY_URL and run server/llm-proxy.mjs).');
  const res = await fetch(`${LLM_PROXY_URL.replace(/\/$/, '')}/classify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: items.map(i => ({ key: i.key, label: i.header, samples: i.samples, location: i.src })),
      concepts: CONCEPTS.map(c => ({ key: c.key, label: c.label, group: c.group })),
    }),
  });
  if (!res.ok) throw new Error(`AI proxy returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { results?: LlmSuggestion[] };
  const valid = new Set(CONCEPTS.map(c => c.key));
  return (body.results ?? []).filter(r => r.concept == null || valid.has(r.concept));
}
