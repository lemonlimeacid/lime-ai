/* Supernova IA — espace de travail : aperçu live, fichiers, console, journal */

import { $, $$, h, api, state, bus, toast, providerLabel, formatBytes, icon, saveUiPreferences } from './core.js';

let previewFrame = null;
let previewUrl = null;
let previewEmpty = null;
let previewStage = null;
let previewView = null;
let previewLoader = null;
let previewLoaderEyebrow = null;
let previewLoaderTitle = null;
let previewLoaderDetail = null;
let previewLoadPending = false;
let previewLoadStartedAt = 0;
let previewLoaderTimer = null;
let fileTreeEl = null;
let editorEl = null;
let editorPathEl = null;
let editorDirtyEl = null;
let termBadge = null;
let consoleBadge = null;
let searchListEl = null;

const collapsed = new Set();
const journalEntries = [];
let consoleEntries = [];
let reloadTimer = null;
let hiddenViews = new Set();
let workCollapsed = false;

const VIEWS = ['live', 'code', 'search'];

const previewScrollbarCss = `
  html { scrollbar-width: none; -ms-overflow-style: none; }
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
`;

function stylePreviewScrollbars() {
  try {
    const doc = previewFrame.contentDocument;
    if (!doc || doc.getElementById('supernova-scrollbars')) return;
    const style = doc.createElement('style');
    style.id = 'supernova-scrollbars';
    style.textContent = previewScrollbarCss;
    (doc.head || doc.documentElement).append(style);
  } catch (error) {
    /* aperçu d'une autre origine : on ne peut pas styler ses barres */
  }
}

