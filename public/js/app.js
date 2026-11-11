/* Supernova IA — amorçage, projets, mode PC/Cloud, raccourcis */

import { $, $$, h, api, state, bus, toast, saveSettings, ensureThread, setActiveThread, icon, hydrateServerState, startStatePolling, saveUiPreferences } from './core.js';
import { initChat, sendMessage } from './chat.js';
import { initWorkspace, loadProject, updateModeUI, setView } from './workspace.js';
import { initTerminal } from './terminal.js';
import { initSettings } from './settings.js';
import { initThreads } from './threads.js';
import { initSuperAgents } from './superagents.js';
import { initGithub } from './github.js';

let splitterDragging = false;

async function boot() {
  // Récupère d'abord la sauvegarde serveur (réglages + conversations), puis initialise l'UI.
  await hydrateServerState();
  startStatePolling();
  bindChrome();

  try {
    state.config = await api.config();
  } catch (error) {
    toast(`Server unreachable: ${error.message}`, 'err', 8000);
    return;
  }

  initWorkspace();
  initTerminal();
  initChat();
  initSettings();
  initThreads();
  initSuperAgents();
  initGithub();

  await refreshProjects();
  await openInitialProject();
  updateModeUI();
}

/* ── Projets ────────────────────────────────────────────────────────────── */

async function refreshProjects() {
  try {
    const data = await api.projects();
    state.projects = data.projects || [];
    renderProjectMenu();
    return state.projects;
  } catch (error) {
    toast(`Projects list unavailable: ${error.message}`, 'err');
    return [];
  }
}

function projectFolderName(project) {
  if (!project?.rootDir) return 'local folder';
  return String(project.rootDir).split(/[\\/]/).filter(Boolean).pop() || 'local folder';
}

function renderProjectMenu() {
  const list = $('#projectMenuList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.projects.length) {
    list.append(h('p', { class: 'project-menu-empty', text: 'No projects yet.' }));
  }
  for (const project of state.projects) {
    const active = state.project?.id === project.id;
    const item = h('button', {
      type: 'button',
      class: 'project-menu-item',
      role: 'option',
      'aria-selected': String(active),
      dataset: { projectId: project.id },
      title: project.mode === 'cloud' ? `${project.name} · Cloud project` : `${project.name} · ${project.rootDir || ''}`,
    });
    item.innerHTML = `
      <span class="project-menu-icon" aria-hidden="true">${icon(project.mode === 'cloud' ? 'cloud' : 'folder', 'sm')}</span>
      <span class="project-menu-copy"><strong></strong><small></small></span>
      <svg class="i sm project-menu-check" aria-hidden="true"><use href="#i-check"></use></svg>`;
    item.querySelector('strong').textContent = project.name;
    item.querySelector('small').textContent = project.mode === 'cloud'
      ? 'Cloud · internal storage + ZIP'
      : `PC · ${projectFolderName(project)}`;
    item.addEventListener('click', () => {
      closeProjectMenu();
      switchProject(project.id);
    });
    list.append(item);
  }
  syncProjectTrigger();
}

function syncProjectTrigger() {
  const value = $('#projectSelectValue');
  const use = $('#projectSelectUse');
  if (value) {
    value.textContent = state.project
      ? `${state.project.mode === 'cloud' ? 'Cloud' : 'PC'} · ${state.project.name}`
      : 'No project';
  }
  if (use) use.setAttribute('href', state.project?.mode === 'cloud' ? '#i-cloud' : '#i-folder');
}

function closeProjectMenu({ focus = false } = {}) {
  const menu = $('#projectSelectMenu');
  const trigger = $('#projectSelectBtn');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (focus) trigger?.focus();
}

function openProjectMenu() {
  const menu = $('#projectSelectMenu');
  if (!menu || !menu.hidden) return;
  menu.hidden = false;
  $('#projectSelectBtn')?.setAttribute('aria-expanded', 'true');
  menu.querySelector('.project-menu-item')?.focus();
}

function toggleProjectMenu() {
  const menu = $('#projectSelectMenu');
  if (!menu) return;
  if (menu.hidden) openProjectMenu();
  else closeProjectMenu({ focus: true });
}

