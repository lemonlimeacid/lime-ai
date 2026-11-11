/* Supernova IA — noyau partagé : DOM, réglages, état, API, markdown, bus */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function debounce(fn, ms = 200) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/* ── Icônes SVG (sprite inline défini dans index.html) ───────────────────── */

export function icon(name, className = '') {
  const cls = className ? `i ${className}` : 'i';
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/* ── Réglages ────────────────────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  provider: 'local',
  model: 'supernova-mini',
  apiKey: '',
  baseUrl: '',
  temperature: 0.7,
  reasoningEffort: 'medium',
  autoApply: true,
  autoContinue: true,
  shellPolicy: 'ask',
  language: 'français',
  systemPrompt: '',
  voiceLang: 'fr-FR',
  autoSpeak: false,
  themeStyle: 'default',
  mode: 'pc',
  lastProjectId: null,
};

const SETTINGS_KEY = 'supernova.settings';
const CHATS_KEY = 'supernova.chats';

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    toast('Stockage local saturé : les réglages ne sont pas sauvegardés.', 'warn');
    return false;
  }
}

/* ── Sauvegarde partagée serveur ─────────────────────────────────────────── */

const STATE_ENDPOINT = '/api/state';
let stateHydrated = false;
let stateRevision = 0;
let stateSaveTimer = null;
let statePollTimer = null;
const pendingStatePatch = {};

function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  // Compatibilité avec l'ancien mode « web », désormais stocké en Cloud interne.
  if (settings.mode === 'web') settings.mode = 'cloud';
  return settings;
}

function readUiPreferences() {
  try {
    return {
      theme: localStorage.getItem('supernova.theme') || null,
      chatWidth: localStorage.getItem('supernova.chatWidth') || null,
      threadsCollapsed: localStorage.getItem('supernova.threadsCollapsed') || null,
      hiddenViews: readLocal('supernova.hiddenViews', null),
      workPanelHidden: localStorage.getItem('supernova.workPanelHidden') || null,
    };
  } catch {
    return {};
  }
}

function applyUiPreferences(ui = {}) {
  if (ui.theme === 'light' || ui.theme === 'dark') {
    if (ui.theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('supernova.theme', ui.theme);
    } catch {
      /* stockage local indisponible */
    }
  }
  if (typeof ui.chatWidth === 'string' && /^\d+(?:\.\d+)?px$/.test(ui.chatWidth)) {
    document.documentElement.style.setProperty('--chat-width', ui.chatWidth);
    try {
      localStorage.setItem('supernova.chatWidth', ui.chatWidth);
    } catch {
      /* stockage local indisponible */
    }
  }
  if (ui.threadsCollapsed === '0' || ui.threadsCollapsed === '1') {
    try {
      localStorage.setItem('supernova.threadsCollapsed', ui.threadsCollapsed);
    } catch {
      /* stockage local indisponible */
    }
  }
  if (Array.isArray(ui.hiddenViews)) {
    try {
      localStorage.setItem('supernova.hiddenViews', JSON.stringify(ui.hiddenViews));
    } catch {
      /* stockage local indisponible */
    }
  }
  if (ui.workPanelHidden === '0' || ui.workPanelHidden === '1') {
    try {
      localStorage.setItem('supernova.workPanelHidden', ui.workPanelHidden);
    } catch {
      /* stockage local indisponible */
    }
  }
}

export function saveUiPreferences(patch = {}) {
  applyUiPreferences(patch);
  queueStateSave({ ui: patch });
}

function queueStateSave(patch) {
  if (!stateHydrated) return;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'ui') pendingStatePatch.ui = { ...(pendingStatePatch.ui || {}), ...value };
    else pendingStatePatch[key] = value;
  }
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => flushState(), 220);
}

async function flushState({ keepalive = false } = {}) {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = null;
  if (!Object.keys(pendingStatePatch).length) return;
  const patch = { ...pendingStatePatch };
  for (const key of Object.keys(pendingStatePatch)) delete pendingStatePatch[key];
  try {
    const response = await fetch(STATE_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      keepalive,
    });
    if (response.ok) {
      const data = await response.json();
      if (data && Number(data.revision)) stateRevision = Number(data.revision);
      return;
    }
    if (response.status === 413) {
      toast('Sauvegarde trop volumineuse (max 12 Mo) : seules les données locales sont conservées.', 'warn', 7000);
      return;
    }
    retryStateSave(patch);
  } catch {
    // Le serveur local est momentanément indisponible : on réessaie, le localStorage reste la copie de secours.
    retryStateSave(patch);
  }
}

