/* Lime AI — approximate model prices, Free/Paid badges and spend tracking. */
import { $, bus } from './core.js';

const USAGE_KEY = 'lime.usage.v1';
const FREE_PROVIDERS = new Set(['local', 'ollama', 'lmstudio', 'vllm']);

// USD per 1M tokens: [input, output]. These are approximate public list prices.
const MODEL_RATES = {
  'gpt-4-1-mini': [0.4, 1.6],
  'gpt-4-1': [2, 8],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'o4-mini': [1.1, 4.4],
  'claude-sonnet-4-5': [3, 15],
  'claude-opus-4-1': [15, 75],
  'claude-haiku-4-5': [1, 5],
  'gemini-2-5-flash': [0.3, 2.5],
  'gemini-2-5-pro': [1.25, 10],
  'gemini-2-0-flash': [0.1, 0.4],
  'mistral-large-latest': [2, 6],
  'mistral-small-latest': [0.1, 0.3],
  'codestral-latest': [0.3, 0.9],
  'deepseek-chat': [0.27, 1.1],
  'deepseek-reasoner': [0.55, 2.19],
  'grok-4': [3, 15],
  'grok-3-mini': [0.3, 0.5],
  'llama-3-3-70b-versatile': [0.59, 0.79],
  'llama-3-1-8b-instant': [0.05, 0.08],
  'qwen3-32b': [0.29, 0.59],
  'llama-3-3-70b-instruct-turbo': [0.88, 0.88],
  'qwen2-5-coder-32b-instruct': [0.8, 0.8],
};

const PROVIDER_FALLBACK = {
  openai: [1, 3],
  anthropic: [3, 15],
  google: [0.3, 2.5],
  openrouter: [1, 3],
  groq: [0, 0],
  mistral: [0.4, 1.2],
  deepseek: [0.3, 1.2],
  xai: [1, 3],
  together: [0.8, 0.8],
};

function normalizeModel(model) {
  return String(model || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^[^/]+\//, '')
    .replace(/\./g, '-')
    .replace(/:free$/, '')
    .replace(/\s+/g, '');
}

export function getModelPrice(providerId, model) {
  const provider = String(providerId || '');
  const raw = String(model || '').trim();
  if (!raw) return { free: true, input: 0, output: 0, label: '', title: 'No model selected.' };

  if (FREE_PROVIDERS.has(provider) || provider === 'groq' || /:free$/i.test(raw)) {
    const title = provider === 'groq'
      ? 'Free tier — provider rate limits apply.'
      : provider === 'openrouter'
        ? 'Free model on OpenRouter.'
        : 'Runs locally — no API charge.';
    return { free: true, input: 0, output: 0, label: 'Free', title };
  }

  const rates = MODEL_RATES[normalizeModel(raw)];
  const fallback = PROVIDER_FALLBACK[provider] || [1, 3];
  const [input, output] = rates || fallback;
  return {
    free: false,
    input,
    output,
    label: 'Paid',
    title: `Approx. $${input.toFixed(2)} input / $${output.toFixed(2)} output per 1M tokens. Not an invoice.`,
  };
}

export function applyPriceBadge(element, providerId, model) {
  if (!element) return;
  if (!model) {
    element.hidden = true;
    return;
  }
  const price = getModelPrice(providerId, model);
  element.hidden = false;
  element.textContent = price.label;
  element.className = `model-price-badge ${price.free ? 'free' : 'paid'}`;
  element.title = price.title;
}

function emptyUsage() {
  return {
    totalUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    calls: 0,
    byModel: {},
    updatedAt: null,
  };
}

function loadUsage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return emptyUsage();
    return {
      ...emptyUsage(),
      ...parsed,
      byModel: parsed.byModel && typeof parsed.byModel === 'object' ? parsed.byModel : {},
    };
  } catch {
    return emptyUsage();
  }
}

let usage = loadUsage();
let usageUiReady = false;

function persistUsage() {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* Storage may be unavailable: keep the in-memory estimate. */
  }
}

export function recordUsage(event) {
  if (!event || typeof event !== 'object') return 0;
  const promptTokens = Math.max(0, Math.round(Number(event.promptTokens) || 0));
  const completionTokens = Math.max(0, Math.round(Number(event.completionTokens) || 0));
  if (!promptTokens && !completionTokens) return 0;

  const provider = String(event.provider || 'unknown');
  const model = String(event.model || 'model');
  const price = getModelPrice(provider, model);
  const cost = (promptTokens / 1e6) * price.input + (completionTokens / 1e6) * price.output;
  const key = `${provider}/${model}`;

  usage.totalUsd = (Number(usage.totalUsd) || 0) + cost;
  usage.promptTokens = (Number(usage.promptTokens) || 0) + promptTokens;
  usage.completionTokens = (Number(usage.completionTokens) || 0) + completionTokens;
  usage.calls = (Number(usage.calls) || 0) + 1;
  const row = usage.byModel[key] || { provider, model, usd: 0, tokens: 0, calls: 0 };
  row.usd += cost;
  row.tokens += promptTokens + completionTokens;
  row.calls += 1;
  usage.byModel[key] = row;
  usage.updatedAt = new Date().toISOString();
  persistUsage();
  bus.emit('usage:changed', usage);
  return cost;
}

export function formatSpend(value) {
  const amount = Number(value) || 0;
  if (amount <= 0) return '$0.00';
  if (amount < 0.0001) return '<$0.0001';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  if (amount >= 1000) {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatTokens(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('en-US');
}

export function initUsageTracking() {
  const render = () => {
    const total = formatSpend(usage.totalUsd);
    const tokens = formatTokens((Number(usage.promptTokens) || 0) + (Number(usage.completionTokens) || 0));
    const calls = Number(usage.calls) || 0;
    const status = $('#statusSpend');
    if (status) {
      status.textContent = `Est. spend: ${total}`;
      status.title = `Estimated API spend across ${calls} model call(s) and ${tokens} estimated tokens. Not an invoice.`;
    }
    const menu = $('#modelMenuSpend');
    if (menu) menu.textContent = total;
    const detail = $('#modelMenuSpendDetail');
    if (detail) {
      detail.textContent = calls
        ? `${calls} call(s) · ${tokens} estimated tokens`
        : 'No calls recorded yet.';
    }
  };

  if (!usageUiReady) {
    usageUiReady = true;
    bus.on('usage:changed', render);
  }
  render();
}
