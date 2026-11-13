/* Lime AI — connexion GitHub et publication du projet courant */

import { $, state, bus, toast, api, saveSettings } from './core.js';

let githubBtn = null;
let dialog = null;
let closeBtn = null;
let disconnected = null;
let connected = null;
let tokenInput = null;
let connectBtn = null;
let connectStatus = null;
let avatarEl = null;
let loginEl = null;
let repoSelect = null;
let repoHint = null;
let refreshBtn = null;
let newRepoInput = null;
let createRepoBtn = null;
let privateInput = null;
let pushBtn = null;
let repoStatus = null;
let disconnectBtn = null;
let openRepoBtn = null;
let repos = [];

const GITHUB_URL = 'https://github.com';

function hasToken() {
  return Boolean(String(state.settings.githubToken || '').trim());
}

function currentRepo() {
  const projectId = state.project?.id;
  if (!projectId) return '';
  return String(state.settings.githubRepos?.[projectId] || '');
}

function saveRepo(repo) {
  if (!state.project?.id) return;
  const links = { ...(state.settings.githubRepos || {}) };
  if (repo) links[state.project.id] = repo;
  else delete links[state.project.id];
  saveSettings({ githubRepos: links });
}

function setStatus(element, message = '', kind = 'muted') {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('ok', kind === 'ok');
  element.classList.toggle('err', kind === 'err');
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (label) button.textContent = label;
}

function syncTrigger() {
  if (!githubBtn) return;
  const connectedState = hasToken();
  githubBtn.classList.toggle('connected', connectedState);
  githubBtn.title = connectedState
    ? `GitHub — ${state.settings.githubLogin || 'connected account'}`
    : 'Connect GitHub';
  const dot = $('#githubStatusDot');
  if (dot) dot.hidden = !connectedState;
}

function syncConnectedView() {
  const connectedState = hasToken();
  if (disconnected) disconnected.hidden = connectedState;
  if (connected) connected.hidden = !connectedState;
  if (loginEl) loginEl.textContent = state.settings.githubLogin || 'GitHub account';
  if (avatarEl) {
    const avatar = String(state.settings.githubAvatar || '');
    avatarEl.hidden = !avatar;
    if (avatar) {
      avatarEl.src = avatar;
      avatarEl.alt = state.settings.githubLogin ? `${state.settings.githubLogin} avatar` : 'GitHub avatar';
    }
  }
  if (repoSelect) repoSelect.disabled = !connectedState || !state.project;
  if (pushBtn) pushBtn.disabled = !connectedState || !state.project || !currentRepo();
  if (openRepoBtn) {
    const repo = currentRepo();
    openRepoBtn.disabled = !repo;
    openRepoBtn.title = repo ? `Open ${repo} on GitHub` : 'No linked repository';
  }
  syncTrigger();
  renderRepoChoices();
}

function renderRepoChoices() {
  if (!repoSelect) return;
  const selected = currentRepo();
  repoSelect.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = !state.project
    ? 'No project open'
    : repos.length ? 'Choose a repository…' : 'No repository available';
  repoSelect.append(empty);

  const available = [...repos];
  if (selected && !available.some((repo) => repo.fullName === selected)) {
    available.unshift({ fullName: selected, defaultBranch: '—', private: false });
  }
  for (const repo of available) {
    const option = document.createElement('option');
    option.value = repo.fullName;
    option.textContent = `${repo.fullName}${repo.private ? ' · private' : ''}`;
    repoSelect.append(option);
  }
  repoSelect.value = selected;
  repoSelect.disabled = !hasToken() || !state.project || !available.length;

  if (!state.project) {
    if (repoHint) repoHint.textContent = 'Open a project to link a repository.';
  } else if (!hasToken()) {
    if (repoHint) repoHint.textContent = 'Connect your account to choose a repository.';
  } else if (!repos.length) {
    if (repoHint) repoHint.textContent = 'No accessible repository. Create one below.';
  } else if (selected) {
    const target = available.find((repo) => repo.fullName === selected);
    if (repoHint) repoHint.textContent = `Target: ${selected}${target?.defaultBranch ? ` · branch ${target.defaultBranch}` : ''}.`;
  } else {
    if (repoHint) repoHint.textContent = 'Select the repository that will receive this project’s files.';
  }
  if (pushBtn) pushBtn.disabled = !hasToken() || !state.project || !selected;
  if (openRepoBtn) openRepoBtn.disabled = !selected;
}

function openDialog() {
  if (!dialog) return;
  setStatus(connectStatus, '');
  setStatus(repoStatus, '');
  syncConnectedView();
  if (!dialog.open) dialog.showModal();
  if (hasToken()) refreshRepos();
  else setTimeout(() => tokenInput?.focus(), 40);
}

function closeDialog() {
  if (dialog?.open) dialog.close();
}

async function connect() {
  const token = String(tokenInput?.value || '').trim();
  if (!token) {
    setStatus(connectStatus, 'Paste a GitHub token before continuing.', 'err');
    tokenInput?.focus();
    return;
  }
  setButtonBusy(connectBtn, true, 'Connecting…');
  setStatus(connectStatus, 'Checking token…');
  try {
    const result = await api.post('/api/github/connect', { token });
    saveSettings({
      githubToken: token,
      githubLogin: result.user?.login || '',
      githubAvatar: result.user?.avatarUrl || '',
    });
    if (tokenInput) tokenInput.value = '';
    syncConnectedView();
    setStatus(connectStatus, '');
    toast(`GitHub connected: ${result.user?.login || 'account'}.`, 'ok', 3000);
    await refreshRepos();
  } catch (error) {
    setStatus(connectStatus, error.message, 'err');
  } finally {
    setButtonBusy(connectBtn, false, 'Connect GitHub');
  }
}