export function initWorkspace() {
  previewFrame = $('#previewFrame');
  previewUrl = $('#previewUrl');
  previewEmpty = $('#previewEmpty');
  previewStage = $('#previewStage');
  previewView = $('.browser-view');
  previewLoader = $('#previewLoader');
  previewLoaderEyebrow = $('#previewLoaderEyebrow');
  previewLoaderTitle = $('#previewLoaderTitle');
  previewLoaderDetail = $('#previewLoaderDetail');
  fileTreeEl = $('#fileTree');
  editorEl = $('#editor');
  editorPathEl = $('#editorPath');
  editorDirtyEl = $('#editorDirty');
  termBadge = $('#termBadge');
  consoleBadge = $('#consoleBadge');
  searchListEl = $('#searchList');

  // Vue globale : Aperçu live / Code / Recherches
  for (const button of $$('[data-view]')) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }

  // Onglets de la vue Code
  for (const button of $$('.tabs [data-tab]')) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  }

  // Rail de droite : affiche ou replie un panneau
  for (const button of $$('[data-panel-toggle]')) {
    button.addEventListener('click', () => togglePanel(button.dataset.panelToggle));
  }
  $('#hideWorkBtn')?.addEventListener('click', () => setWorkCollapsed(true));
  $('#toggleWorkBtn')?.addEventListener('click', () => setWorkCollapsed(!workCollapsed));
  $('#workspaceViewsBtn')?.addEventListener('click', () => {
    const menu = $('#workspaceMenu');
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    $('#workspaceViewsBtn').setAttribute('aria-expanded', String(open));
  });
  for (const input of $$('[data-view-toggle]')) {
    input.addEventListener('change', () => setViewVisibility(input.dataset.viewToggle, input.checked));
  }
  $('#clearSearchesBtn')?.addEventListener('click', () => {
    state.searches = [];
    renderSearches();
  });
  document.addEventListener('click', (event) => {
    const menu = $('#workspaceMenu');
    const trigger = $('#workspaceViewsBtn');
    if (!menu || menu.hidden) return;
    if (!menu.contains(event.target) && !trigger?.contains(event.target)) closeWorkspaceMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeWorkspaceMenu();
  });
  bus.on('ui:changed', (ui) => {
    if (!ui) return;
    if (Array.isArray(ui.hiddenViews)) hiddenViews = new Set(ui.hiddenViews.filter((view) => VIEWS.includes(view)));
    if (ui.workPanelHidden === '0' || ui.workPanelHidden === '1') workCollapsed = ui.workPanelHidden === '1';
    syncPanelRail();
  });
  bus.on('search:changed', renderSearches);
  loadUiPreferences();
  syncPanelRail();
  renderSearches();

  // Taille de l'aperçu
  for (const button of $$('[data-device]')) {
    button.addEventListener('click', () => {
      const mobile = button.dataset.device === 'mobile';
      previewStage.classList.toggle('mobile', mobile);
      for (const other of $$('[data-device]')) other.classList.toggle('active', other === button);
    });
  }

  $('#refreshBtn').addEventListener('click', () => reloadPreview());
  $('#openTabBtn').addEventListener('click', () => {
    const url = previewUrl.value.trim();
    if (url) window.open(url, '_blank', 'noopener');
  });

  previewFrame.addEventListener('load', () => {
    stylePreviewScrollbars();
    if (!previewLoadPending) return;
    previewLoadPending = false;
    if (!state.streaming) schedulePreviewLoaderHide(260);
  });

  previewUrl.addEventListener('change', () => reloadPreview());
  previewUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      reloadPreview();
    }
  });

  // Éditeur
  editorEl.addEventListener('input', () => {
    state.dirty = true;
    editorDirtyEl.classList.remove('hidden');
  });

  editorEl.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editorEl.selectionStart;
      const end = editorEl.selectionEnd;
      editorEl.value = `${editorEl.value.slice(0, start)}  ${editorEl.value.slice(end)}`;
      editorEl.selectionStart = editorEl.selectionEnd = start + 2;
      state.dirty = true;
      editorDirtyEl.classList.remove('hidden');
    }
    if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      saveFile();
    }
  });

  $('#saveFileBtn').addEventListener('click', saveFile);
  $('#newFileBtn').addEventListener('click', createFile);
  $('#deleteFileBtn').addEventListener('click', deleteFile);
  $('#clearConsoleBtn').addEventListener('click', () => {
    consoleEntries = [];
    renderConsole();
  });

  // Console de l'aperçu
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.__supernova) return;
    if (data.__supernova === 'console') {
      addConsole(data.payload.level || 'log', data.payload.text || '');
    } else if (data.__supernova === 'error') {
      addConsole('error', data.payload.text || 'Unknown error');
    } else if (data.__supernova === 'ready') {
      addConsole('info', `Preview loaded — ${data.payload.url}`);
    }
  });

  bus.on('files:changed', (payload) => {
    refreshFiles({ openNewest: false, focusPath: payload?.path }).then(() => reloadPreviewSoon());
  });
  bus.on('log', (entry) => logEntry(entry));
  bus.on('mcp:status', (servers) => {
    const total = servers.reduce((sum, server) => sum + (server.tools?.length || 0), 0);
    $('#statusMcp').textContent = `MCP: ${total} tool${total > 1 ? 's' : ''}`;
  });
  bus.on('preview:reload', () => reloadPreviewSoon());
  bus.on('streaming:changed', syncPreviewStreaming);

  renderJournal();
  renderConsole();
}

/* ── Chargement projet ──────────────────────────────────────────────────── */

export async function loadProject(id) {
  if (!id) return;
  try {
    const data = await api.project(id);
    state.project = data.project;
    state.files = data.files || [];
    state.tree = data.tree || [];
    state.openFile = null;
    state.dirty = false;

    editorEl.value = '';
    editorPathEl.textContent = 'No file open';
    editorDirtyEl.classList.add('hidden');

    logEntry({ type: 'info', text: `Project opened: <strong>${escapeText(data.project.name)}</strong> (${state.files.length} file(s))` });
    updateProjectChrome();
    renderTree();
    renderPreview();
    updateStatus();
    bus.emit('project:changed', data.project);

    const settingsPatch = { lastProjectId: id };
    bus.emit('settings:patch', settingsPatch);

    if (state.files.length) {
      const preferred =
        state.files.find((file) => /^index\.html?$/i.test(file.path)) ||
        state.files.find((file) => /\.html?$/i.test(file.path)) ||
        state.files[0];
      await openFile(preferred.path);
    }
  } catch (error) {
    toast(`Unable to load project: ${error.message}`, 'err');
  }
}

