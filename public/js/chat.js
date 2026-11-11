/* Supernova IA — chat, streaming SSE, vocal, actions de l'agent */

import {
  $, $$, h, api, state, bus, toast, renderMarkdown, saveChat, clearChat, ensureThread,
  stripProtocol, providerLabel, icon, formatBytes, saveSettings,
} from './core.js';
import { refreshFiles, openFile } from './workspace.js';

let messagesEl = null;
let promptEl = null;
let sendBtn = null;
let stopBtn = null;
let micBtn = null;
let speakBtn = null;
let enhanceBtn = null;
let hintEl = null;
let controller = null;
let recognition = null;
let live = null;
let frame = null;
let saveTimer = null;
let attachBtn = null;
let fileInput = null;
let attachmentsEl = null;
let pendingFiles = [];
let modelPickerBtn = null;
let modelPickerLabel = null;
let modelMenu = null;
let modelMenuList = null;
let modelMenuToggle = null;
let modelMenuCount = null;
let modelEffortSlider = null;
let modelEffortTicks = null;
let modelEffortValue = null;
let modelEffortHint = null;
let showAllModels = false;
let lastModelRenderKey = '';

const MAX_FILES = 6;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILE_CHARS = 16000;
const TOTAL_FILE_CHARS = 48000;
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'psd',
  'pdf', 'zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz',
  'mp3', 'wav', 'ogg', 'flac', 'mp4', 'mov', 'webm', 'avi', 'mkv',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class', 'o', 'a',
  'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'sqlite', 'sqlite3', 'db',
]);
const LANGUAGE_BY_EXT = {
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'mdx', txt: 'texte',
  py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift', kt: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', xml: 'xml',
  svg: 'svg', env: 'bash', gitignore: 'bash', dockerfile: 'docker',
};

function fileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function languageFor(name) {
  const base = String(name || '').toLowerCase();
  if (base === 'dockerfile') return 'docker';
  if (base === '.gitignore' || base === '.env') return 'bash';
  return LANGUAGE_BY_EXT[fileExtension(name)] || fileExtension(name) || 'texte';
}

function resetAttachments() {
  pendingFiles = [];
  renderAttachments();
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (!state.project) return toast('Crée d’abord un projet.', 'warn');

  let total = pendingFiles.reduce((sum, file) => sum + file.content.length, 0);
  for (const file of files) {
    if (pendingFiles.length >= MAX_FILES) {
      toast(`Maximum ${MAX_FILES} fichiers joints par message.`, 'warn', 4200);
      break;
    }
    if (!file.size) {
      toast(`« ${file.name} » est vide.`, 'warn', 3600);
      continue;
    }
    if (BINARY_EXTENSIONS.has(fileExtension(file.name))) {
      toast(`« ${file.name} » : seuls les fichiers texte et le code sont acceptés.`, 'warn', 5200);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`« ${file.name} » dépasse 512 Ko.`, 'warn', 4600);
      continue;
    }

    let content = '';
    try {
      content = await file.text();
    } catch {
      toast(`Lecture impossible : « ${file.name} ».`, 'err', 5200);
      continue;
    }
    if (content.includes('\u0000')) {
      toast(`« ${file.name} » est un fichier binaire. Joins du texte ou du code.`, 'warn', 5200);
      continue;
    }
    if (!content.trim()) {
      toast(`« ${file.name} » est vide.`, 'warn', 3600);
      continue;
    }
    if (content.length > MAX_FILE_CHARS) {
      content = `${content.slice(0, MAX_FILE_CHARS)}\n… (fichier tronqué)`;
      toast(`« ${file.name} » est tronqué à ${MAX_FILE_CHARS} caractères.`, 'info', 4200);
    }
    if (total + content.length > TOTAL_FILE_CHARS) {
      toast(`Limite de ${TOTAL_FILE_CHARS} caractères joints atteinte.`, 'warn', 5200);
      break;
    }
    total += content.length;
    pendingFiles.push({
      id: uid(),
      name: String(file.name).slice(0, 160),
      size: file.size,
      language: languageFor(file.name),
      content,
    });
  }
  renderAttachments();
}

function renderAttachments() {
  if (!attachmentsEl) return;
  attachmentsEl.innerHTML = '';
  attachmentsEl.hidden = !pendingFiles.length;

  for (const file of pendingFiles) {
    const chip = h('span', { class: 'attach-chip', title: `${file.name} · ${formatBytes(file.size)}` });
    chip.innerHTML = `<svg class="i xs" aria-hidden="true"><use href="#i-file-code"></use></svg><span class="attach-name"></span><span class="attach-size">${formatBytes(file.size)}</span>`;
    chip.querySelector('.attach-name').textContent = file.name;

    const remove = h('button', {
      type: 'button',
      class: 'attach-remove',
      title: 'Retirer',
      'aria-label': `Retirer ${file.name}`,
    });
    remove.innerHTML = icon('x', 'xs');
    remove.addEventListener('click', () => {
      pendingFiles = pendingFiles.filter((item) => item.id !== file.id);
      renderAttachments();
    });

    chip.append(remove);
    attachmentsEl.append(chip);
  }
}

