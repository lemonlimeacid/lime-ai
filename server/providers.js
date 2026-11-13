import { runLocalEngine, localUpgradePrompt } from './local-engine.js';

/**
 * Passerelle multi-fournisseurs.
 * Toutes les API "OpenAI compatibles" passent par le même chemin :
 * OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Perplexity,
 * Ollama (localhost:11434/v1), LM Studio, vLLM, llama.cpp server, etc.
 */

export const PROVIDER_PRESETS = [
  {
    id: 'local',
    label: 'Lime Engine (local, no key)',
    kind: 'local',
    baseUrl: '',
    models: ['lime-mini'],
    hint: 'Built-in engine: codes small projects, chats, and searches the web. No key required.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    hint: 'sk-… key available at platform.openai.com',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    hint: 'sk-ant-… key available at console.anthropic.com',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    hint: 'AI Studio key (aistudio.google.com/apikey)',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (300+ models)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    hint: 'One key for all models: openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq (very fast)',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'],
    hint: 'Free key at console.groq.com',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    hint: 'Key at console.mistral.ai',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: 'Key at platform.deepseek.com',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3-mini'],
    hint: 'Key at console.x.ai',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    hint: 'Key at api.together.xyz',
  },
  {
    id: 'ollama',
    label: 'Ollama (100% local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5-coder:7b', 'llama3.2:3b', 'deepseek-coder-v2'],
    noKey: true,
    hint: 'Run `ollama serve`, then `ollama pull qwen2.5-coder:7b`. No key needed.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (100% local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: ['local-model'],
    noKey: true,
    hint: 'Enable the local server in LM Studio (port 1234). No key needed.',
  },
  {
    id: 'vllm',
    label: 'vLLM / llama.cpp / custom server',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    models: ['default'],
    noKey: true,
    hint: 'Any server exposing /v1/chat/completions',
  },
];

/* Niveaux de performance proposés par le sélecteur de modèles. Les modèles qui
 * n'ont pas de niveaux propres héritent de ceux de leur fournisseur. */
const PROVIDER_REASONING = {
  local: ['low', 'medium'],
  openai: ['low', 'medium', 'high'],
  anthropic: ['low', 'medium', 'high'],
  google: ['low', 'medium', 'high', 'max'],
  openrouter: ['low', 'medium', 'high'],
  groq: ['low', 'medium', 'high'],
  mistral: ['low', 'medium', 'high'],
  deepseek: ['low', 'medium', 'high'],
  xai: ['low', 'medium', 'high'],
  together: ['low', 'medium', 'high'],
  ollama: ['low', 'medium'],
  lmstudio: ['low', 'medium'],
  vllm: ['low', 'medium', 'high'],
  custom: ['low', 'medium', 'high'],
};

const MODEL_REASONING = {
  'lime-mini': ['low', 'medium'],
  'o4-mini': ['low', 'medium', 'high'],
  'claude-haiku-4-5': ['low', 'medium'],
  'claude-sonnet-4-5': ['low', 'medium', 'high'],
  'claude-opus-4-1': ['medium', 'high'],
  'gemini-2.5-pro': ['low', 'medium', 'high', 'max'],
  'gemini-2.5-flash': ['low', 'medium', 'high'],
  'deepseek-reasoner': ['medium', 'high', 'max'],
  'deepseek-chat': ['low', 'medium', 'high'],
  'grok-4': ['low', 'medium', 'high'],
  'qwen/qwen3-32b': ['low', 'medium', 'high'],
  'qwen2.5-coder:7b': ['low', 'medium'],
};

for (const preset of PROVIDER_PRESETS) {
  preset.reasoning = PROVIDER_REASONING[preset.id] || ['low', 'medium', 'high'];
  preset.modelReasoning = Object.fromEntries(
    Object.entries(MODEL_REASONING).filter(([model]) => preset.models.includes(model))
  );
}

export function getPreset(id) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) || PROVIDER_PRESETS[0];
}

export function getReasoningLevels(provider, model) {
  const preset = getPreset(provider);
  return preset.modelReasoning?.[model] || preset.reasoning || ['low', 'medium', 'high'];
}

function normalizeBase(baseUrl, preset) {
  const url = String(baseUrl || preset.baseUrl || '').trim().replace(/\/+$/, '');
  return url;
}

function withTimeout(signal, ms = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timed out')), ms);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      yield line;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield buffer.trim();
}