function retryStateSave(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'ui') pendingStatePatch.ui = { ...(pendingStatePatch.ui || {}), ...value };
    else if (!(key in pendingStatePatch)) pendingStatePatch[key] = value;
  }
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => flushState(), 2500);
}

export function loadSettings() {
  return normalizeSettings(readLocal(SETTINGS_KEY, {}));
}

export function saveSettings(patch = {}) {
  Object.assign(state.settings, patch);
  writeLocal(SETTINGS_KEY, state.settings);
  queueStateSave({ settings: state.settings });
  bus.emit('settings:changed', state.settings);
  return state.settings;
}

/* ── État global ─────────────────────────────────────────────────────────── */

export const state = {
  settings: loadSettings(),
  config: { providers: [], shellEnabled: true, workspacesDir: '', dataDir: '' },
  projects: [],
  project: null,
  files: [],
  tree: [],
  chat: [],
  searches: [],
  thread: null,
  threadId: null,
  openFile: null,
  dirty: false,
  streaming: false,
  runId: null,
  view: 'live',
  tab: 'files',
  mcpTools: [],
  widget: null,
};

/* ── Bus d'événements ────────────────────────────────────────────────────── */

class Bus {
  constructor() { this.listeners = new Map(); }
  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }
  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) {
      try {
        handler(payload);
      } catch (error) {
        console.error('[supernova]', event, error);
      }
    }
  }
}
export const bus = new Bus();

/* ── API HTTP ────────────────────────────────────────────────────────────── */

async function request(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && data.error) || (typeof data === 'string' ? data : `Erreur ${res.status}`);
    throw new Error(message);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  async config() { return request('GET', '/api/config'); },
  async projects() { return request('GET', '/api/projects'); },
  async project(id) { return request('GET', `/api/projects/${id}`); },
  async createProject(payload) { return request('POST', '/api/projects', payload); },
  async deleteProject(id) { return request('DELETE', `/api/projects/${id}`); },
  async files(id) { return request('GET', `/api/projects/${id}/files`); },
  async readFile(id, path) { return request('GET', `/api/projects/${id}/file?path=${encodeURIComponent(path)}`); },
  async writeFile(id, path, content) { return request('PUT', `/api/projects/${id}/file`, { path, content }); },
  async removeFile(id, path) { return request('DELETE', `/api/projects/${id}/file?path=${encodeURIComponent(path)}`); },
  async mcpServers() { return request('GET', '/api/mcp/servers'); },
  async saveMcpServers(servers) { return request('PUT', '/api/mcp/servers', { servers }); },
  async search(query) { return request('POST', '/api/search', { query }); },
  async enhance(prompt) { return request('POST', '/api/enhance', { prompt, settings: state.settings }); },
  async models(overrides = {}) {
    return request('POST', '/api/models', {
      provider: state.settings.provider,
      baseUrl: state.settings.baseUrl,
      apiKey: state.settings.apiKey,
      ...overrides,
    });
  },
};

/* ── Conversations persistées ────────────────────────────────────────────── */

const THREADS_KEY = 'supernova.threads';