export async function refreshFiles({ openNewest = false, focusPath = '' } = {}) {
  if (!state.project) return;
  try {
    const data = await api.files(state.project.id);
    const previousCount = state.files.length;
    state.files = data.files || [];
    state.tree = data.tree || [];
    renderTree();
    updateStatus();

    if (openNewest && state.files.length !== previousCount) {
      const newest = [...state.files].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      if (newest && (!state.openFile || newest.path !== state.openFile)) {
        if (!state.dirty) await openFile(focusPath || newest.path, { silent: true });
      }
    } else if (focusPath && (!state.openFile || state.openFile === focusPath) && !state.dirty) {
      await openFile(focusPath, { silent: true });
    }
  } catch {
    /* silencieux : le projet a peut-être été supprimé */
  }
}

function updateProjectChrome() {
  const value = $('#projectSelectValue');
  if (value && state.project) {
    value.textContent = `${state.project.mode === 'cloud' ? 'Cloud' : 'PC'} · ${state.project.name}`;
  }
  const use = $('#projectSelectUse');
  if (use && state.project) use.setAttribute('href', state.project.mode === 'cloud' ? '#i-cloud' : '#i-folder');
  updateModeUI();
  const pill = $('#enginePill');
  if (pill) pill.textContent = providerLabel();
}

export function updateModeUI() {
  const mode = state.project?.mode || state.settings.mode;
  $('#modePcBtn').classList.toggle('active', mode === 'pc');
  $('#modeCloudBtn').classList.toggle('active', mode === 'cloud');
  $('#statusMode').textContent = mode === 'cloud' ? 'Cloud mode · internal storage + ZIP' : 'PC mode · local folder';

  const banner = $('#modeBanner');
  const wantsCloud = state.settings.mode === 'cloud';
  const mismatch = state.project && state.project.mode !== state.settings.mode;
  if (mismatch) {
    banner.classList.remove('hidden');
    banner.innerHTML = '';
    banner.append(
      h('span', { html: `This project is in <strong>${state.project.mode === 'cloud' ? 'Cloud' : 'PC'}</strong> mode, but the active mode is <strong>${wantsCloud ? 'Cloud' : 'PC'}</strong>.` }),
      h('button', {
        class: 'btn subtle small',
        type: 'button',
        onclick: () => bus.emit('project:new'),
      }, `Create a ${wantsCloud ? 'Cloud' : 'PC'} project`)
    );
  } else {
    banner.classList.add('hidden');
  }
}

function updateStatus() {
  $('#statusFiles').textContent = `${state.files.length} file${state.files.length > 1 ? 's' : ''}`;
  $('#statusProvider').textContent = providerLabel();
  const pathEl = $('#statusPath');
  if (state.project) {
    pathEl.textContent = state.project.mode === 'cloud' ? 'Supernova Cloud · internal storage + ZIP' : state.project.rootDir || '';
    pathEl.title = pathEl.textContent;
  } else {
    pathEl.textContent = '—';
  }
}

/* ── Panneaux ───────────────────────────────────────────────────────────── */

function loadUiPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem('supernova.hiddenViews') || '[]');
    hiddenViews = new Set(Array.isArray(stored) ? stored.filter((view) => VIEWS.includes(view)) : []);
  } catch {
    hiddenViews = new Set();
  }
  workCollapsed = localStorage.getItem('supernova.workPanelHidden') === '1';
}

function visibleViews() {
  return VIEWS.filter((view) => !hiddenViews.has(view));
}

function viewForPanel(panel) {
  if (panel === 'preview') return 'live';
  if (panel === 'search') return 'search';
  return 'code';
}

function currentPanel() {
  if (state.view === 'search') return 'search';
  if (state.view === 'code') return state.tab || 'files';
  return 'preview';
}

