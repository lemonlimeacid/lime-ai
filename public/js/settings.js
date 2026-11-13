/* Lime AI — paramètres, fournisseurs, serveurs MCP */

import { $, $$, h, api, state, bus, toast, saveSettings, icon, clearSettingsPersistence } from './core.js';
import { normalizeTheme, applyTheme, applyDepth, THEME_PRESETS } from './themes.js';
import { applyPriceBadge } from './pricing.js';

let mcpServers = [];

const MCP_PRESETS = {
  filesystem: {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    note: 'Read/write files (adjust the path).',
  },
  memory: {
    name: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    note: 'Persistent knowledge-base memory.',
  },
  'sequential-thinking': {
    name: 'sequential-thinking',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    note: 'Structured step-by-step reasoning.',
  },
  everything: {
    name: 'everything',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    note: 'MCP demo server (all tool types).',
  },
};

export function initSettings() {
  const dialog = $('#settingsDialog');
  const providerSelect = $('#setProvider');

  providerSelect.innerHTML = '';
  for (const preset of state.config.providers || []) {
    providerSelect.append(h('option', { value: preset.id }, preset.label));
  }

  // Galerie de thèmes : chaque carte montre un mini aperçu du dégradé.
  const gallery = $('#themeGallery');

  const syncThemeGallery = (value) => {
    if (!gallery) return;
    const theme = normalizeTheme(value);
    for (const card of $$('.theme-card', gallery)) {
      const active = card.dataset.themePreset === theme.id;
      card.classList.toggle('active', active);
      card.setAttribute('aria-checked', String(active));
      card.tabIndex = active ? 0 : -1;
    }
  };

  const selectTheme = (id) => {
    const theme = applyTheme(id);
    syncThemeGallery(theme.id);
    saveSettings({ theme: theme.id });
    toast(`${theme.label} enabled.`, 'ok', 2400);
  };

  const renderThemeGallery = () => {
    if (!gallery) return;
    gallery.innerHTML = '';
    for (const theme of THEME_PRESETS) {
      const card = h('button', {
        type: 'button',
        class: 'theme-card',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': `${theme.label} — ${theme.description}`,
        title: theme.description,
        dataset: { themePreset: theme.id },
        style: [
          `--card-gradient:${theme.preview.gradient}`,
          `--card-panel:${theme.preview.panel}`,
          `--card-line:${theme.preview.line}`,
          `--card-ink:${theme.preview.ink}`,
          `--card-dot:${theme.preview.dot}`,
        ].join(';'),
      });
      card.innerHTML = `
        <span class="theme-card-art${theme.preview.dotted ? ' is-dotted' : ''}" aria-hidden="true">
          <span class="theme-card-mini">
            <span class="theme-card-side"><i></i><i></i><i></i><i></i></span>
            <span class="theme-card-main">
              <span class="theme-card-tabs"><i></i><i></i></span>
              <span class="theme-card-copy"><i></i><i></i><i class="short"></i></span>
              <span class="theme-card-dot"></span>
            </span>
          </span>
        </span>
        <span class="theme-card-foot">
          <span class="theme-card-name">${theme.label}</span>
          ${theme.default ? '<span class="theme-card-default">Default</span>' : ''}
          <svg class="i xs theme-card-check" aria-hidden="true"><use href="#i-check"></use></svg>
        </span>`;
      card.addEventListener('click', () => selectTheme(theme.id));
      gallery.append(card);
    }
    syncThemeGallery(state.settings.theme);
  };

  gallery?.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const cards = $$('.theme-card', gallery);
    const current = event.target.closest?.('.theme-card');
    const index = cards.indexOf(current);
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = cards.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % cards.length;
    else next = (index - 1 + cards.length) % cards.length;
    const target = cards[next];
    target.focus();
    selectTheme(target.dataset.themePreset);
  });

  applyTheme(state.settings.theme);
  applyDepth(state.settings.threeD !== false);
  renderThemeGallery();
  syncThemeGallery(state.settings.theme);

  bus.on('settings:changed', (settings) => {
    applyTheme(settings.theme);
    applyDepth(settings.threeD !== false);
    syncThemeGallery(settings.theme);
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
  bindCheckbox('#set3d', 'threeD');

  const shellPolicy = $('#setShellPolicy');
  shellPolicy.addEventListener('change', () => saveSettings({ shellPolicy: shellPolicy.value }));

  providerSelect.addEventListener('change', () => applyProvider(providerSelect.value));
  $('#btnLoadModels').addEventListener('click', loadModels);
  $('#settingsCloseBtn').addEventListener('click', () => dialog.close());
  $('#resetSettingsBtn').addEventListener('click', async () => {
    if (!confirm('Reset all settings (including the API key)?')) return;
    await clearSettingsPersistence();
    localStorage.removeItem('lime.settings');
    localStorage.removeItem('lime.theme');
    localStorage.removeItem('lime.threeD');
    location.reload();
  });

  // MCP
  $('#mcpAddBtn').addEventListener('click', () => {
    mcpServers.push({
      id: `mcp-${Math.random().toString(36).slice(2, 7)}`,
      name: 'new-server',
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
      toast(`${preset.name} added — adjust the arguments, then Save.`, 'ok', 4000);
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
  $('#setLanguage').value = settings.language || 'English';
  $('#setSystemPrompt').value = settings.systemPrompt || '';
  $('#setVoiceLang').value = settings.voiceLang || 'en-US';
  $('#setAutoSpeak').checked = Boolean(settings.autoSpeak);
  $('#set3d').checked = settings.threeD !== false;
  applyTheme(settings.theme);
  applyDepth(settings.threeD !== false);

  const preset = (state.config.providers || []).find((item) => item.id === settings.provider);
  if (preset) {
    $('#providerHint').textContent = preset.hint || '';
    $('#keyOptional').textContent = preset.noKey ? '(not needed here)' : '';
    fillModelList(preset.models || []);
  }
  applyPriceBadge($('#setModelBadge'), settings.provider, settings.model);

  const dirs = $('#aboutDirs');
  if (dirs) {
    dirs.innerHTML = `
      <div>PC projects: <code>${escapeText(state.config.workspacesDir || '—')}</code></div>
      <div>Cloud: Lime internal storage (ZIP export)</div>
      <div>Backups: <code>${escapeText(state.config.stateDir || '—')}</code></div>
      <div>Data: <code>${escapeText(state.config.dataDir || '—')}</code></div>
      <div>Accepted formats: ${escapeText((state.config.formats || []).join(' · '))}</div>`;
  }
}

function applyProvider(providerId) {
  const preset = (state.config.providers || []).find((item) => item.id === providerId);
  if (!preset) return;
  $('#providerHint').textContent = preset.hint || '';
  $('#keyOptional').textContent = preset.noKey ? '(not needed here)' : '';
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
  toast(`${preset.label} selected.`, 'ok', 2400);
}

function fillModelList(models) {
  const list = $('#modelList');
  list.innerHTML = '';
  for (const model of models) list.append(h('option', { value: model }));
}

async function loadModels() {
  const status = $('#connStatus');
  status.textContent = 'Connecting…';
  status.style.color = '';
  try {
    const result = await api.models();
    const models = (result.models || []).filter((model) => !String(model).startsWith('Warning'));
    const warning = (result.models || []).find((model) => String(model).startsWith('Warning'));
    fillModelList(models);
    if (models.length) {
      status.textContent = `${models.length} model(s) available.`;
      status.style.color = 'var(--ok)';
      if (!$('#setModel').value) $('#setModel').value = models[0];
    } else {
      status.textContent = warning || 'No models returned.';
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
    status.textContent = 'Discovering servers and tools…';
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
        status.append(h('div', { class: 'muted', text: 'No servers configured yet.' }));
      }
      for (const server of servers) {
        const ok = server.status === 'ok';
        const label = ok
          ? `${server.name} — ${server.tools?.length || 0} tool(s)${server.tools?.length ? `: ${server.tools.map((tool) => tool.name).join(', ')}` : ''}`
          : `${server.name} — ${server.error || 'unknown error'}`;
        const line = h('div', { class: ok ? 'ok' : 'err' });
        line.innerHTML = `${icon(ok ? 'check' : 'x', 'sm')}<span>${escapeText(label)}</span>`;
        status.append(line);
      }
      state.mcpTools = data.tools || [];
    }
    if (refresh) toast('MCP tools refreshed.', 'ok', 2600);
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
    container.append(h('div', { class: 'mcp-empty', text: 'No MCP servers. Add a server or use an example above.' }));
    return;
  }

  mcpServers.forEach((server, index) => {
    const card = h('div', { class: 'mcp-card' });
    const top = h('div', { class: 'mcp-top' });
    const nameInput = h('input', { type: 'text', value: server.name, placeholder: 'server name' });
    nameInput.addEventListener('input', () => { server.name = nameInput.value; });
    const transportSelect = h('select', { 'aria-label': 'Transport' }, [
      h('option', { value: 'stdio' }, 'stdio'),
      h('option', { value: 'http' }, 'http'),
    ]);
    transportSelect.value = server.transport;
    transportSelect.addEventListener('change', () => {
      server.transport = transportSelect.value;
      renderMcpCards();
    });
    const remove = h('button', { class: 'icon-btn small', type: 'button', title: 'Delete', html: icon('trash', 'sm') });
    remove.addEventListener('click', () => {
      mcpServers.splice(index, 1);
      renderMcpCards();
    });
    top.append(nameInput, transportSelect, remove);
    card.append(top);

    const fields = h('div', { class: 'mcp-fields' });
    if (server.transport === 'http') {
      const urlInput = h('input', { type: 'text', value: server.url, placeholder: 'https://example.com/mcp' });
      urlInput.addEventListener('input', () => { server.url = urlInput.value; });
      fields.append(urlInput);
    } else {
      const commandInput = h('input', { type: 'text', value: server.command, placeholder: 'npx or node or python' });
      commandInput.addEventListener('input', () => { server.command = commandInput.value; });
      const argsInput = h('input', { type: 'text', value: (server.args || []).join(' '), placeholder: '-y @modelcontextprotocol/server-filesystem .' });
      argsInput.addEventListener('input', () => {
        server.args = argsInput.value.split(/\s+/).filter(Boolean);
      });
      fields.append(commandInput, argsInput);
    }
    card.append(fields);

    const envArea = h('textarea', { placeholder: 'Environment variables (JSON), e.g. {"API_KEY":"…"}' });
    envArea.value = server.envText || '{}';
    envArea.addEventListener('input', () => { server.envText = envArea.value; });
    card.append(envArea);

    const bottom = h('div', { class: 'row' });
    const toggle = h('label', { class: 'row', style: 'font-size:12px;color:var(--muted);gap:6px' });
    const checkbox = h('input', { type: 'checkbox' });
    checkbox.checked = server.enabled !== false;
    checkbox.addEventListener('change', () => { server.enabled = checkbox.checked; });
    toggle.append(checkbox, document.createTextNode(' enabled'));
    const testButton = h('button', { class: 'btn subtle small', type: 'button' }, 'Test');
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
    toast(`${escapeText(server.name)} — ${(result.tools || []).length} tool(s): ${escapeText((result.tools || []).join(', '))}`, 'ok', 7000);
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
    toast('MCP servers saved.', 'ok', 2600);
    await loadMcp({ refresh: true });
  } catch (error) {
    toast(`Unable to save: ${escapeText(error.message)}`, 'err');
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