async function openInitialProject() {
  const target =
    state.projects.find((project) => project.id === state.settings.lastProjectId) || state.projects[0];

  if (target) {
    await switchProject(target.id);
  } else {
    await createProject({
      name: 'My first project',
      mode: state.settings.mode === 'cloud' ? 'cloud' : 'pc',
    });
  }
}

async function switchProject(id, threadId = null) {
  if (!id) return;
  if (state.streaming && !confirm('A generation is running. Switching projects will stop it. Continue?')) return;
  const thread = threadId
    ? setActiveThread(id, threadId) || ensureThread(id)
    : ensureThread(id);
  state.project = state.projects.find((project) => project.id === id) || null;
  state.thread = thread;
  state.threadId = thread?.id || null;
  state.chat = thread?.messages || [];
  syncProjectTrigger();
  closeProjectMenu();
  await loadProject(id);
  updateZipState();
}

async function createProject({ name, mode, rootDir }) {
  try {
    const result = await api.createProject({ name, mode, rootDir: rootDir || undefined });
    state.projects.unshift(result.project);
    state.project = result.project;
    renderProjectMenu();
    const thread = ensureThread(result.project.id);
    state.thread = thread;
    state.threadId = thread?.id || null;
    state.chat = thread?.messages || [];
    await loadProject(result.project.id);
    bus.emit('thread:changed', thread);
    updateZipState();
    toast(
      result.project.mode === 'cloud'
        ? `Project “${result.project.name}” created in Supernova Cloud (ZIP export).`
        : `Project “${result.project.name}” created in “${projectFolderName(result.project)}”.`,
      'ok',
      4200
    );
    return result.project;
  } catch (error) {
    toast(`Cannot create project: ${error.message}`, 'err', 6000);
    return null;
  }
}

/* ── Interface ──────────────────────────────────────────────────────────── */