function historyContent(message) {
  const base = String(message.content || '').trim();
  const files = Array.isArray(message.attachments) ? message.attachments : [];
  if (!files.length) return base;
  const blocks = files.map((file) => {
    const lang = String(file.language || '').replace(/`/g, '');
    return `Fichier joint : ${file.name}\n\`\`\`${lang}\n${file.content || ''}\n\`\`\``;
  });
  return [base, ...blocks].filter(Boolean).join('\n\n');
}

const AGENT_SUGGESTIONS = [
  'Crée un site vitrine pour un café de quartier à Lyon',
  'Fais une app de tâches avec sauvegarde locale',
  'Génère un jeu de serpent jouable au clavier',
  'Crée une app météo avec Open-Meteo',
  'Rends le design plus moderne',
];

const CHAT_SUGGESTIONS = [
  'Explique-moi comment fonctionne un routeur Express',
  'Cherche les bonnes pratiques d’un formulaire accessible',
  'Écris une fonction JavaScript de debounce',
  'Compare CSS Grid et Flexbox',
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function initChat() {
  messagesEl = $('#messages');
  promptEl = $('#prompt');
  sendBtn = $('#sendBtn');
  stopBtn = $('#stopBtn');
  micBtn = $('#micBtn');
  speakBtn = $('#speakBtn');
  enhanceBtn = $('#enhanceBtn');
  hintEl = $('#composerHint');
  attachBtn = $('#attachBtn');
  fileInput = $('#fileInput');
  attachmentsEl = $('#composerAttachments');
  initModelPicker();

  sendBtn.addEventListener('click', () => {
    const text = promptEl.value.trim();
    if (text || pendingFiles.length) sendMessage(text);
  });

  promptEl.addEventListener('keydown', (event) => {
    // Entrée envoie ; Maj+Entrée insère un saut de ligne (Ctrl/Meta+Entrée aussi).
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      const text = promptEl.value.trim();
      if (text || pendingFiles.length) sendMessage(text);
    }
  });

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await addFiles(fileInput.files);
    fileInput.value = '';
  });

  const composerBox = $('.composer-box');
  composerBox.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    composerBox.classList.add('dragover');
  });
  composerBox.addEventListener('dragleave', () => composerBox.classList.remove('dragover'));
  composerBox.addEventListener('drop', async (event) => {
    event.preventDefault();
    composerBox.classList.remove('dragover');
    await addFiles(event.dataTransfer?.files);
  });
  promptEl.addEventListener('paste', (event) => {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      addFiles(files);
    }
  });

  promptEl.addEventListener('input', autoGrow);

  stopBtn.addEventListener('click', cancelRun);
  micBtn.addEventListener('click', toggleDictation);
  speakBtn.addEventListener('click', toggleAutoSpeak);
  enhanceBtn.addEventListener('click', enhancePrompt);
  $('#clearChatBtn').addEventListener('click', () => {
    if (!state.project) return;
    if (state.streaming) return toast('Arrête la génération en cours avant d’effacer.', 'warn');
    if (!state.chat.length) return;
    if (!confirm('Effacer la conversation en cours ?')) return;
    const thread = clearChat(state.project.id);
    if (thread) {
      state.thread = thread;
      state.threadId = thread.id;
    }
    state.chat = [];
    renderChat();
    syncComposerPlaceholder();
    bus.emit('threads:changed');
    toast('Conversation effacée.', 'ok', 2400);
  });

  bus.on('project:changed', () => {
    const thread = ensureThread(state.project?.id);
    state.thread = thread;
    state.threadId = thread?.id || null;
    state.chat = thread?.messages || [];
    resetAttachments();
    renderChat();
    updatePills();
    syncComposerPlaceholder();
    bus.emit('thread:active', thread);
  });
  bus.on('thread:changed', (thread) => {
    if (!thread || thread.projectId !== state.project?.id) return;
    state.thread = thread;
    state.threadId = thread.id;
    state.chat = thread.messages || [];
    resetAttachments();
    renderChat();
    updatePills();
    syncComposerPlaceholder();
  });
  bus.on('settings:changed', updatePills);

  updatePills();
  syncSpeakButton();
  syncComposerPlaceholder();
  renderChat();
}

const EFFORT_LABELS = {
  minimal: 'Minimal',
  low: 'Rapide',
  medium: 'Équilibré',
  high: 'Puissant',
  max: 'Maximum',
  standard: 'Standard',
};

function effortLabel(level) {
  return EFFORT_LABELS[level] || String(level || 'Standard');
}

function providerName(preset) {
  return String(preset?.label || preset?.id || 'Fournisseur')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+—.*$/, '')
    .trim();
}

function presetFor(providerId = state.settings.provider) {
  return (state.config.providers || []).find((preset) => preset.id === providerId) || null;
}

function effortLevelsFor(preset = presetFor(), model = state.settings.model) {
  const levels = preset?.modelReasoning?.[model] || preset?.reasoning;
  return Array.isArray(levels) && levels.length ? levels : ['low', 'medium', 'high'];
}