function newThreadId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* pas de crypto disponible */
  }
  return `th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-80).map((message) => ({
    id: message.id,
    role: message.role,
    content: String(message.content || '').slice(0, 60000),
    attachments: (Array.isArray(message.attachments) ? message.attachments : []).slice(0, 6).map((file) => ({
      name: String(file.name || 'fichier').slice(0, 160),
      size: Number(file.size) || 0,
      language: String(file.language || '').slice(0, 24),
      content: String(file.content || '').slice(0, 24000),
    })),
    activity: (message.activity || [])
      .filter((act) => act.kind !== 'proposal' && act.kind !== 'approval')
      .slice(-30)
      .map((act) => ({
        kind: act.kind,
        title: act.title,
        detail: String(act.detail || '').slice(0, 600),
        status: act.status,
        icon: act.icon,
      })),
    createdAt: message.createdAt,
    error: Boolean(message.error),
  }));
}

function titleFor(messages, kind = 'agent') {
  const first = (Array.isArray(messages) ? messages : []).find(
    (message) => message.role === 'user'
      && (String(message.content || '').trim() || message.attachments?.length)
  );
  if (!first) return kind === 'chat' ? 'Nouvelle conversation' : 'Nouvelle tâche';
  const clean = String(first.content || '').replace(/\s+/g, ' ').trim()
    || `Fichier joint : ${first.attachments?.[0]?.name || 'fichier'}`;
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

let threadStoreCache = null;

function normalizeThreadStore(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const threads = Array.isArray(source.threads)
    ? source.threads.slice(-500).map((thread) => ({
        ...thread,
        messages: sanitizeMessages(thread.messages),
      }))
    : [];
  const activeByProject = source.activeByProject && typeof source.activeByProject === 'object'
    ? source.activeByProject
    : {};
  return { v: 1, threads, activeByProject };
}

function readThreadStore() {
  if (threadStoreCache) return threadStoreCache;
  const saved = readLocal(THREADS_KEY, null);
  if (saved && Array.isArray(saved.threads)) {
    threadStoreCache = normalizeThreadStore(saved);
    writeLocal(THREADS_KEY, threadStoreCache);
    return threadStoreCache;
  }

  // Migration : l'ancien historique était un tableau de messages par projet.
  const legacy = readLocal(CHATS_KEY, {});
  const now = new Date().toISOString();
  const threads = [];
  const activeByProject = {};
  for (const [projectId, messages] of Object.entries(legacy || {})) {
    if (!Array.isArray(messages) || !messages.length) continue;
    const clean = sanitizeMessages(messages);
    if (!clean.length) continue;
    const thread = {
      id: newThreadId(),
      projectId,
      title: titleFor(clean, 'agent'),
      kind: 'agent',
      createdAt: clean[0]?.createdAt || now,
      updatedAt: clean[clean.length - 1]?.createdAt || now,
      messages: clean,
    };
    threads.push(thread);
    activeByProject[projectId] = thread.id;
  }
  threadStoreCache = { v: 1, threads, activeByProject };
  writeLocal(THREADS_KEY, threadStoreCache);
  return threadStoreCache;
}

function writeThreadStore(store) {
  threadStoreCache = store;
  writeLocal(THREADS_KEY, store);
  queueStateSave({ threads: store });
}

export function listThreads(projectId) {
  return readThreadStore()
    .threads.filter((thread) => !projectId || thread.projectId === projectId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getThread(id) {
  if (!id) return null;
  return readThreadStore().threads.find((thread) => thread.id === id) || null;
}

export function getActiveThread(projectId) {
  if (!projectId) return null;
  const store = readThreadStore();
  const thread = store.threads.find((item) => item.id === store.activeByProject[projectId]);
  return thread && thread.projectId === projectId ? thread : null;
}

export function ensureThread(projectId, kind = 'agent') {
  if (!projectId) return null;
  const store = readThreadStore();
  let thread = store.threads.find(
    (item) => item.id === store.activeByProject[projectId] && item.projectId === projectId
  );
  if (!thread) {
    thread = store.threads
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  }
  if (!thread) {
    thread = {
      id: newThreadId(),
      projectId,
      title: kind === 'chat' ? 'Nouvelle conversation' : 'Nouvelle tâche',
      kind: kind === 'chat' ? 'chat' : 'agent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    store.threads.push(thread);
  }
  store.activeByProject[projectId] = thread.id;
  writeThreadStore(store);
  return thread;
}

export function createThread(projectId, { kind = 'chat', title } = {}) {
  if (!projectId) return null;
  const store = readThreadStore();
  const normalizedKind = kind === 'chat' ? 'chat' : 'agent';
  const thread = {
    id: newThreadId(),
    projectId,
    title: title || (normalizedKind === 'chat' ? 'Nouvelle conversation' : 'Nouvelle tâche'),
    kind: normalizedKind,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  store.threads.push(thread);
  store.activeByProject[projectId] = thread.id;
  writeThreadStore(store);
  return thread;
}

export function setActiveThread(projectId, threadId) {
  if (!projectId || !threadId) return null;
  const store = readThreadStore();
  const thread = store.threads.find((item) => item.id === threadId && item.projectId === projectId);
  if (!thread) return null;
  store.activeByProject[projectId] = threadId;
  writeThreadStore(store);
  return thread;
}

export function deleteThread(threadId) {
  const store = readThreadStore();
  const thread = store.threads.find((item) => item.id === threadId);
  if (!thread) return null;
  store.threads = store.threads.filter((item) => item.id !== threadId);
  if (store.activeByProject[thread.projectId] === threadId) delete store.activeByProject[thread.projectId];
  writeThreadStore(store);
  return thread;
}

export function loadChat(projectId) {
  return ensureThread(projectId)?.messages || [];
}

export function saveChat(projectId, messages) {
  if (!projectId) return null;
  const ensured = ensureThread(projectId);
  if (!ensured) return null;
  const store = readThreadStore();
  const thread = store.threads.find((item) => item.id === ensured.id);
  if (!thread) return null;
  const clean = sanitizeMessages(messages);
  thread.messages = clean;
  thread.updatedAt = new Date().toISOString();
  const fallback = thread.kind === 'chat' ? 'Nouvelle conversation' : 'Nouvelle tâche';
  if (!thread.title || thread.title === fallback) {
    const title = titleFor(clean, thread.kind);
    if (title && title !== fallback) thread.title = title;
  }
  store.activeByProject[projectId] = thread.id;
  writeThreadStore(store);
  return thread;
}

export function clearChat(projectId) {
  const ensured = ensureThread(projectId);
  if (!ensured) return null;
  const store = readThreadStore();
  const thread = store.threads.find((item) => item.id === ensured.id);
  if (!thread) return null;
  thread.messages = [];
  thread.title = thread.kind === 'chat' ? 'Nouvelle conversation' : 'Nouvelle tâche';
  thread.updatedAt = new Date().toISOString();
  writeThreadStore(store);
  return thread;
}

/* ── Hydratation et synchronisation avec la sauvegarde serveur ──────────── */

export async function hydrateServerState() {
  try {
    const response = await fetch(STATE_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Sauvegarde HTTP ${response.status}`);
    const remote = await response.json();

    if (remote && typeof remote === 'object') {
      if (remote.settings && Object.keys(remote.settings).length) {
        state.settings = normalizeSettings(remote.settings);
        writeLocal(SETTINGS_KEY, state.settings);
      }
      if (remote.threads && Array.isArray(remote.threads.threads)) {
        threadStoreCache = normalizeThreadStore(remote.threads);
        writeLocal(THREADS_KEY, threadStoreCache);
      }
      if (remote.ui) applyUiPreferences(remote.ui);
      stateRevision = Number(remote.revision) || 0;

      if (!remote.updatedAt) {
        // Premier lancement : on envoie la sauvegarde locale existante au serveur.
        stateHydrated = true;
        queueStateSave({
          settings: state.settings,
          threads: readThreadStore(),
          ui: readUiPreferences(),
        });
        await flushState();
      }
    }

    stateHydrated = true;
    bus.emit('settings:changed', state.settings);
    bus.emit('threads:changed');
    return true;
  } catch {
    // Le serveur local est momentanément indisponible : localStorage prend le relais.
    stateHydrated = true;
    return false;
  }
}