function closeWorkspaceMenu() {
  const menu = $('#workspaceMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('#workspaceViewsBtn')?.setAttribute('aria-expanded', 'false');
}

function syncViewControls() {
  for (const button of $$('[data-view]')) {
    const hidden = hiddenViews.has(button.dataset.view);
    button.classList.toggle('hidden', hidden);
    button.setAttribute('aria-hidden', String(hidden));
  }
  for (const input of $$('[data-view-toggle]')) {
    input.checked = !hiddenViews.has(input.dataset.viewToggle);
  }
  for (const button of $$('[data-panel-toggle]')) {
    const hidden = hiddenViews.has(viewForPanel(button.dataset.panelToggle));
    button.classList.toggle('hidden', hidden);
    button.setAttribute('aria-hidden', String(hidden));
  }
  const toggle = $('#toggleWorkBtn');
  if (toggle) {
    const label = workCollapsed ? 'Show right panel' : 'Hide right panel';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(!workCollapsed));
    toggle.classList.toggle('active', workCollapsed);
  }
}

function syncPanelRail() {
  if (!visibleViews().length) hiddenViews.delete('live');
  if (hiddenViews.has(state.view)) state.view = visibleViews()[0] || 'live';
  syncViewControls();

  const active = workCollapsed ? null : currentPanel();
  for (const button of $$('[data-panel-toggle]')) {
    const on = !workCollapsed && button.dataset.panelToggle === active;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  }

  $('#layout').classList.toggle('hide-work', workCollapsed);
  $('#liveView').classList.toggle('hidden', state.view !== 'live' || hiddenViews.has('live'));
  $('#codeView').classList.toggle('hidden', state.view !== 'code' || hiddenViews.has('code'));
  $('#searchView').classList.toggle('hidden', state.view !== 'search' || hiddenViews.has('search'));
  for (const button of $$('[data-view]')) button.classList.toggle('active', button.dataset.view === state.view);
}

function setWorkCollapsed(collapsed, { persist = true } = {}) {
  workCollapsed = collapsed;
  if (persist) saveUiPreferences({ workPanelHidden: collapsed ? '1' : '0' });
  syncPanelRail();
}

function persistHiddenViews() {
  saveUiPreferences({
    hiddenViews: [...hiddenViews],
    workPanelHidden: workCollapsed ? '1' : '0',
  });
}

function setViewVisibility(view, visible, { persist = true } = {}) {
  if (!VIEWS.includes(view)) return;
  if (!visible && visibleViews().length <= 1) {
    toast('Keep at least one view visible in the panel.', 'warn', 2600);
    syncViewControls();
    return;
  }
  if (visible) hiddenViews.delete(view);
  else hiddenViews.add(view);
  if (!visible && state.view === view) state.view = visibleViews()[0] || 'live';
  if (persist) persistHiddenViews();
  syncPanelRail();
}

export function togglePanel(panel) {
  const view = viewForPanel(panel);
  if (hiddenViews.has(view)) return;
  if (!workCollapsed && currentPanel() === panel) {
    setWorkCollapsed(true);
    return;
  }
  if (workCollapsed) setWorkCollapsed(false);
  if (view === 'live') setView('live');
  else if (view === 'search') setView('search');
  else {
    setView('code');
    setTab(panel);
  }
  syncPanelRail();
}

/* ── Vues et onglets ────────────────────────────────────────────────────── */

export function setView(view) {
  if (!VIEWS.includes(view) || hiddenViews.has(view)) return;
  if (workCollapsed) setWorkCollapsed(false);
  state.view = view;
  syncPanelRail();
  if (view === 'live') reloadPreview();
  if (view === 'search') renderSearches();
}

export function setTab(tab) {
  if (hiddenViews.has('code')) return;
  if (workCollapsed) setWorkCollapsed(false);
  state.tab = tab;
  for (const button of $$('.tabs [data-tab]')) button.classList.toggle('active', button.dataset.tab === tab);
  for (const panel of $$('.tab-panel')) panel.classList.toggle('active', panel.dataset.panel === tab);
  if (tab === 'terminal') termBadge?.classList.add('hidden');
  if (tab === 'console') consoleBadge?.classList.add('hidden');
  if (tab === 'journal') renderJournal();
  syncPanelRail();
}