function initModelPicker() {
  modelPickerBtn = $('#modelPickerBtn');
  modelPickerLabel = $('#modelPickerLabel');
  modelMenu = $('#modelPickerMenu');
  modelMenuList = $('#modelMenuList');
  modelMenuToggle = $('#modelMenuToggle');
  modelMenuCount = $('#modelMenuCount');
  modelEffortSlider = $('#modelEffortSlider');
  modelEffortTicks = $('#modelEffortTicks');
  modelEffortValue = $('#modelEffortValue');
  modelEffortHint = $('#modelEffortHint');
  if (!modelPickerBtn || !modelMenu) return;

  modelPickerBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (modelMenu.hidden) openModelMenu();
    else closeModelMenu();
  });

  modelMenuToggle?.addEventListener('click', () => {
    showAllModels = !showAllModels;
    renderModelMenu();
  });

  modelEffortSlider?.addEventListener('input', () => {
    const levels = effortLevelsFor();
    const level = levels[Number(modelEffortSlider.value)];
    if (!level) return;
    saveSettings({ reasoningEffort: level });
    syncModelEffort();
  });

  document.addEventListener('click', (event) => {
    if (modelMenu.hidden) return;
    if (!modelMenu.contains(event.target) && !modelPickerBtn.contains(event.target)) closeModelMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modelMenu.hidden) closeModelMenu();
  });

  syncModelPickerLabel();
}

function syncModelPickerLabel() {
  if (!modelPickerLabel) return;
  const model = state.settings.model || 'Modèle';
  modelPickerLabel.textContent = model;
  modelPickerBtn.title = `${providerName(presetFor())} · ${model}`;
}

function syncModelEffort() {
  if (!modelEffortSlider) return;
  const levels = effortLevelsFor();
  let level = levels.includes(state.settings.reasoningEffort)
    ? state.settings.reasoningEffort
    : (levels.includes('medium') ? 'medium' : levels[0]);
  if (!level) level = 'standard';
  const index = Math.max(0, levels.indexOf(level));
  const last = Math.max(0, levels.length - 1);
  modelEffortSlider.max = String(last);
  modelEffortSlider.value = String(index);
  modelEffortSlider.disabled = levels.length <= 1 || state.streaming;
  modelEffortSlider.style.setProperty('--effort-progress', `${last ? (index / last) * 100 : 100}%`);
  if (modelEffortValue) modelEffortValue.textContent = effortLabel(level);
  if (modelEffortTicks) {
    modelEffortTicks.innerHTML = levels.map((item, tick) =>
      `<span class="model-effort-tick${tick === index ? ' active' : ''}">${escapeText(effortLabel(item))}</span>`
    ).join('');
  }
  if (modelEffortHint) {
    modelEffortHint.textContent = levels.length > 1
      ? `Niveaux disponibles pour ce modèle : ${levels.join(' · ')}.`
      : 'Ce modèle utilise son réglage de performance par défaut.';
  }
}

function modelGroups() {
  const activeId = state.settings.provider;
  const groups = (state.config.providers || [])
    .map((preset) => ({
      ...preset,
      name: providerName(preset),
      models: [...(preset.models || [])],
      active: preset.id === activeId,
    }))
    .filter((preset) => preset.models.length);
  const active = groups.find((preset) => preset.active);
  if (active && !active.models.includes(state.settings.model)) active.models.unshift(state.settings.model);
  if (active) return [active, ...groups.filter((preset) => preset !== active)];
  return groups;
}

function renderModelMenu() {
  if (!modelMenu || !modelMenuList) return;
  const groups = modelGroups();
  const visibleGroups = showAllModels
    ? groups
    : groups.filter((group, index) => group.active || index < 3);
  const totalModels = groups.reduce((sum, group) => sum + group.models.length, 0);
  const hiddenModels = groups.some((group) => {
    const shown = visibleGroups.includes(group);
    return shown && group.models.length > (showAllModels ? Infinity : 5);
  });
  const hasHidden = visibleGroups.length < groups.length || hiddenModels;

  modelMenuCount.textContent = `${groups.length} fournisseur${groups.length > 1 ? 's' : ''} · ${totalModels} modèle${totalModels > 1 ? 's' : ''}`;
  modelMenuToggle.hidden = !hasHidden;
  modelMenuToggle.setAttribute('aria-expanded', String(showAllModels));
  modelMenuToggle.innerHTML = `${showAllModels ? 'Show less' : 'Show more'}<svg class="i xs" aria-hidden="true"><use href="#i-chevron-down"></use></svg>`;

  modelMenuList.innerHTML = '';
  for (const group of visibleGroups) {
    const section = h('div', { class: 'model-provider' });
    const head = h('div', { class: 'model-provider-head' });
    head.append(
      h('span', { class: 'model-provider-name', text: group.name }),
      h('span', { class: 'model-provider-count', text: String(group.models.length) })
    );
    section.append(head);

    let models = showAllModels ? group.models : group.models.slice(0, 5);
    if (group.active && !models.includes(state.settings.model)) models = [state.settings.model, ...models];
    for (const model of models) {
      const selected = group.id === state.settings.provider && model === state.settings.model;
      const item = h('button', {
        class: `model-item${selected ? ' active' : ''}`,
        type: 'button',
        title: `${group.name} · ${model}`,
        'aria-current': selected ? 'true' : null,
      });
      item.innerHTML = `<span class="model-item-name"></span><svg class="i sm model-item-check" aria-hidden="true"><use href="#i-check"></use></svg>`;
      item.querySelector('.model-item-name').textContent = model;
      item.addEventListener('click', () => selectModel(group, model));
      section.append(item);
    }
    modelMenuList.append(section);
  }

  lastModelRenderKey = `${state.settings.provider}/${state.settings.model}`;
  syncModelEffort();
}

