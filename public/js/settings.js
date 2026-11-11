/* Supernova IA — paramètres, fournisseurs, serveurs MCP */

import { $, $$, h, api, state, bus, toast, saveSettings, icon, clearSettingsPersistence } from './core.js';

let mcpServers = [];

function applyThemeStyle(value) {
  if (value === 'glass' || value === 'minimal') document.documentElement.dataset.style = value;
  else delete document.documentElement.dataset.style;
}

const THEME_LABELS = {
  default: 'Default theme',
  glass: 'Liquid glass theme',
  minimal: 'Minimalist theme',
};

const MCP_PRESETS = {
  filesystem: {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    note: 'Lecture/écriture de fichiers (adaptez le chemin).',
  },
  memory: {
    name: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    note: 'Mémoire persistante en base de connaissances.',
  },
  'sequential-thinking': {
    name: 'sequential-thinking',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    note: 'Raisonnement structuré par étapes.',
  },
  everything: {
    name: 'everything',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    note: 'Serveur de démonstration MCP (tous les types d’outils).',
  },
};

export function initSettings() {
  const dialog = $('#settingsDialog');
  const providerSelect = $('#setProvider');

  providerSelect.innerHTML = '';
  for (const preset of state.config.providers || []) {
    providerSelect.append(h('option', { value: preset.id }, preset.label));
  }

  // Style de thème : menu personnalisé (le select natif ne s'ouvrait pas dans la boîte de dialogue).
  const themeSelect = $('#themeSelect');
  const themeTrigger = $('#themeSelectBtn');
  const themeMenu = $('#themeSelectMenu');
  const themeValueEl = $('#themeSelectValue');
  const themeSwatch = $('#themeSelectSwatch');
  const themeOptions = $$('[data-theme-style]', themeMenu);

  const renderThemePicker = (value) => {
    const style = value === 'glass' || value === 'minimal' ? value : 'default';
    if (themeValueEl) themeValueEl.textContent = THEME_LABELS[style];
    if (themeSwatch) themeSwatch.dataset.style = style;
    for (const option of themeOptions) {
      option.setAttribute('aria-selected', String(option.dataset.themeStyle === style));
    }
  };

  const closeThemeMenu = ({ focus = false } = {}) => {
    if (!themeMenu || themeMenu.hidden) return;
    themeMenu.hidden = true;
    themeTrigger?.setAttribute('aria-expanded', 'false');
    if (focus) themeTrigger?.focus();
  };

  const openThemeMenu = () => {
    if (!themeMenu) return;
    themeMenu.hidden = false;
    themeTrigger?.setAttribute('aria-expanded', 'true');
    const selected = themeOptions.find((option) => option.getAttribute('aria-selected') === 'true') || themeOptions[0];
    selected?.focus();
  };

  applyThemeStyle(state.settings.themeStyle);
  renderThemePicker(state.settings.themeStyle);

  themeTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (themeMenu.hidden) openThemeMenu();
    else closeThemeMenu({ focus: true });
  });

  for (const option of themeOptions) {
    option.addEventListener('click', () => {
      const value = ['glass', 'minimal'].includes(option.dataset.themeStyle) ? option.dataset.themeStyle : 'default';
      applyThemeStyle(value);
      renderThemePicker(value);
      saveSettings({ themeStyle: value });
      closeThemeMenu({ focus: true });
      toast(
        value === 'glass' ? 'Liquid glass activé.' : value === 'minimal' ? 'Mode minimaliste activé.' : 'Thème par défaut activé.',
        'ok',
        2400
      );
    });
  }

  themeMenu?.addEventListener('keydown', (event) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = themeOptions.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = themeOptions.length - 1;
    else if (event.key === 'ArrowDown') next = (index + 1) % themeOptions.length;
    else next = (index - 1 + themeOptions.length) % themeOptions.length;
    themeOptions[next]?.focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!themeSelect || !themeMenu || themeMenu.hidden) return;
    if (themeSelect.contains(event.target)) return;
    closeThemeMenu();
  });

  // Capture : passe avant le raccourci global Échap qui ferme les dialogues.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !themeMenu || themeMenu.hidden) return;
      event.stopPropagation();
      closeThemeMenu({ focus: true });
    },
    true
  );

  $('#settingsDialog')?.addEventListener('close', () => closeThemeMenu());

  bus.on('settings:changed', (settings) => {
    applyThemeStyle(settings.themeStyle);
    renderThemePicker(settings.themeStyle);
  });

  // Navigation interne
  for (const button of $$('.settings-nav [data-section]')) {
    button.addEventListener('click', () => {
      for (const other of $$('.settings-nav [data-section]')) other.classList.toggle('active', other === button);
      for (const panel of $$('.settings-section')) panel.classList.toggle('active', panel.dataset.sectionPanel === button.dataset.section);
      if (button.dataset.section === 'mcp') loadMcp();
    });
  }

  // Champs simples
  const bindText = (selector, key, { number = false } = {}) => {
    const input = $(selector);
    if (!input) return;
    input.addEventListener('change', () => {
      const value = number ? Number(input.value) : input.value;
      saveSettings({ [key]: value });
    });
  };
  bindText('#setBaseUrl', 'baseUrl');
  bindText('#setModel', 'model');
  bindText('#setApiKey', 'apiKey');
  bindText('#setSystemPrompt', 'systemPrompt');
  bindText('#setLanguage', 'language');
  bindText('#setVoiceLang', 'voiceLang');

  const temperature = $('#setTemperature');
  temperature.addEventListener('input', () => {
    $('#tempValue').textContent = Number(temperature.value).toFixed(2);
    saveSettings({ temperature: Number(temperature.value) });
  });

  const bindCheckbox = (selector, key) => {
    const input = $(selector);
    input.addEventListener('change', () => saveSettings({ [key]: input.checked }));
  };
  bindCheckbox('#setAutoApply', 'autoApply');
  bindCheckbox('#setAutoContinue', 'autoContinue');
  bindCheckbox('#setAutoSpeak', 'autoSpeak');

  const shellPolicy = $('#setShellPolicy');
  shellPolicy.addEventListener('change', () => saveSettings({ shellPolicy: shellPolicy.value }));

  providerSelect.addEventListener('change', () => applyProvider(providerSelect.value));
  $('#btnLoadModels').addEventListener('click', loadModels);
  $('#settingsCloseBtn').addEventListener('click', () => dialog.close());
  $('#resetSettingsBtn').addEventListener('click', async () => {
    if (!confirm('Réinitialiser tous les réglages (clé d’API comprise) ?')) return;
    await clearSettingsPersistence();
    localStorage.removeItem('supernova.settings');
    location.reload();
  });

  // MCP
  $('#mcpAddBtn').addEventListener('click', () => {
    mcpServers.push({
      id: `mcp-${Math.random().toString(36).slice(2, 7)}`,
      name: 'nouveau-serveur',
      transport: 'stdio',
      command: '',
      args: [],
      envText: '{}',
      url: '',
      enabled: true,
    });
    renderMcpCards();
  });
  $('#mcpSaveBtn').addEventListener('click', saveMcp);
  $('#mcpRefreshBtn').addEventListener('click', async () => {
    await loadMcp({ refresh: true });
  });
  for (const button of $$('[data-mcp-preset]')) {
    button.addEventListener('click', () => {
      const preset = MCP_PRESETS[button.dataset.mcpPreset];
      if (!preset) return;
      mcpServers.push({
        id: `${preset.name}-${Math.random().toString(36).slice(2, 6)}`,
        name: preset.name,
        transport: preset.transport,
        command: preset.command,
        args: [...preset.args],
        envText: '{}',
        url: '',
        enabled: true,
      });
      renderMcpCards();
      toast(`${preset.name} ajouté — pense à adapter les arguments puis Enregistrer.`, 'ok', 4000);
    });
  }

  bus.on('settings:changed', syncFields);
  bus.on('settings:patch', (patch) => {
    saveSettings(patch);
    syncFields();
  });

  syncFields();
}