/* ── Recherches web de l’agent ──────────────────────────────────────────── */

function renderSearches() {
  if (!searchListEl) return;
  searchListEl.innerHTML = '';
  if (!state.searches?.length) {
    const empty = h('div', { class: 'search-empty' });
    empty.innerHTML = `<svg class="i lg" aria-hidden="true"><use href="#i-search"></use></svg><strong>No searches yet</strong>Try “find the Open-Meteo API documentation”. Queries and their sources will appear here.`;
    searchListEl.append(empty);
    return;
  }

  for (const search of state.searches) {
    const entry = h('article', { class: 'search-entry' });
    const head = h('div', { class: 'search-entry-head' });
    const info = h('div', { class: 'search-query', text: search.query || 'Search' });
    const meta = h('div', { class: 'search-meta' });
    meta.append(
      h('span', { class: `search-status ${search.status || 'done'}` }),
      h('span', { text: search.status === 'running' ? 'running' : `${search.results?.length || 0} source(s)` })
    );
    head.append(info, meta);
    entry.append(head);

    const links = h('div', { class: 'search-links' });
    if (search.results?.length) {
      for (const result of search.results) {
        const title = String(result.title || result.url || 'Source');
        const url = String(result.url || '');
        const link = h(/^https?:\/\//i.test(url) ? 'a' : 'div', {
          class: 'search-link',
          href: /^https?:\/\//i.test(url) ? url : null,
          target: /^https?:\/\//i.test(url) ? '_blank' : null,
          rel: 'noopener noreferrer',
        });
        link.append(
          h('span', { class: 'search-link-title', text: title }),
          h('span', { class: 'search-link-url', text: url || result.source || '' }),
          h('span', { class: 'search-link-snippet', text: String(result.snippet || '').slice(0, 280) })
        );
        links.append(link);
      }
    } else {
      links.append(h('div', { class: 'search-no-results', text: search.note || 'No results for this search.' }));
    }
    entry.append(links);
    searchListEl.append(entry);
  }
}

/* ── Aperçu ─────────────────────────────────────────────────────────────── */

function previewHasHtml() {
  return (state.files || []).some((file) => /\.html?$/i.test(file.path));
}

function updatePreviewLoaderCopy(mode = 'reload') {
  const generating = mode === 'streaming' || state.streaming;
  if (previewLoaderEyebrow) {
    previewLoaderEyebrow.textContent = generating ? 'Generating' : 'Preview';
  }
  if (previewLoaderTitle) {
    previewLoaderTitle.textContent = generating ? 'The stars are aligning…' : 'Reloading preview';
  }
  if (previewLoaderDetail) {
    previewLoaderDetail.textContent = generating
      ? 'The preview updates after each file is written.'
      : 'The stars orbit while it loads.';
  }
}

function showPreviewLoader(mode = 'reload') {
  if (!previewLoader) return;
  clearTimeout(previewLoaderTimer);
  previewLoaderTimer = null;
  previewLoadStartedAt = Date.now();
  updatePreviewLoaderCopy(mode);
  previewLoader.hidden = false;
  previewView?.classList.add('is-preview-loading');
  previewStage?.setAttribute('aria-busy', 'true');
}

function hidePreviewLoader() {
  if (!previewLoader) return;
  clearTimeout(previewLoaderTimer);
  previewLoaderTimer = null;
  if (state.streaming || previewLoadPending) return;
  previewLoader.hidden = true;
  previewView?.classList.remove('is-preview-loading');
  previewStage?.setAttribute('aria-busy', 'false');
}

function schedulePreviewLoaderHide(delay = 0) {
  if (!previewLoader) return;
  clearTimeout(previewLoaderTimer);
  const elapsed = Date.now() - previewLoadStartedAt;
  const wait = Math.max(delay, 720 - elapsed);
  previewLoaderTimer = setTimeout(hidePreviewLoader, wait);
}