function selectModel(group, model) {
  const levels = effortLevelsFor(group, model);
  let effort = state.settings.reasoningEffort;
  if (!levels.includes(effort)) effort = levels.includes('medium') ? 'medium' : levels[0];
  saveSettings({
    provider: group.id,
    baseUrl: group.baseUrl || '',
    model,
    reasoningEffort: effort,
  });
  closeModelMenu();
  toast(`${group.name} · ${model}`, 'ok', 1800);
}

function openModelMenu() {
  if (!modelMenu) return;
  showAllModels = false;
  modelMenu.hidden = false;
  modelPickerBtn.setAttribute('aria-expanded', 'true');
  renderModelMenu();
}

function closeModelMenu() {
  if (!modelMenu) return;
  modelMenu.hidden = true;
  modelPickerBtn?.setAttribute('aria-expanded', 'false');
}

function syncModelPicker() {
  syncModelPickerLabel();
  if (!modelMenu || modelMenu.hidden) return;
  const key = `${state.settings.provider}/${state.settings.model}`;
  if (key !== lastModelRenderKey) renderModelMenu();
  else syncModelEffort();
}

function syncComposerPlaceholder() {
  if (!promptEl) return;
  promptEl.placeholder = state.thread?.kind === 'chat'
    ? 'Pose ta question ou décris ce que tu cherches…'
    : 'Décris ce que tu veux construire…';
}