function syncFields() {
  const settings = state.settings;
  $('#setProvider').value = settings.provider;
  $('#setBaseUrl').value = settings.baseUrl || '';
  $('#setModel').value = settings.model || '';
  $('#setApiKey').value = settings.apiKey || '';
  $('#setTemperature').value = settings.temperature;
  $('#tempValue').textContent = Number(settings.temperature).toFixed(2);
  $('#setAutoApply').checked = settings.autoApply !== false;
  $('#setAutoContinue').checked = settings.autoContinue !== false;
  $('#setShellPolicy').value = settings.shellPolicy || 'ask';
  $('#setLanguage').value = settings.language || 'français';
  $('#setSystemPrompt').value = settings.systemPrompt || '';
  $('#setVoiceLang').value = settings.voiceLang || 'fr-FR';
  $('#setAutoSpeak').checked = Boolean(settings.autoSpeak);

  const preset = (state.config.providers || []).find((item) => item.id === settings.provider);
  if (preset) {
    $('#providerHint').textContent = preset.hint || '';
    $('#keyOptional').textContent = preset.noKey ? '(inutile ici)' : '';
    fillModelList(preset.models || []);
  }

  const dirs = $('#aboutDirs');
  if (dirs) {
    dirs.innerHTML = `
      <div>Projets PC : <code>${escapeText(state.config.workspacesDir || '—')}</code></div>
      <div>Cloud : stockage interne à Supernova IA (export ZIP)</div>
      <div>Sauvegardes : <code>${escapeText(state.config.stateDir || '—')}</code></div>
      <div>Données : <code>${escapeText(state.config.dataDir || '—')}</code></div>
      <div>Formats acceptés : ${escapeText((state.config.formats || []).join(' · '))}</div>`;
  }
}