function beginPreviewLoad(mode = 'reload') {
  if (!previewLoader) return;
  if (!state.streaming && !previewHasHtml() && mode !== 'streaming') {
    hidePreviewLoader();
    return;
  }
  previewLoadPending = true;
  showPreviewLoader(mode);
}

function syncPreviewStreaming(on) {
  if (on) {
    showPreviewLoader('streaming');
  } else {
    schedulePreviewLoaderHide(900);
  }
}

function previewTarget() {
  if (!state.project) return '';
  return `${location.origin}/preview/${state.project.id}/`;
}

export function renderPreview() {
  if (!state.project) return;
  const base = previewTarget();
  previewUrl.value = base;
  const hasFiles = previewHasHtml();
  previewEmpty.classList.toggle('hidden', hasFiles);
  if (hasFiles) {
    previewFrame.src = `${base}?v=${Date.now()}`;
    beginPreviewLoad(state.streaming ? 'streaming' : 'reload');
  } else {
    previewFrame.removeAttribute('src');
    previewLoadPending = false;
    if (state.streaming) showPreviewLoader('streaming');
    else hidePreviewLoader();
  }
}

export function reloadPreview() {
  if (!state.project) return;
  const url = (previewUrl.value || '').trim();
  if (!url) return;
  const separator = url.includes('?') ? '&' : '?';
  const target = url.startsWith(`${location.origin}/preview/`) ? `${url}${separator}v=${Date.now()}` : url;
  previewFrame.src = target;
  const hasFiles = previewHasHtml();
  previewEmpty.classList.toggle('hidden', hasFiles);
  beginPreviewLoad(state.streaming ? 'streaming' : 'reload');
}

function reloadPreviewSoon() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (state.view === 'live') reloadPreview();
  }, 450);
}

/* ── Arborescence ───────────────────────────────────────────────────────── */

function fileIcon(name) {
  const lower = String(name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/.test(lower)) return 'image';
  if (/\.(json|jsonc|lock)$/.test(lower)) return 'braces';
  if (/\.(md|markdown|txt|log|csv)$/.test(lower)) return 'file-text';
  if (/\.(html?|css|scss|jsx?|tsx?|vue|svelte|py|rb|go|rs|php|sh|java|kt|cs|xml|yml|yaml)$/.test(lower)) return 'file-code';
  return 'file';
}

function renderTree() {
  fileTreeEl.innerHTML = '';
  if (!state.project || !state.files.length) {
    fileTreeEl.append(h('div', { class: 'tree-empty', text: 'Empty project — ask for an app in the chat.' }));
    return;
  }

  const walk = (nodes, container) => {
    for (const node of nodes) {
      if (node.type === 'dir') {
        const isCollapsed = collapsed.has(node.path);
        const row = h('button', { class: 'tree-row dir', type: 'button', title: node.path }, [
          h('span', { class: 'caret', html: icon(isCollapsed ? 'chevron-right' : 'chevron-down', 'xs') }),
          h('span', { class: 'ficon', html: icon('folder', 'sm') }),
          h('span', { class: 'fname', text: node.name }),
        ]);
        row.addEventListener('click', () => {
          if (collapsed.has(node.path)) collapsed.delete(node.path);
          else collapsed.add(node.path);
          renderTree();
        });
        container.append(row);
        if (!isCollapsed) {
          const children = h('div', { class: 'tree-children' });
          container.append(children);
          walk(node.children || [], children);
        }
      } else {
        const row = h('button', {
          class: `tree-row${state.openFile === node.path ? ' active' : ''}`,
          type: 'button',
          title: `${node.path} · ${formatBytes(node.size)}`,
        }, [
          h('span', { class: 'ficon', html: icon(fileIcon(node.name), 'sm') }),
          h('span', { class: 'fname', text: node.name }),
        ]);
        row.addEventListener('click', () => openFile(node.path));
        container.append(row);
      }
    }
  };

  const root = h('div');
  walk(state.tree, root);
  fileTreeEl.append(root);
}