function autoGrow() {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(180, promptEl.scrollHeight)}px`;
}

function updatePills() {
  const pill = $('#enginePill');
  if (pill) pill.textContent = providerLabel();
  const statusProvider = $('#statusProvider');
  if (statusProvider) statusProvider.textContent = providerLabel();
  syncModelPicker();
  const attachHint = ' Trombone : joins un fichier texte ou du code.';
  if (state.settings.provider === 'local') {
    hintEl.textContent = `Moteur local actif — aucun réseau, aucune clé. L’aperçu live se rafraîchit à chaque fichier.${attachHint}`;
  } else {
    hintEl.textContent = `Connecté à ${providerLabel()} · Entrée pour envoyer, Maj+Entrée pour aller à la ligne.${attachHint}`;
  }
}

function syncSpeakButton() {
  if (!speakBtn) return;
  speakBtn.classList.toggle('active', Boolean(state.settings.autoSpeak));
  speakBtn.innerHTML = icon(state.settings.autoSpeak ? 'volume' : 'volume-x', 'sm');
  speakBtn.title = state.settings.autoSpeak ? 'Lecture vocale activée' : 'Lire les réponses à voix haute';
}

/* ── Rendu ───────────────────────────────────────────────────────────────── */

export function renderChat() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  const chat = state.chat || [];

  if (!chat.length) {
    messagesEl.append(welcomeCard());
    return;
  }

  for (const message of chat) {
    messagesEl.append(renderMessage(message));
  }

  // Un rendu complet pendant le streaming doit re-cibler les nœuds vivants.
  if (state.streaming && live?.assistant) {
    const node = messagesEl.querySelector(`.msg[data-id="${live.assistant.id}"]`);
    if (node) {
      live.bubble = node.querySelector('.bubble');
      live.activity = node.querySelector('.activity');
    }
  }

  scrollToBottom(true);
}

function welcomeCard() {
  const kind = state.thread?.kind === 'chat' ? 'chat' : 'agent';
  const projectName = state.project?.name || 'ton projet';
  const node = h('div', { class: 'welcome' });
  node.innerHTML = `
    <div class="welcome-head">
      <p class="welcome-eyebrow">${kind === 'chat' ? 'Chat' : 'Tâche de code'}</p>
      <h2>${kind === 'chat' ? 'Pose ta question' : 'Décris ce que tu veux construire'}</h2>
      <p>${kind === 'chat'
        ? 'Recherche, question ou code simple. Le contexte du projet reste disponible.'
        : `Travaille sur <strong>${escapeText(projectName)}</strong> : fichiers, aperçu live, terminal et outils MCP.`}</p>
    </div>
    <div class="welcome-grid"></div>
    <p class="welcome-note">Mode ${state.project?.mode === 'cloud' ? '<strong>Cloud</strong> — stockage interne Supernova, export ZIP' : '<strong>PC</strong> — écriture dans un dossier local'} · ${escapeText(providerLabel())}</p>`;
  const grid = node.querySelector('.welcome-grid');
  for (const suggestion of kind === 'chat' ? CHAT_SUGGESTIONS : AGENT_SUGGESTIONS) {
    const button = h('button', { class: 'suggestion', type: 'button' }, suggestion);
    button.addEventListener('click', () => {
      promptEl.value = suggestion;
      promptEl.focus();
      autoGrow();
    });
    grid.append(button);
  }
  return node;
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMessage(message) {
  const wrap = h('div', { class: `msg ${message.role}${message.error ? ' error' : ''}`, dataset: { id: message.id } });

  if (message.role === 'user') {
    const files = Array.isArray(message.attachments) ? message.attachments : [];
    const bubble = h('div', { class: 'bubble' });
    if (message.content) bubble.innerHTML = renderMarkdown(message.content);
    if (files.length) wrap.append(renderMessageFiles(files));
    wrap.append(bubble, messageActions(message));
    return wrap;
  }

  const head = h('div', { class: 'head' }, [
    h('span', { class: 'avatar', html: icon('logo') }),
    h('span', { class: 'name', text: 'Supernova' }),
  ]);

  const activity = h('div', { class: 'activity' });
  for (const act of message.activity || []) activity.append(renderActivity(act));

  const bubble = h('div', { class: 'bubble' });
  if (message.content) bubble.innerHTML = renderMarkdown(message.content);
  else if (!message.activity?.length && !state.streaming) bubble.innerHTML = '<p class="muted">…</p>';

  wrap.append(head, activity, bubble, messageActions(message));
  return wrap;
}

function renderMessageFiles(files) {
  const row = h('div', { class: 'msg-files' });
  for (const file of files) {
    const chip = h('span', {
      class: 'msg-file',
      title: `${file.name} · ${formatBytes(file.size)}${file.language ? ` · ${file.language}` : ''}`,
    });
    chip.innerHTML = `<svg class="i xs" aria-hidden="true"><use href="#i-file-code"></use></svg><span></span>`;
    chip.querySelector('span').textContent = file.name;
    row.append(chip);
  }
  return row;
}

function messageActions(message) {
  const row = h('div', { class: 'msg-actions' });
  if (message.content) {
    const copy = h('button', { type: 'button', title: 'Copier le message', html: `${icon('copy', 'sm')}<span>Copier</span>` });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        toast('Message copié.', 'ok', 1600);
      } catch {
        toast('Copie impossible dans ce navigateur.', 'warn');
      }
    });
    row.append(copy);

    if (message.role === 'assistant') {
      const speak = h('button', { type: 'button', title: 'Lire à voix haute', html: icon('volume', 'sm') });
      speak.addEventListener('click', () => speakText(message.content));
      row.append(speak);
    }
  }
  if (message.role === 'assistant' && !state.streaming) {
    const regen = h('button', { type: 'button', title: 'Régénérer la réponse', html: icon('regenerate', 'sm') });
    regen.addEventListener('click', () => regenerate());
    row.append(regen);
  }
  return row;
}

function renderActivity(act) {
  const node = h('div', { class: 'act' });
  if (act.status === 'ok') node.classList.add('ok');
  if (act.status === 'warn') node.classList.add('warn');
  if (act.status === 'error') node.classList.add('err');

  const iconEl = h('span', { class: 'ico' });
  if (act.status === 'running') {
    iconEl.append(h('span', { class: 'spinner' }));
  } else {
    const fallback = { file: 'file-code', shell: 'terminal', tool: 'plug', info: 'info', warn: 'alert', error: 'x', approval: 'shield', proposal: 'file-plus' };
    const stored = /^[a-z][a-z-]*$/.test(act.icon || '') ? act.icon : '';
    iconEl.innerHTML = icon(stored || fallback[act.kind] || 'info', 'sm');
  }

  const body = h('div', { class: 'body' });
  body.append(h('div', { class: 'title', text: act.title || '' }));
  if (act.detail) {
    const detail = h('div', { class: 'detail', text: act.detail });
    body.append(detail);
  }

  if (act.kind === 'approval' && !act.resolved) {
    const row = h('div', { class: 'row', style: 'margin-top:8px' });
    const yes = h('button', { class: 'btn primary small', type: 'button' }, 'Exécuter');
    const no = h('button', { class: 'btn subtle small', type: 'button' }, 'Refuser');
    yes.addEventListener('click', () => resolveApproval(act, true));
    no.addEventListener('click', () => resolveApproval(act, false));
    row.append(yes, no);
    body.append(row);
  }

  if (act.kind === 'proposal' && !act.resolved) {
    const apply = h('button', { class: 'btn primary small', type: 'button', style: 'margin-top:8px' }, 'Appliquer les fichiers');
    apply.addEventListener('click', async () => {
      try {
        for (const file of act.files || []) {
          await api.writeFile(state.project.id, file.path, file.content);
        }
        act.resolved = true;
        act.status = 'ok';
        act.title = `${act.files.length} fichier(s) appliqué(s)`;
        toast('Fichiers appliqués.', 'ok');
        await refreshFiles();
        if (state.streaming && live) scheduleRender();
        else renderChat();
      } catch (error) {
        toast(`Application impossible : ${error.message}`, 'err');
      }
    });
    body.append(apply);
  }

  node.append(iconEl, body);
  return node;
}

function resolveApproval(act, approved) {
  if (!state.runId) return toast('Exécution introuvable.', 'err');
  api
    .post(`/api/agent/${state.runId}/approve`, { callId: act.callId, approved })
    .then(() => {
      act.resolved = true;
      act.status = approved ? 'running' : 'warn';
      act.title = approved ? `${act.title} — autorisé` : `${act.title} — refusé`;
      if (state.streaming && live) scheduleRender();
      else renderChat();
    })
    .catch((error) => toast(error.message, 'err'));
}

function scrollToBottom(force = false) {
  if (!messagesEl) return;
  const near = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
  if (force || near) messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ── Envoi ───────────────────────────────────────────────────────────────── */

export async function sendMessage(text) {
  if (state.streaming) return toast('Une génération est déjà en cours.', 'warn', 2000);
  if (!state.project) return toast('Crée d’abord un projet.', 'warn');

  const content = String(text || '').trim();
  const attachments = pendingFiles.map((file) => ({
    name: file.name,
    size: file.size,
    language: file.language,
    content: file.content,
  }));
  if (!content && !attachments.length) return;

  state.chat.push({
    id: uid(),
    role: 'user',
    content,
    attachments,
    activity: [],
    createdAt: new Date().toISOString(),
  });
  pendingFiles = [];
  renderAttachments();
  promptEl.value = '';
  autoGrow();
  saveChat(state.project.id, state.chat);
  bus.emit('threads:changed');
  renderChat();
  await runAssistant();
}

export async function regenerate() {
  if (state.streaming) return;
  if (!state.chat.length) return;
  const lastUserIndex = [...state.chat].map((m) => m.role).lastIndexOf('user');
  if (lastUserIndex === -1) return;
  state.chat = state.chat.slice(0, lastUserIndex + 1);
  renderChat();
  await runAssistant();
}

async function runAssistant() {
  const project = state.project;
  if (!project) return;

  const assistant = {
    id: uid(),
    role: 'assistant',
    content: '',
    activity: [],
    createdAt: new Date().toISOString(),
  };

  const history = state.chat
    .filter((message) => message.role !== 'system')
    .slice(-20)
    .map((message) => ({ role: message.role, content: historyContent(message) }))
    .filter((message) => message.content.trim());

  state.chat.push(assistant);
  renderChat();

  const last = messagesEl.querySelector(`.msg[data-id="${assistant.id}"]`);
  live = last
    ? { bubble: last.querySelector('.bubble'), activity: last.querySelector('.activity'), assistant }
    : { bubble: null, activity: null, assistant };

  setStreaming(true);
  state.runId = null;

  controller = new AbortController();
  const started = Date.now();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        projectId: project.id,
        messages: history,
        settings: {
          provider: state.settings.provider,
          model: state.settings.model,
          apiKey: state.settings.apiKey,
          baseUrl: state.settings.baseUrl,
          temperature: state.settings.temperature,
          reasoningEffort: state.settings.reasoningEffort,
          autoApply: state.settings.autoApply,
          autoContinue: state.settings.autoContinue,
          shellPolicy: state.settings.shellPolicy,
          language: state.settings.language,
          systemPrompt: state.settings.systemPrompt,
        },
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `Erreur ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          handleEvent(event, assistant);
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      assistant.activity.push({ kind: 'info', title: 'Génération arrêtée', status: 'warn', icon: 'square' });
    } else {
      assistant.error = true;
      assistant.content = `${assistant.content}\n\n**Erreur** — ${error.message}`.trim();
      toast(escapeText(error.message), 'err', 7000);
    }
  } finally {
    setStreaming(false);
    live = null;
    controller = null;
    state.runId = null;
    if (assistant.content || assistant.activity.length) {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      assistant.duration = seconds;
      saveChat(state.project?.id, state.chat);
      bus.emit('threads:changed');
      if (state.settings.autoSpeak && assistant.content) speakText(assistant.content);
    }
    renderChat();
    refreshFiles({ openNewest: true });
  }
}

