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
    label: 'Supernova Engine (local, sans clé)',
    kind: 'local',
    baseUrl: '',
    models: ['supernova-mini'],
    hint: 'Moteur intégré : code des petits projets, discute et cherche sur le web. Aucune clé requise.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    hint: 'Clé sk-… disponible sur platform.openai.com',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    hint: 'Clé sk-ant-… disponible sur console.anthropic.com',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    hint: 'Clé AI Studio (aistudio.google.com/apikey)',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (300+ modèles)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    hint: 'Une seule clé pour tous les modèles : openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq (très rapide)',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'],
    hint: 'Clé gratuite sur console.groq.com',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    hint: 'Clé sur console.mistral.ai',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: 'Clé sur platform.deepseek.com',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3-mini'],
    hint: 'Clé sur console.x.ai',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    hint: 'Clé sur api.together.xyz',
  },
  {
    id: 'ollama',
    label: 'Ollama (100% local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5-coder:7b', 'llama3.2:3b', 'deepseek-coder-v2'],
    noKey: true,
    hint: 'Lance `ollama serve` puis `ollama pull qwen2.5-coder:7b`. Aucune clé.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (100% local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: ['local-model'],
    noKey: true,
    hint: 'Active le serveur local dans LM Studio (port 1234). Aucune clé.',
  },
  {
    id: 'vllm',
    label: 'vLLM / llama.cpp / serveur custom',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    models: ['default'],
    noKey: true,
    hint: 'Tout serveur exposant /v1/chat/completions',
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
  'supernova-mini': ['low', 'medium'],
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
  const timer = setTimeout(() => controller.abort(new Error('Délai dépassé')), ms);
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
    401: 'Clé d’API invalide ou absente.',
    403: 'Accès refusé (clé, droits ou pays).',
    404: 'Endpoint ou modèle introuvable — vérifie l’URL de base et le nom du modèle.',
    429: 'Quota / limite de débit atteinte.',
    500: 'Erreur interne du fournisseur.',
    503: 'Service indisponible chez le fournisseur.',
  };
  const hint = hints[response.status] ? ` ${hints[response.status]}` : '';
  return `Erreur ${response.status} du fournisseur.${hint}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`;
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
  if (!out.length) out.push({ role: 'user', content: 'Bonjour' });
  if (out[0].role !== 'user') out.unshift({ role: 'user', content: '(contexte)' });
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
    headers['X-Title'] = 'Supernova IA';
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
      `Connexion impossible à ${url}. ${error.message}. Vérifie l’URL de base (et que le serveur local tourne).`
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
      if (json.error) throw new Error(json.error.message || 'Erreur du fournisseur');
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
    throw new Error(`Connexion impossible à ${url}. ${error.message}`);
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
      if (json.type === 'error') throw new Error(json.error?.message || 'Erreur Anthropic');
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
    throw new Error(`Connexion impossible à Google Gemini. ${error.message}`);
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
        throw new Error(`Requête bloquée par Gemini (${json.promptFeedback.blockReason})`);
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
  const system = params.system || 'Tu es un assistant utile.';

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
    return full;
  }

  if (!params.apiKey && !preset.noKey) {
    throw new Error(
      `Aucune clé d’API pour ${preset.label}. Ouvre Paramètres → Connexion IA pour l’ajouter, ou choisis Supernova Engine (local).`
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

  if (preset.kind === 'anthropic') return streamAnthropic(common, handlers.onDelta, handlers.signal);
  if (preset.kind === 'google') return streamGoogle(common, handlers.onDelta, handlers.signal);
  return streamOpenAI(common, handlers.onDelta, handlers.signal);
}

export async function listModels({ provider, baseUrl, apiKey }) {
  const preset = getPreset(provider);
  if (preset.kind === 'local') return ['supernova-mini'];

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
    return fallback.concat([`Attention — ${error.message}`]).slice(0, 40);
  }
}

export async function enhancePrompt({ prompt, provider, model, apiKey, baseUrl, temperature }) {
  const preset = getPreset(provider);
  if (preset.kind === 'local') return localUpgradePrompt(prompt);

  const system =
    'Tu es un expert en spécifications produit et en ingénierie de prompt. Réécris la demande de l’utilisateur en un cahier des charges clair, structuré et actionnable pour un agent de code. Garde la même langue. Sois concret (écrans, composants, données, interactions, style, accessibilité, fichiers attendus). Réponds uniquement avec le prompt final, sans préambule.';
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
    {}
  );
  return text.trim() || localUpgradePrompt(prompt);
}