async function refreshRepos() {
  if (!hasToken()) return;
  setButtonBusy(refreshBtn, true, 'Loading…');
  if (repoHint) repoHint.textContent = 'Fetching your repositories…';
  try {
    const result = await api.post('/api/github/repos', { token: state.settings.githubToken });
    repos = Array.isArray(result.repos) ? result.repos : [];
    renderRepoChoices();
    if (!repos.length && repoHint) repoHint.textContent = 'No accessible repository. Create one below.';
  } catch (error) {
    if (repoHint) repoHint.textContent = error.message;
    toast(`GitHub : ${error.message}`, 'err', 6500);
  } finally {
    setButtonBusy(refreshBtn, false, 'Refresh');
  }
}

async function createRepository() {
  if (!hasToken() || !state.project) {
    setStatus(repoStatus, 'Connect GitHub and open a project.', 'err');
    return;
  }
  const rawName = String(newRepoInput?.value || '').trim() || state.project.name;
  const name = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  if (!name) {
    setStatus(repoStatus, 'Choose a valid repository name.', 'err');
    newRepoInput?.focus();
    return;
  }
  setButtonBusy(createRepoBtn, true, 'Creating…');
  setStatus(repoStatus, `Creating ${name}…`);
  try {
    const result = await api.post('/api/github/repos/create', {
      token: state.settings.githubToken,
      name,
      private: Boolean(privateInput?.checked),
    });
    const repo = result.repo;
    repos = [repo, ...repos.filter((item) => item.fullName !== repo.fullName)];
    saveRepo(repo.fullName);
    if (newRepoInput) newRepoInput.value = '';
    syncConnectedView();
    setStatus(repoStatus, `Repository ${repo.fullName} created and linked to the project.`, 'ok');
    toast(`GitHub repository created: ${repo.fullName}.`, 'ok', 4200);
  } catch (error) {
    setStatus(repoStatus, error.message, 'err');
  } finally {
    setButtonBusy(createRepoBtn, false, 'Create and link');
  }
}

async function publishProject() {
  const repo = currentRepo();
  if (!hasToken() || !state.project || !repo) {
    setStatus(repoStatus, 'Choose a repository before publishing.', 'err');
    return;
  }
  setButtonBusy(pushBtn, true, 'Publishing…');
  setStatus(repoStatus, 'Creating commit and sending files…');
  try {
    const result = await api.post('/api/github/push', {
      token: state.settings.githubToken,
      projectId: state.project.id,
      repo,
      message: `Lime AI — ${state.project.name}`,
    });
    setStatus(
      repoStatus,
      `Published to ${result.repo} · ${result.branch} · ${result.files} file(s)${result.skipped ? ` (${result.skipped} skipped)` : ''}.`,
      'ok'
    );
    if (openRepoBtn) {
      openRepoBtn.dataset.url = `${GITHUB_URL}/${result.repo}`;
      openRepoBtn.disabled = false;
    }
    toast(`Project published to ${result.repo}.`, 'ok', 4600);
  } catch (error) {
    setStatus(repoStatus, error.message, 'err');
    toast(`Publication GitHub : ${error.message}`, 'err', 7000);
  } finally {
    setButtonBusy(pushBtn, false, 'Publier');
  }
}

function disconnect() {
  if (!hasToken()) return;
  if (!confirm('Disconnect GitHub and forget repositories linked to your projects?')) return;
  saveSettings({
    githubToken: '',
    githubLogin: '',
    githubAvatar: '',
    githubRepos: {},
  });
  repos = [];
  syncConnectedView();
  setStatus(connectStatus, 'GitHub account disconnected.');
  toast('GitHub disconnected.', 'ok', 2600);
}

function openRepository() {
  const repo = currentRepo();
  const url = openRepoBtn?.dataset.url || (repo ? `${GITHUB_URL}/${repo}` : '');
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function initGithub() {
  githubBtn = $('#githubBtn');
  dialog = $('#githubDialog');
  closeBtn = $('#githubCloseBtn');
  disconnected = $('#githubDisconnected');
  connected = $('#githubConnected');
  tokenInput = $('#githubToken');
  connectBtn = $('#githubConnectBtn');
  connectStatus = $('#githubConnectStatus');
  avatarEl = $('#githubAvatar');
  loginEl = $('#githubLogin');
  repoSelect = $('#githubRepoSelect');
  repoHint = $('#githubRepoHint');
  refreshBtn = $('#githubRefreshRepos');
  newRepoInput = $('#githubNewRepo');
  createRepoBtn = $('#githubCreateRepo');
  privateInput = $('#githubPrivate');
  pushBtn = $('#githubPushBtn');
  repoStatus = $('#githubRepoStatus');
  disconnectBtn = $('#githubDisconnectBtn');
  openRepoBtn = $('#githubOpenRepo');
  if (!githubBtn || !dialog) return;

  githubBtn.addEventListener('click', openDialog);
  closeBtn?.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
  connectBtn?.addEventListener('click', connect);
  tokenInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      connect();
    }
  });
  refreshBtn?.addEventListener('click', refreshRepos);
  createRepoBtn?.addEventListener('click', createRepository);
  pushBtn?.addEventListener('click', publishProject);
  disconnectBtn?.addEventListener('click', disconnect);
  openRepoBtn?.addEventListener('click', openRepository);
  repoSelect?.addEventListener('change', () => {
    saveRepo(repoSelect.value);
    if (openRepoBtn) delete openRepoBtn.dataset.url;
    renderRepoChoices();
  });
  bus.on('settings:changed', () => {
    syncTrigger();
    if (dialog?.open) syncConnectedView();
  });
  bus.on('project:changed', () => {
    if (dialog?.open) syncConnectedView();
    syncTrigger();
  });
  syncTrigger();
}