export async function openFile(path, { silent = false } = {}) {
  if (!state.project || !path) return;
  if (state.dirty && !silent) {
    if (!confirm('Unsaved changes will be lost. Continue?')) return;
  }
  try {
    const data = await api.readFile(state.project.id, path);
    editorEl.value = data.content;
    editorPathEl.textContent = path;
    editorPathEl.title = path;
    state.openFile = path;
    state.dirty = false;
    editorDirtyEl.classList.add('hidden');
    renderTree();
  } catch (error) {
    if (!silent) toast(`Unable to open: ${error.message}`, 'err');
  }
}

async function saveFile() {
  if (!state.project || !state.openFile) return toast('No file open.', 'warn', 2200);
  try {
    await api.writeFile(state.project.id, state.openFile, editorEl.value);
    state.dirty = false;
    editorDirtyEl.classList.add('hidden');
    toast(`Saved: ${state.openFile}`, 'ok', 2000);
    logEntry({ type: 'file', text: `File edited manually: <code>${escapeText(state.openFile)}</code>` });
    await refreshFiles();
    reloadPreviewSoon();
  } catch (error) {
    toast(`Unable to save: ${error.message}`, 'err');
  }
}

async function createFile() {
  if (!state.project) return;
  const path = window.prompt('New file path (e.g. src/app.js)');
  if (!path) return;
  try {
    await api.writeFile(state.project.id, path, '');
    await refreshFiles();
    await openFile(path);
    toast(`File created: ${path}`, 'ok', 2200);
  } catch (error) {
    toast(`Unable to create: ${error.message}`, 'err');
  }
}

async function deleteFile() {
  if (!state.project || !state.openFile) return toast('No file open.', 'warn', 2200);
  if (!confirm(`Delete ${state.openFile}?`)) return;
  try {
    await api.removeFile(state.project.id, state.openFile);
    logEntry({ type: 'file', text: `File deleted: <code>${escapeText(state.openFile)}</code>` });
    state.openFile = null;
    editorEl.value = '';
    editorPathEl.textContent = 'No file open';
    await refreshFiles();
    reloadPreviewSoon();
  } catch (error) {
    toast(`Unable to delete: ${error.message}`, 'err');
  }
}

/* ── Journal ────────────────────────────────────────────────────────────── */

export function logEntry(entry) {
  if (!entry) return;
  journalEntries.unshift({
    time: new Date().toLocaleTimeString('en-US'),
    type: entry.type || 'info',
    text: entry.text || '',
  });
  if (journalEntries.length > 200) journalEntries.length = 200;
  if (state.tab === 'journal' && state.view === 'code') renderJournal();
}

function renderJournal() {
  const container = $('#journal');
  if (!container) return;
  container.innerHTML = '';
  if (!journalEntries.length) {
    container.append(h('p', { class: 'empty-journal', text: 'The agent activity log will appear here.' }));
    return;
  }
  for (const entry of journalEntries) {
    container.append(
      h('div', { class: 'entry' }, [
        h('span', { class: 'time', text: entry.time }),
        h('span', { class: 'what', html: entry.text }),
      ])
    );
  }
}

/* ── Console ────────────────────────────────────────────────────────────── */

function addConsole(level, text) {
  consoleEntries.push({ level, text: String(text).slice(0, 4000), time: new Date().toLocaleTimeString('en-US') });
  if (consoleEntries.length > 300) consoleEntries.shift();
  if (state.tab === 'console' && state.view === 'code') renderConsole();
  consoleBadge?.classList.remove('hidden');
}

function renderConsole() {
  const container = $('#consoleOutput');
  if (!container) return;
  container.innerHTML = '';
  if (!consoleEntries.length) {
    container.append(h('div', { class: 'empty-console', text: 'No logs yet. Open the live preview to see the app console.' }));
    return;
  }
  for (const entry of consoleEntries.slice().reverse()) {
    container.append(
      h('div', { class: `row ${entry.level}` }, [
        h('span', { class: 'lvl', text: entry.level }),
        h('span', { class: 'txt', text: entry.text }),
      ])
    );
  }
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function notifyTerminalTab() {
  if (state.tab !== 'terminal' || state.view !== 'code') termBadge?.classList.remove('hidden');
}