function bindChrome() {
  const projectTrigger = $('#projectSelectBtn');
  const projectMenu = $('#projectSelectMenu');

  projectTrigger.addEventListener('click', toggleProjectMenu);
  projectTrigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openProjectMenu();
    }
  });
  projectMenu.addEventListener('keydown', (event) => {
    const items = [...projectMenu.querySelectorAll('.project-menu-item, .project-menu-add')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      closeProjectMenu();
    } else if (event.key === 'Enter' && document.activeElement?.classList.contains('project-menu-add')) {
      event.preventDefault();
      closeProjectMenu();
      openNewProjectDialog();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.project-switcher')) closeProjectMenu();
  });
  $('#projectMenuAdd').addEventListener('click', () => {
    closeProjectMenu();
    openNewProjectDialog();
  });
  bus.on('project:new', openNewProjectDialog);
  bus.on('project:open', ({ projectId, threadId }) => switchProject(projectId, threadId));
  $('#settingsBtn').addEventListener('click', () => $('#settingsDialog').showModal());
  $('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal());
  $('#helpCloseBtn').addEventListener('click', () => $('#helpDialog').close());

  // Bascule thème clair / sombre (mémorisé dans le navigateur)
  const themeBtn = $('#themeBtn');
  const syncThemeButton = () => {
    const light = document.documentElement.dataset.theme === 'light';
    const label = light ? 'Switch to dark theme' : 'Switch to light theme';
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.setAttribute('aria-pressed', String(light));
  };
  themeBtn.addEventListener('click', () => {
    const light = document.documentElement.dataset.theme !== 'light';
    if (light) document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    saveUiPreferences({ theme: light ? 'light' : 'dark' });
    syncThemeButton();
  });
  syncThemeButton();
  bus.on('ui:changed', syncThemeButton);

  $('#modePcBtn').addEventListener('click', () => switchMode('pc'));
  $('#modeCloudBtn').addEventListener('click', () => switchMode('cloud'));

  $('#downloadZipBtn').addEventListener('click', downloadZip);

  const dialog = $('#newProjectDialog');
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'create') return;
    const name = $('#npName').value.trim();
    if (!name) return;
    const mode = new FormData($('#newProjectForm')).get('npMode') || 'pc';
    const rootDir = $('#npRoot').value.trim();
    await createProject({ name, mode: String(mode), rootDir });
  });

  for (const radio of $$('input[name="npMode"]')) {
    radio.addEventListener('change', () => {
      $('#npRootRow').classList.toggle('hidden', radio.value !== 'pc' || !radio.checked);
    });
  }

  // Splitter redimensionnable
  const splitter = $('#splitter');
  splitter.addEventListener('mousedown', () => {
    splitterDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (event) => {
    if (!splitterDragging) return;
    // Garde toujours de la place à l'aperçu et au volet des conversations.
    const layout = $('#layout');
    const narrow = window.innerWidth <= 1120;
    const sidebarWidth = layout.classList.contains('threads-collapsed') ? 44 : narrow ? 0 : 224;
    const maxWidth = Math.max(260, Math.min(760, window.innerWidth - 320 - sidebarWidth));
    const width = Math.min(Math.max(event.clientX, 240), maxWidth);
    document.documentElement.style.setProperty('--chat-width', `${width}px`);
  });
  window.addEventListener('mouseup', () => {
    if (!splitterDragging) return;
    splitterDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const value = getComputedStyle(document.documentElement).getPropertyValue('--chat-width').trim();
    saveUiPreferences({ chatWidth: value });
  });

  const savedWidth = localStorage.getItem('supernova.chatWidth');
  if (savedWidth) document.documentElement.style.setProperty('--chat-width', savedWidth);

  // Raccourcis globaux
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#projectSelectMenu')?.hidden) {
      closeProjectMenu({ focus: true });
      return;
    }
    if (event.key === 'Escape') {
      if (state.streaming) $('#stopBtn').click();
    }
    if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      for (const dialog of $$('dialog[open]')) dialog.close();
    }
  });

  bus.on('project:changed', (project) => {
    renderProjectMenu();
    updateZipState();
    updateModeUI();
    if (project) {
      const pill = $('#enginePill');
      if (pill) pill.textContent = project.mode === 'cloud' ? 'Cloud project · ZIP' : 'PC project';
    }
  });

  bus.on('settings:patch', (patch) => saveSettings(patch));
  bus.on('settings:changed', () => {
    updateModeUI();
    updateZipState();
  });
}

function openNewProjectDialog() {
  const dialog = $('#newProjectDialog');
  $('#npName').value = '';
  $('#npRoot').value = '';
  for (const radio of $$('input[name="npMode"]')) {
    radio.checked = radio.value === state.settings.mode;
  }
  $('#npRootRow').classList.toggle('hidden', state.settings.mode !== 'pc');
  dialog.returnValue = '';
  dialog.showModal();
  setTimeout(() => $('#npName').focus(), 30);
}

function switchMode(mode) {
  if (state.settings.mode === mode) return;
  saveSettings({ mode });
  updateModeUI();
  toast(
    mode === 'cloud'
      ? 'Cloud mode — new projects live in Supernova internal storage and export as ZIP.'
      : 'PC mode — new projects create a real folder on your machine.',
    'info',
    4200
  );
}

function updateZipState() {
  const button = $('#downloadZipBtn');
  const hasFiles = (state.files?.length || 0) > 0;
  button.disabled = !state.project || !hasFiles;
  button.title = !state.project
    ? 'No project'
    : hasFiles
      ? 'Download project as ZIP'
      : 'The project is empty';
}

function downloadZip() {
  if (!state.project) return toast('No project open.', 'warn');
  const link = document.createElement('a');
  link.href = `/api/projects/${state.project.id}/zip`;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
  toast(state.project.mode === 'cloud' ? 'Preparing ZIP (Cloud project).' : 'Preparing ZIP.', 'ok', 2400);
}

/* ── Démarrage ──────────────────────────────────────────────────────────── */

boot().catch((error) => {
  console.error(error);
  toast(`Startup failed: ${error.message}`, 'err', 9000);
});

// Exporté pour la console du navigateur (debug manuel)
window.supernova = { state, api, bus, sendMessage, setView };
