/* Lime AI — volet des conversations et création rapide */

import {
  $, $$, h, state, bus, toast, timeAgo, icon, saveUiPreferences,
  createThread, deleteThread, ensureThread, listThreads, setActiveThread,
} from './core.js';
import { defaultSuperAgents } from './superagents.js';

let layout = null;
let listEl = null;
let toggleBtn = null;
let newBtn = null;
let menu = null;
let backdrop = null;

const isNarrow = () => window.matchMedia('(max-width: 1120px)').matches;

function closeMenu() {
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  newBtn?.setAttribute('aria-expanded', 'false');
}

function openMenu() {
  if (!menu) return;
  menu.hidden = false;
  newBtn?.setAttribute('aria-expanded', 'true');
  menu.querySelector('[role="menuitem"]')?.focus();
}

function setCollapsed(collapsed, { persist = true } = {}) {
  if (!layout) return;
  layout.classList.toggle('threads-collapsed', collapsed);
  if (toggleBtn) {
    const label = collapsed ? 'Show conversations' : 'Collapse conversations';
    toggleBtn.title = label;
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  if (collapsed) closeMenu();
  if (persist) saveUiPreferences({ threadsCollapsed: collapsed ? '1' : '0' });
}

function renderList() {
  if (!listEl) return;
  const threads = listThreads();
  listEl.innerHTML = '';

  if (!threads.length) {
    listEl.append(
      h('div', { class: 'threads-empty' }, [
        h('span', { class: 'threads-empty-icon', html: icon('message', 'sm') }),
        h('span', { text: 'No conversations' }),
        h('small', { text: 'Use + to get started.' }),
      ])
    );
    return;
  }

  const projectNames = new Map((state.projects || []).map((project) => [project.id, project.name]));
  for (const thread of threads) {
    const active = thread.id === state.threadId;
    const row = h('div', {
      class: `thread-row${active ? ' active' : ''}`,
      dataset: { threadId: thread.id },
    });

    const open = h('button', {
      class: 'thread-open',
      type: 'button',
      title: thread.title,
      'aria-current': active ? 'true' : null,
    });
    open.append(
      h('span', {
        class: 'thread-icon',
        html: icon(thread.kind === 'chat' ? 'message' : thread.kind === 'super' ? 'sparkles' : 'code', 'sm'),
      }),
      h('span', { class: 'thread-copy' }, [
        h('span', { class: 'thread-name', text: thread.title }),
        h('span', {
          class: 'thread-meta',
          text: `${projectNames.get(thread.projectId) || 'Project'} · ${timeAgo(thread.updatedAt)}${thread.kind === 'super' ? ` · ${thread.agents?.length || 0} agents` : ''}`,
        }),
      ])
    );
    open.addEventListener('click', () => openThread(thread));

    const remove = h('button', {
      class: 'thread-del icon-btn small',
      type: 'button',
      title: 'Delete conversation',
      'aria-label': `Delete “${thread.title}”`,
      html: icon('trash', 'sm'),
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeThread(thread);
    });

    row.append(open, remove);
    listEl.append(row);
  }
}

function openThread(thread) {
  if (!thread) return;
  if (state.streaming) {
    toast('Stop the current generation before switching conversations.', 'warn');
    return;
  }
  closeMenu();
  if (thread.projectId !== state.project?.id) {
    bus.emit('project:open', { projectId: thread.projectId, threadId: thread.id });
  } else {
    const active = setActiveThread(thread.projectId, thread.id);
    if (!active) return;
    state.thread = active;
    state.threadId = active.id;
    state.chat = active.messages || [];
    bus.emit('thread:changed', active);
  }
  if (isNarrow()) setCollapsed(true);
}

function removeThread(thread) {
  if (state.streaming) {
    toast('Stop the current generation before deleting.', 'warn');
    return;
  }
  if (!confirm(`Delete the conversation “${thread.title}”?`)) return;
  const wasActive = thread.id === state.threadId;
  deleteThread(thread.id);
  bus.emit('threads:changed');
  if (wasActive) {
    const next = ensureThread(thread.projectId);
    state.thread = next;
    state.threadId = next?.id || null;
    state.chat = next?.messages || [];
    bus.emit('thread:changed', next);
  }
  toast('Conversation deleted.', 'ok', 2400);
}

function createItem(kind) {
  closeMenu();
  if (kind === 'project') {
    bus.emit('project:new');
    return;
  }
  if (!state.project) {
    toast('Create a project first.', 'warn');
    return;
  }
  if (state.streaming) {
    toast('Stop the current generation before creating a conversation.', 'warn');
    return;
  }

  const normalizedKind = kind === 'chat' ? 'chat' : kind === 'super' ? 'super' : 'agent';
  const thread = createThread(state.project.id, {
    kind: normalizedKind,
    agents: normalizedKind === 'super' ? defaultSuperAgents() : [],
  });
  if (!thread) return;
  state.thread = thread;
  state.threadId = thread.id;
  state.chat = [];
  bus.emit('thread:changed', thread);
  bus.emit('preview:reset');
  bus.emit('threads:changed');
  if (isNarrow()) setCollapsed(true);
  setTimeout(() => $('#prompt')?.focus(), 40);
  toast(
    normalizedKind === 'chat'
      ? 'New conversation.'
      : normalizedKind === 'super'
        ? 'Super agents project created — agents are ready.'
        : 'New coding task.',
    'ok',
    normalizedKind === 'super' ? 3600 : 2200
  );
}

export function initThreads() {
  layout = $('#layout');
  listEl = $('#threadsList');
  toggleBtn = $('#threadsToggle');
  newBtn = $('#threadsNewBtn');
  menu = $('#threadsCreateMenu');
  backdrop = $('#threadsBackdrop');
  if (!layout || !listEl || !toggleBtn || !newBtn || !menu) return;

  let stored = null;
  try {
    stored = localStorage.getItem('lime.threadsCollapsed');
  } catch (error) {
    stored = null;
  }
  setCollapsed(isNarrow() || stored === '1', { persist: false });

  toggleBtn.addEventListener('click', () => setCollapsed(!layout.classList.contains('threads-collapsed')));
  newBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  backdrop?.addEventListener('click', () => setCollapsed(true));

  for (const item of $$('[data-thread-create]', menu)) {
    item.addEventListener('click', () => createItem(item.dataset.threadCreate));
  }

  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || newBtn.contains(event.target)) return;
    closeMenu();
  });

  // Capture pour passer avant le raccourci global Échap qui ferme les dialogues.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || menu.hidden) return;
      event.stopPropagation();
      closeMenu();
      newBtn.focus();
    },
    true
  );

  window.matchMedia('(max-width: 1120px)').addEventListener('change', (event) => {
    if (event.matches) setCollapsed(true);
  });

  bus.on('threads:changed', renderList);
  bus.on('thread:changed', renderList);
  bus.on('thread:active', renderList);
  bus.on('project:changed', renderList);
  renderList();
}
