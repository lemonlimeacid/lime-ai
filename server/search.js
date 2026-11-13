/**
 * Recherche web sans clé d'API : DuckDuckGo Instant Answer + Wikipédia.
 * Utilisé par le moteur local (et exposé via /api/search).
 */

const UA = 'LimeIA/1.0 (+local dev agent; contact: local)';

async function fetchJson(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function strip(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function duckduckgo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&kl=us-en`;
  const data = await fetchJson(url);
  const results = [];
  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || '',
      snippet: strip(data.AbstractText),
      source: 'DuckDuckGo',
    });
  }
  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  const flatten = [];
  for (const topic of topics) {
    if (topic.Topics) flatten.push(...topic.Topics);
    else flatten.push(topic);
  }
  for (const topic of flatten.slice(0, 6)) {
    if (!topic.Text) continue;
    results.push({
      title: strip(topic.Text).slice(0, 90),
      url: topic.FirstURL || '',
      snippet: strip(topic.Text),
      source: 'DuckDuckGo',
    });
  }
  return results;
}

async function wikipedia(query, lang = 'en') {
  const search = await fetchJson(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`
  ).catch(() => null);
  const hits = search?.query?.search || [];
  const results = [];
  for (const hit of hits.slice(0, 2)) {
    try {
      const summary = await fetchJson(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`
      );
      if (summary?.extract) {
        results.push({
          title: summary.title,
          url: summary.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
          snippet: summary.extract,
          source: 'Wikipedia',
        });
      }
    } catch {
      /* ignore */
    }
  }
  return results;
}

export async function searchWeb(query, { limit = 5 } = {}) {
  const clean = String(query || '').trim();
  if (!clean) return { query: clean, results: [], note: 'Empty query' };

  const settled = await Promise.allSettled([duckduckgo(clean), wikipedia(clean)]);
  const results = [];
  const seen = new Set();
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    for (const result of outcome.value) {
      const key = (result.url || result.title).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(result);
    }
  }

  return {
    query: clean,
    results: results.slice(0, limit),
    note: results.length ? '' : "No results found (check your network connection or rephrase the question).",
  };
}