function applyProvider(providerId) {
  const preset = (state.config.providers || []).find((item) => item.id === providerId);
  if (!preset) return;
  $('#providerHint').textContent = preset.hint || '';
  $('#keyOptional').textContent = preset.noKey ? '(inutile ici)' : '';
  $('#setBaseUrl').value = preset.baseUrl || '';
  $('#setModel').value = preset.models?.[0] || '';
  fillModelList(preset.models || []);
  const effortLevels = preset.modelReasoning?.[preset.models?.[0]] || preset.reasoning || ['medium'];
  saveSettings({
    provider: preset.id,
    baseUrl: preset.baseUrl || '',
    model: preset.models?.[0] || '',
    reasoningEffort: effortLevels.includes('medium') ? 'medium' : effortLevels[0],
  });
  toast(`${preset.label} sélectionné.`, 'ok', 2400);
}

function fillModelList(models) {
  const list = $('#modelList');
  list.innerHTML = '';
  for (const model of models) list.append(h('option', { value: model }));
}

async function loadModels() {
  const status = $('#connStatus');
  status.textContent = 'Connexion…';
  status.style.color = '';
  try {
    const result = await api.models();
    const models = (result.models || []).filter((model) => !String(model).startsWith('Attention'));
    const warning = (result.models || []).find((model) => String(model).startsWith('Attention'));
    fillModelList(models);
    if (models.length) {
      status.textContent = `${models.length} modèle(s) disponibles.`;
      status.style.color = 'var(--ok)';
      if (!$('#setModel').value) $('#setModel').value = models[0];
    } else {
      status.textContent = warning || 'Aucun modèle renvoyé.';
      status.style.color = 'var(--warn)';
    }
  } catch (error) {
    status.textContent = error.message;
    status.style.color = 'var(--danger)';
  }
}

/* ── MCP ────────────────────────────────────────────────────────────────── */

async function loadMcp({ refresh = false } = {}) {
  const status = $('#mcpStatus');
  if (status) {
    status.textContent = 'Découverte des serveurs et outils…';
    status.className = 'mcp-status';
  }
  try {
    const data = await api.mcpServers();
    const source = Array.isArray(data.config) && data.config.length ? data.config : data.servers || [];
    mcpServers = source.map((server) => ({
      id: server.id,
      name: server.name || server.id,
      transport: server.transport === 'http' ? 'http' : 'stdio',
      command: server.command || '',
      args: Array.isArray(server.args) ? server.args : String(server.args || '').split(/\s+/).filter(Boolean),
      envText: JSON.stringify(server.env || {}, null, 2),
      url: server.url || '',
      enabled: server.enabled !== false,
    }));
    renderMcpCards();

    if (status) {
      const servers = data.servers || [];
      status.innerHTML = '';
      if (!servers.length) {
        status.append(h('div', { class: 'muted', text: 'Aucun serveur configuré pour l’instant.' }));
      }
      for (const server of servers) {
        const ok = server.status === 'ok';
        const label = ok
          ? `${server.name} — ${server.tools?.length || 0} outil(s)${server.tools?.length ? ` : ${server.tools.map((tool) => tool.name).join(', ')}` : ''}`
          : `${server.name} — ${server.error || 'erreur inconnue'}`;
        const line = h('div', { class: ok ? 'ok' : 'err' });
        line.innerHTML = `${icon(ok ? 'check' : 'x', 'sm')}<span>${escapeText(label)}</span>`;
        status.append(line);
      }
      state.mcpTools = data.tools || [];
    }
    if (refresh) toast('Outils MCP actualisés.', 'ok', 2600);
  } catch (error) {
    if (status) {
      status.className = 'mcp-status';
      status.innerHTML = '';
      status.append(h('div', { class: 'err', text: error.message }));
    }
  }
}