function applyRemoteState(remote) {
  if (!remote || typeof remote !== 'object') return;

  if (remote.settings && Object.keys(remote.settings).length) {
    const settings = normalizeSettings(remote.settings);
    if (JSON.stringify(settings) !== JSON.stringify(state.settings)) {
      state.settings = settings;
      writeLocal(SETTINGS_KEY, state.settings);
      bus.emit('settings:changed', state.settings);
    }
  }

  if (remote.threads && Array.isArray(remote.threads.threads)) {
    const next = normalizeThreadStore(remote.threads);
    if (JSON.stringify(next) !== JSON.stringify(threadStoreCache)) {
      threadStoreCache = next;
      writeLocal(THREADS_KEY, next);
      bus.emit('threads:changed');
      if (state.project && !state.streaming) {
        const active = getThread(state.threadId);
        if (active) {
          state.thread = active;
          state.chat = active.messages || [];
          bus.emit('thread:changed', active);
        }
      }
    }
  }

  if (remote.ui) {
    applyUiPreferences(remote.ui);
    bus.emit('ui:changed', remote.ui);
  }
}

export function startStatePolling() {
  if (statePollTimer) return;
  statePollTimer = setInterval(async () => {
    if (!stateHydrated || document.hidden || state.streaming || stateSaveTimer) return;
    if (Object.keys(pendingStatePatch).length) return;
    try {
      const response = await fetch(STATE_ENDPOINT, { cache: 'no-store' });
      if (!response.ok) return;
      const remote = await response.json();
      const revision = Number(remote.revision) || 0;
      if (revision <= stateRevision) return;
      stateRevision = revision;
      applyRemoteState(remote);
    } catch {
      /* réessai au prochain tick */
    }
  }, 4000);
}