function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!live?.bubble) return;
    const target = live.bubble;
    if (live.assistant.content) {
      target.innerHTML = renderMarkdown(live.assistant.content);
    }
    if (state.streaming) {
      const caret = h('span', { class: 'typing' }, [h('i'), h('i'), h('i')]);
      target.append(caret);
    }
    if (live.activity) {
      live.activity.innerHTML = '';
      for (const act of live.assistant.activity) live.activity.append(renderActivity(act));
    }
    scrollToBottom();
  });
}

function pushActivity(assistant, activity) {
  activity.id = activity.id || uid();
  const existing = activity.key ? assistant.activity.find((item) => item.key === activity.key) : null;
  if (existing) Object.assign(existing, activity);
  else assistant.activity.push(activity);
  scheduleRender();
  return existing || activity;
}

function handleEvent(event, assistant) {
  switch (event.type) {
    case 'run_started':
      state.runId = event.runId;
      break;

    case 'mode':
      if (state.project) state.project.mode = event.mode;
      break;

    case 'token':
      assistant.content += event.text || '';
      scheduleRender();
      break;

    case 'reasoning':
      if (!assistant.reasoning) assistant.reasoning = '';
      assistant.reasoning += event.text || '';
      break;

    case 'search':
      recordSearchEvent(event);
      break;

    case 'file_start':
      pushActivity(assistant, {
        key: `file:${event.path}`,
        kind: 'file',
        title: event.path,
        detail: 'écriture en cours…',
        status: 'running',
      });
      break;

    case 'file_chunk': {
      const act = assistant.activity.find((item) => item.key === `file:${event.path}`);
      if (act) {
        act.bytes = (act.bytes || 0) + (event.text || '').length;
        act.detail = `écriture en cours… ${act.bytes} caractères`;
      }
      break;
    }

    case 'file_saved': {
      const act = pushActivity(assistant, {
        key: `file:${event.path}`,
        kind: 'file',
        title: event.path,
        detail: `${event.bytes} o enregistrés`,
        status: 'ok',
      });
      act.detail = `${event.bytes} o enregistrés`;
      bus.emit('log', { type: 'file', text: `Fichier écrit : <code>${escapeText(event.path)}</code> (${event.bytes} o)` });
      bus.emit('files:changed', { path: event.path });
      break;
    }

    case 'file_deleted':
      pushActivity(assistant, { kind: 'file', title: `${event.path} supprimé`, status: 'warn', icon: 'trash' });
      bus.emit('log', { type: 'file', text: `Fichier supprimé : <code>${escapeText(event.path)}</code>` });
      bus.emit('files:changed', {});
      break;

    case 'file_proposed':
      pushActivity(assistant, {
        kind: 'proposal',
        title: event.path,
        detail: `${event.bytes} o proposés — applique pour écrire le fichier.`,
        status: 'warn',
        files: [{ path: event.path, content: event.content }],
      });
      break;

    case 'proposals':
      pushActivity(assistant, {
        kind: 'proposal',
        title: `${event.files.length} fichier(s) proposé(s)`,
        detail: event.files.map((file) => file.path).join(', '),
        status: 'warn',
        files: event.files,
      });
      break;

    case 'shell_start':
      pushActivity(assistant, {
        key: `shell:${event.command}`,
        kind: 'shell',
        title: event.command,
        detail: 'exécution…',
        status: 'running',
      });
      bus.emit('terminal:append', { text: `\n$ ${event.command}\n`, stream: 'cmd' });
      bus.emit('log', { type: 'shell', text: `Commande : <code>${escapeText(event.command)}</code>` });
      break;

    case 'shell_output':
      bus.emit('terminal:append', { text: event.text || '', stream: event.stream });
      {
        const act = assistant.activity.find((item) => item.kind === 'shell' && item.status === 'running');
        if (act) {
          act.output = `${act.output || ''}${event.text || ''}`;
          act.detail = (act.output.slice(-400) || '').trim() || 'exécution…';
          scheduleRender();
        }
      }
      break;

    case 'shell_end': {
      const act = assistant.activity.find((item) => item.kind === 'shell' && item.status === 'running');
      if (act) {
        act.status = event.code === 0 ? 'ok' : 'error';
        act.detail = `code ${event.code}${act.output ? `\n${act.output.slice(-600).trim()}` : ''}`;
      }
      bus.emit('terminal:append', { text: `\n[code ${event.code}]\n`, stream: event.code === 0 ? 'sys' : 'err' });
      scheduleRender();
      break;
    }

    case 'shell_denied':
      pushActivity(assistant, {
        kind: 'shell',
        title: event.command,
        detail: 'refusée — commande non exécutée',
        status: 'warn',
        icon: 'ban',
      });
      break;

    case 'approval_request':
      pushActivity(assistant, {
        kind: 'approval',
        title: 'Commande à autoriser',
        detail: event.payload?.command || '',
        callId: event.callId,
        status: 'warn',
        icon: 'shield',
      });
      break;

    case 'approval_timeout': {
      const act = assistant.activity.find((item) => item.callId === event.callId);
      if (act && !act.resolved) {
        act.resolved = true;
        act.status = 'warn';
        act.detail = 'délai dépassé — commande refusée';
      }
      scheduleRender();
      break;
    }

    case 'tool_start':
      pushActivity(assistant, { key: `tool:${event.tool}`, kind: 'tool', title: event.tool, detail: 'appel MCP…', status: 'running' });
      bus.emit('log', { type: 'tool', text: `Outil MCP : <code>${escapeText(event.tool)}</code>` });
      break;

    case 'tool_result': {
      const act = assistant.activity.find((item) => item.kind === 'tool' && item.title === event.tool);
      if (act) {
        act.status = event.error ? 'error' : 'ok';
        act.detail = event.error || String(event.result || '').slice(0, 700);
      } else {
        pushActivity(assistant, {
          kind: 'tool',
          title: event.tool,
          detail: event.error || String(event.result || '').slice(0, 700),
          status: event.error ? 'error' : 'ok',
        });
      }
      scheduleRender();
      break;
    }

    case 'mcp_status':
      state.mcpTools = event.servers || [];
      bus.emit('mcp:status', event.servers || []);
      break;

    case 'terminal_append':
      bus.emit('terminal:append', { text: event.text || '', stream: 'stdout' });
      break;

    case 'warning':
      toast(escapeText(event.message), 'warn');
      break;

    case 'stats':
      bus.emit('log', {
        type: 'info',
        text: `Génération terminée · ${event.filesWritten || 0} fichier(s) · ${event.toolCalls || 0} outil(s) MCP`,
      });
      break;

    case 'error':
      assistant.error = true;
      assistant.content = `${assistant.content}\n\n**Erreur** — ${event.message}`.trim();
      toast(escapeText(event.message || 'Erreur'), 'err', 7000);
      scheduleRender();
      break;

    case 'cancelled':
      assistant.activity.push({ kind: 'info', title: 'Génération annulée', status: 'warn', icon: 'square' });
      scheduleRender();
      break;

    case 'done':
      bus.emit('log', { type: 'info', text: 'Réponse terminée' });
      break;

    default:
      break;
  }
}