async function readError(response) {
  const text = await response.text().catch(() => '');
  let detail = text;
  try {
    const json = JSON.parse(text);
    detail = json?.error?.message || json?.message || json?.error || text;
    if (typeof detail === 'object') detail = JSON.stringify(detail);
  } catch {
    /* texte brut */
  }
  const hints = {
    401: 'API key is invalid or missing.',
    403: 'Access denied (key, permissions, or country).',
    404: 'Endpoint or model not found — check the base URL and model name.',
    429: 'Quota or rate limit reached.',
    500: 'Provider internal error.',
    503: 'Provider service unavailable.',
  };
  const hint = hints[response.status] ? ` ${hints[response.status]}` : '';
  return `Provider error ${response.status}.${hint}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function estimateUsage({ preset, model, system, messages, completion }) {
  const prompt = [
    system,
    ...messages.map((message) => `${message.role}: ${message.content}`),
  ].join('\n');
  return {
    provider: preset.id,
    model: model || preset.models[0],
    promptTokens: estimateTokens(prompt),
    completionTokens: estimateTokens(completion),
    estimated: true,
  };
}

function mergeRoles(messages) {
  const out = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = String(message.content ?? '');
    if (!content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  if (!out.length) out.push({ role: 'user', content: 'Hello' });
  if (out[0].role !== 'user') out.unshift({ role: 'user', content: '(context)' });
  return out;
}

/* ── OpenAI compatible ───────────────────────────────────────────────────── */

async function streamOpenAI({ preset, baseUrl, apiKey, model, temperature, messages, system, reasoningEffort }, onDelta, signal) {
  const url = `${normalizeBase(baseUrl, preset)}/chat/completions`;
  const selectedModel = model || preset.models[0];
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (preset.id === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost';
    headers['X-Title'] = 'Lime AI';
  }

  const requestBody = {
    model: selectedModel,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    stream: true,
  };
  // L'API OpenAI n'accepte reasoning_effort que sur les modèles de raisonnement.
  if (reasoningEffort && /(^o\d|o[1-9]|gpt-5|deepseek-reasoner|qwen3|grok-4)/i.test(selectedModel)) {
    requestBody.reasoning_effort = reasoningEffort;
  }

  const timeout = withTimeout(signal);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal: timeout.signal,
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    timeout.dispose();
    throw new Error(
      `Unable to connect to ${url}. ${error.message}. Check the base URL (and that the local server is running).`
    );
  }

  if (!response.ok) {
    timeout.dispose();
    throw new Error(await readError(response));
  }

  let full = '';
  try {
    for await (const line of sseLines(response)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error.message || 'Provider error');
      const choice = json.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
      const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? '';
      if (reasoning) onDelta?.(reasoning, 'reasoning');
      if (delta) {
        full += delta;
        onDelta?.(delta, 'text');
      }
    }
  } finally {
    timeout.dispose();
  }
  return full;
}

/* ── Anthropic ───────────────────────────────────────────────────────────── */

async function streamAnthropic({ preset, baseUrl, apiKey, model, temperature, messages, system }, onDelta, signal) {
  const base = normalizeBase(baseUrl, preset) || 'https://api.anthropic.com';
  const url = `${base}/v1/messages`;
  const timeout = withTimeout(signal);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal: timeout.signal,
      body: JSON.stringify({
        model: model || preset.models[0],
        max_tokens: 8192,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        system,
        messages: mergeRoles(messages),
        stream: true,
      }),
    });
  } catch (error) {
    timeout.dispose();
    throw new Error(`Unable to connect to ${url}. ${error.message}`);
  }
  if (!response.ok) {
    timeout.dispose();
    throw new Error(await readError(response));
  }

  let full = '';
  try {
    for await (const line of sseLines(response)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      if (json.type === 'error') throw new Error(json.error?.message || 'Anthropic error');
      if (json.type === 'content_block_delta' && json.delta?.text) {
        full += json.delta.text;
        onDelta?.(json.delta.text, 'text');
      }
    }
  } finally {
    timeout.dispose();
  }
  return full;
}

/* ── Google Gemini ───────────────────────────────────────────────────────── */

async function streamGoogle({ preset, baseUrl, apiKey, model, temperature, messages, system }, onDelta, signal) {
  const base = normalizeBase(baseUrl, preset) || 'https://generativelanguage.googleapis.com/v1beta';
  const modelId = String(model || preset.models[0]).replace(/^models\//, '');
  const url = `${base}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey || '')}`;
  const timeout = withTimeout(signal);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: timeout.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: mergeRoles(messages).map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: { temperature: typeof temperature === 'number' ? temperature : 0.7 },
      }),
    });
  } catch (error) {
    timeout.dispose();
    throw new Error(`Unable to connect to Google Gemini. ${error.message}`);
  }
  if (!response.ok) {
    timeout.dispose();
    throw new Error(await readError(response));
  }

  let full = '';
  try {
    for await (const line of sseLines(response)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const parts = json.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.text) {
          full += part.text;
          onDelta?.(part.text, 'text');
        }
      }
      if (json.promptFeedback?.blockReason) {
        throw new Error(`Request blocked by Gemini (${json.promptFeedback.blockReason})`);
      }
    }
  } finally {
    timeout.dispose();
  }
  return full;
}

/* ── Entrée publique ─────────────────────────────────────────────────────── */

export async function streamChat(params, handlers = {}) {
  const preset = getPreset(params.provider);
  const messages = (params.messages || []).map((m) => ({ role: m.role, content: m.content }));
  const system = params.system || 'You are a helpful assistant.';
  const reportUsage = (completion) => {
    handlers.onUsage?.(estimateUsage({
      preset,
      model: params.model || preset.models[0],
      system,
      messages,
      completion,
    }));
  };

  if (preset.kind === 'local') {
    let full = '';
    const iterator = runLocalEngine({
      prompt: messages.filter((m) => m.role === 'user').at(-1)?.content || '',
      history: messages,
      project: params.project,
      files: params.files || [],
      settings: params.settings || {},
      system,
      onSearch: handlers.onSearch,
    });
    for await (const chunk of iterator) {
      if (handlers.signal?.aborted) break;
      full += chunk;
      handlers.onDelta?.(chunk, 'text');
    }
    reportUsage(full);
    return full;
  }

  if (!params.apiKey && !preset.noKey) {
    throw new Error(
      `No API key for ${preset.label}. Open Settings → AI Connection to add one, or choose Lime Engine (local).`
    );
  }

  const common = {
    preset,
    baseUrl: params.baseUrl || preset.baseUrl,
    apiKey: params.apiKey || '',
    model: params.model || preset.models[0],
    temperature: params.temperature,
    reasoningEffort: params.settings?.reasoningEffort,
    messages,
    system,
  };

  let full;
  if (preset.kind === 'anthropic') full = await streamAnthropic(common, handlers.onDelta, handlers.signal);
  else if (preset.kind === 'google') full = await streamGoogle(common, handlers.onDelta, handlers.signal);
  else full = await streamOpenAI(common, handlers.onDelta, handlers.signal);
  reportUsage(full);
  return full;
}

export async function listModels({ provider, baseUrl, apiKey }) {
  const preset = getPreset(provider);
  if (preset.kind === 'local') return ['lime-mini'];

  try {
    if (preset.kind === 'google') {
      const url = `${normalizeBase(baseUrl, preset)}/models?key=${encodeURIComponent(apiKey || '')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readError(res));
      const json = await res.json();
      return (json.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, ''));
    }

    const base = normalizeBase(baseUrl, preset);
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (preset.kind === 'anthropic') {
      headers['x-api-key'] = apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
    }
    const url = preset.kind === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(await readError(res));
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
    return list.map((m) => m.id || m.name).filter(Boolean);
  } catch (error) {
    const fallback = preset.models;
    return fallback.concat([`Warning — ${error.message}`]).slice(0, 40);
  }
}

export async function enhancePrompt({ prompt, provider, model, apiKey, baseUrl, temperature, onUsage }) {
  const preset = getPreset(provider);
  if (preset.kind === 'local') return localUpgradePrompt(prompt);

  const system =
    'You are an expert in product specifications and prompt engineering. Rewrite the user’s request into a clear, structured, actionable specification for a coding agent. Keep the same language. Be concrete (screens, components, data, interactions, style, accessibility, expected files). Respond only with the final prompt, without preamble.';
  const text = await streamChat(
    {
      provider,
      model,
      apiKey,
      baseUrl,
      temperature: 0.4,
      system,
      messages: [{ role: 'user', content: prompt }],
      settings: {},
    },
    { onUsage }
  );
  return text.trim() || localUpgradePrompt(prompt);
}