export async function clearSettingsPersistence() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = null;
  delete pendingStatePatch.settings;
  try {
    await fetch(STATE_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: {} }),
    });
  } catch {
    /* le rechargement garde les réglages par défaut locaux */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (stateSaveTimer || Object.keys(pendingStatePatch).length) flushState({ keepalive: true });
  });
}

/* ── Markdown minimaliste et sûr ─────────────────────────────────────────── */

export function renderMarkdown(source) {
  const text = String(source ?? '');
  const parts = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = fence.exec(text))) {
    parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    parts.push({ type: 'code', lang: match[1] || '', value: match[2] });
    lastIndex = fence.lastIndex;
  }
  parts.push({ type: 'text', value: text.slice(lastIndex) });

  let html = '';
  for (const part of parts) {
    if (part.type === 'code') {
      html += `<pre><code data-lang="${escapeHtml(part.lang)}">${escapeHtml(part.value.replace(/\n$/, ''))}</code></pre>`;
      continue;
    }
    html += renderTextBlock(part.value);
  }
  return html;
}

function inlineFormat(value) {
  let out = escapeHtml(value);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return out;
}

function renderTextBlock(value) {
  const lines = value.split('\n');
  let html = '';
  let listType = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${paragraph.map(inlineFormat).join('<br>')}</p>`;
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(4, heading[1].length);
      html += `<h${level}>${inlineFormat(heading[2])}</h${level}>`;
      continue;
    }
    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html += '<hr>';
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html += `<blockquote>${inlineFormat(quote[1])}</blockquote>`;
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html += '<ul>';
        listType = 'ul';
      }
      html += `<li>${inlineFormat(bullet[1])}</li>`;
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html += '<ol>';
        listType = 'ol';
      }
      html += `<li>${inlineFormat(ordered[1])}</li>`;
      continue;
    }
    flushParagraph();
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return html;
}

/* ── Toasts ──────────────────────────────────────────────────────────────── */

let toastContainer = null;
const TOAST_ICONS = { ok: 'check', err: 'alert', warn: 'alert', info: 'info' };
export function toast(message, kind = 'info', duration = 4200) {
  if (!toastContainer) toastContainer = $('#toasts');
  if (!toastContainer) return;
  const node = h('div', { class: `toast ${kind}`, role: 'status' });
  node.innerHTML = `${icon(TOAST_ICONS[kind] || 'info', 'sm')}<span class="toast-text">${String(message)}</span>`;
  toastContainer.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease, transform .25s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 260);
  }, duration);
}

/* ── Divers ──────────────────────────────────────────────────────────────── */

export function projectId() {
  return state.project?.id || '';
}

export function providerLabel() {
  const preset = state.config.providers?.find((p) => p.id === state.settings.provider);
  if (!preset) return 'Supernova Engine';
  if (preset.id === 'local') return 'Supernova Engine (local)';
  return `${preset.label.split(' (')[0]} · ${state.settings.model || preset.models[0]}`;
}

export function stripProtocol(text) {
  return String(text || '')
    .replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, '')
    .replace(/<(delete|shell|mcp)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}