function setStreaming(on) {
  state.streaming = on;
  sendBtn.classList.toggle('hidden', on);
  stopBtn.classList.toggle('hidden', !on);
  if (modelPickerBtn) {
    modelPickerBtn.disabled = on;
    if (on) closeModelMenu();
  }
  if (modelEffortSlider) modelEffortSlider.disabled = on;
  promptEl.disabled = false;
  document.body.classList.toggle('is-streaming', on);
  if (on) {
    saveTimer = setInterval(() => saveChat(state.project?.id, state.chat), 2500);
  } else {
    if (saveTimer) {
      clearInterval(saveTimer);
      saveTimer = null;
    }
    if (modelEffortSlider) modelEffortSlider.disabled = false;
  }
}

function recordSearchEvent(event) {
  const query = String(event.query || '').trim();
  if (!query) return;
  if (!Array.isArray(state.searches)) state.searches = [];

  if (event.phase === 'start') {
    state.searches.unshift({
      id: uid(),
      query,
      status: 'running',
      results: [],
      note: '',
      createdAt: new Date().toISOString(),
    });
  } else if (event.phase === 'results') {
    let entry = state.searches.find((item) => item.query === query && item.status === 'running');
    if (!entry) {
      entry = { id: uid(), query, status: 'done', results: [], note: '', createdAt: new Date().toISOString() };
      state.searches.unshift(entry);
    }
    entry.status = 'done';
    entry.results = Array.isArray(event.results) ? event.results : [];
    entry.note = String(event.note || '');
    entry.finishedAt = new Date().toISOString();
  }
  state.searches = state.searches.slice(0, 30);
  bus.emit('search:changed');
}