function renderMcpCards() {
  const container = $('#mcpList');
  if (!container) return;
  container.innerHTML = '';

  if (!mcpServers.length) {
    container.append(h('div', { class: 'mcp-empty', text: 'Aucun serveur MCP. Ajoute un serveur ou utilise un exemple ci-dessus.' }));
    return;
  }

  mcpServers.forEach((server, index) => {
    const card = h('div', { class: 'mcp-card' });
    const top = h('div', { class: 'mcp-top' });
    const nameInput = h('input', { type: 'text', value: server.name, placeholder: 'nom du serveur' });
    nameInput.addEventListener('input', () => { server.name = nameInput.value; });
    const transportSelect = h('select', {}, [
      h('option', { value: 'stdio' }, 'stdio'),
      h('option', { value: 'http' }, 'http'),
    ]);
    transportSelect.value = server.transport;
    transportSelect.addEventListener('change', () => {
      server.transport = transportSelect.value;
      renderMcpCards();
    });
    const remove = h('button', { class: 'icon-btn small', type: 'button', title: 'Supprimer', html: icon('trash', 'sm') });
    remove.addEventListener('click', () => {
      mcpServers.splice(index, 1);
      renderMcpCards();
    });
    top.append(nameInput, transportSelect, remove);
    card.append(top);

    const fields = h('div', { class: 'mcp-fields' });
    if (server.transport === 'http') {
      const urlInput = h('input', { type: 'text', value: server.url, placeholder: 'https://exemple.com/mcp' });
      urlInput.addEventListener('input', () => { server.url = urlInput.value; });
      fields.append(urlInput);
    } else {
      const commandInput = h('input', { type: 'text', value: server.command, placeholder: 'npx ou node ou python' });
      commandInput.addEventListener('input', () => { server.command = commandInput.value; });
      const argsInput = h('input', { type: 'text', value: (server.args || []).join(' '), placeholder: '-y @modelcontextprotocol/server-filesystem .' });
      argsInput.addEventListener('input', () => {
        server.args = argsInput.value.split(/\s+/).filter(Boolean);
      });
      fields.append(commandInput, argsInput);
    }
    card.append(fields);

    const envArea = h('textarea', { placeholder: 'Variables d’environnement (JSON), ex : {"API_KEY":"…"}' });
    envArea.value = server.envText || '{}';
    envArea.addEventListener('input', () => { server.envText = envArea.value; });
    card.append(envArea);

    const bottom = h('div', { class: 'row' });
    const toggle = h('label', { class: 'row', style: 'font-size:12px;color:var(--muted);gap:6px' });
    const checkbox = h('input', { type: 'checkbox' });
    checkbox.checked = server.enabled !== false;
    checkbox.addEventListener('change', () => { server.enabled = checkbox.checked; });
    toggle.append(checkbox, document.createTextNode(' activé'));
    const testButton = h('button', { class: 'btn subtle small', type: 'button' }, 'Tester');
    testButton.addEventListener('click', () => testServer(server, testButton));
    bottom.append(toggle, h('div', { class: 'spacer' }), testButton);
    card.append(bottom);

    container.append(card);
  });
}

async function testServer(server, button) {
  const original = button.textContent;
  button.textContent = 'Test…';
  button.disabled = true;
  try {
    const result = await api.post('/api/mcp/test', {
      server: {
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: safeJson(server.envText),
        url: server.url,
        headers: {},
      },
    });
    toast(`${escapeText(server.name)} — ${(result.tools || []).length} outil(s) : ${escapeText((result.tools || []).join(', '))}`, 'ok', 7000);
  } catch (error) {
    toast(`${escapeText(server.name)} — ${escapeText(error.message)}`, 'err', 9000);
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

async function saveMcp() {
  const payload = mcpServers.map((server) => ({
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: safeJson(server.envText),
    url: server.url,
    headers: {},
    enabled: server.enabled !== false,
  }));
  try {
    await api.saveMcpServers(payload);
    toast('Serveurs MCP enregistrés.', 'ok', 2600);
    await loadMcp({ refresh: true });
  } catch (error) {
    toast(`Enregistrement impossible : ${escapeText(error.message)}`, 'err');
  }
}

function safeJson(text) {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function openSettings(section = 'ai') {
  const dialog = $('#settingsDialog');
  if (!dialog) return;
  const button = $(`.settings-nav [data-section="${section}"]`);
  button?.click();
  if (!dialog.open) dialog.showModal();
}