async function cancelRun() {
  if (!state.runId) {
    controller?.abort();
    return;
  }
  try {
    await api.post(`/api/agent/${state.runId}/cancel`, {});
  } catch {
    controller?.abort();
  }
}

/* ── Prompt amélioré ─────────────────────────────────────────────────────── */

async function enhancePrompt() {
  const text = promptEl.value.trim();
  if (!text) {
    promptEl.focus();
    return toast('Écris d’abord une idée, même courte.', 'warn', 2400);
  }
  const original = text;
  enhanceBtn.disabled = true;
  enhanceBtn.innerHTML = icon('loader', 'sm spin');
  try {
    const result = await api.enhance(text);
    promptEl.value = result.prompt;
    autoGrow();
    promptEl.focus();
    toast('Prompt enrichi. Tu peux le modifier avant d’envoyer.', 'ok', 4000);
    promptEl.dataset.original = original;
  } catch (error) {
    toast(`Amélioration impossible : ${escapeText(error.message)}`, 'err', 6000);
  } finally {
    enhanceBtn.disabled = false;
    enhanceBtn.innerHTML = icon('sparkles', 'sm');
  }
}

/* ── Vocal ───────────────────────────────────────────────────────────────── */

function toggleDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    return toast(
      'La dictée n’est pas disponible dans ce navigateur. Essaie Chrome ou Edge (la lecture vocale, elle, fonctionne partout).',
      'warn',
      7000
    );
  }
  if (recognition) {
    recognition.stop();
    return;
  }

  const base = promptEl.value;
  const rec = new Recognition();
  rec.lang = state.settings.voiceLang || 'fr-FR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    micBtn.classList.add('recording');
    micBtn.title = 'Arrêter la dictée';
    toast('Écoute en cours — parle maintenant.', 'info', 2200);
  };

  rec.onresult = (event) => {
    let finalText = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    promptEl.value = `${base}${base && (finalText || interim) ? ' ' : ''}${finalText}${interim}`;
    autoGrow();
  };

  rec.onerror = (event) => {
    if (event.error === 'no-speech') toast('Aucune voix détectée, réessaie.', 'warn');
    else if (event.error === 'not-allowed') toast('Micro refusé : autorise l’accès au microphone.', 'err', 6000);
    else toast(`Dictée : ${event.error}`, 'err');
  };

  rec.onend = () => {
    recognition = null;
    micBtn.classList.remove('recording');
    micBtn.title = 'Dicter à la voix';
    promptEl.focus();
  };

  recognition = rec;
  try {
    rec.start();
  } catch {
    recognition = null;
    micBtn.classList.remove('recording');
  }
}

export function speakText(text) {
  if (!('speechSynthesis' in window)) {
    toast('Synthèse vocale non supportée par ce navigateur.', 'warn');
    return;
  }
  const clean = stripProtocol(text).replace(/[*_`#>]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').slice(0, 3500);
  if (!clean) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = state.settings.voiceLang || 'fr-FR';
  utterance.rate = 1.02;
  speechSynthesis.speak(utterance);
}

function toggleAutoSpeak() {
  const next = !state.settings.autoSpeak;
  bus.emit('settings:patch', { autoSpeak: next });
  syncSpeakButton();
  toast(next ? 'Lecture vocale activée.' : 'Lecture vocale désactivée.', 'ok', 2200);
  if (next) speakText('Lecture vocale activée.');
}

export { openFile };
