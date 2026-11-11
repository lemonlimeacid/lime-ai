import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR } from './store.js';

/**
 * Sauvegarde locale partagée entre le site et l'application desktop.
 * Le fichier vit dans un dossier interne masqué : data/.user/state.json.
 * Il contient les réglages, les conversations et les préférences d'interface.
 */
export const STATE_DIR = path.join(DATA_DIR, '.user');
export const STATE_FILE = path.join(STATE_DIR, 'state.json');
const BACKUP_FILE = `${STATE_FILE}.bak`;
const MAX_STATE_BYTES = 12 * 1024 * 1024;
let hiddenMarked = false;

/** Sur Windows, un nom en point ne suffit pas : on pose aussi l'attribut « caché ». */
function hideOnWindows() {
  if (process.platform !== 'win32' || hiddenMarked) return;
  hiddenMarked = true;
  execFile('attrib', ['+h', STATE_FILE], () => {});
  execFile('attrib', ['+h', STATE_DIR], () => {});
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyState() {
  return {
    version: 1,
    revision: 0,
    updatedAt: null,
    settings: {},
    threads: { v: 1, threads: [], activeByProject: {} },
    ui: {},
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeThreads(value) {
  if (!isObject(value)) return { v: 1, threads: [], activeByProject: {} };
  const threads = Array.isArray(value.threads)
    ? value.threads.slice(-500).map((thread) => ({
        ...thread,
        messages: Array.isArray(thread.messages) ? thread.messages.slice(-120) : [],
      }))
    : [];
  return {
    v: 1,
    threads,
    activeByProject: isObject(value.activeByProject) ? value.activeByProject : {},
  };
}

function loadState() {
  const base = emptyState();
  const raw = readJson(STATE_FILE) || readJson(BACKUP_FILE);
  if (!isObject(raw)) return base;
  return {
    ...base,
    ...raw,
    revision: Number(raw.revision) || 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    settings: isObject(raw.settings) ? raw.settings : {},
    threads: normalizeThreads(raw.threads),
    ui: isObject(raw.ui) ? raw.ui : {},
  };
}

let state = loadState();

function writeState(next) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const payload = JSON.stringify(next, null, 2);
  if (Buffer.byteLength(payload, 'utf8') > MAX_STATE_BYTES) {
    const error = new Error('Sauvegarde trop volumineuse (max 12 Mo).');
    error.status = 413;
    throw error;
  }

  try {
    if (fs.existsSync(STATE_FILE)) fs.copyFileSync(STATE_FILE, BACKUP_FILE);
  } catch (error) {
    console.error('[state] copie de secours impossible:', error.message);
  }

  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  try {
    fs.renameSync(tmp, STATE_FILE);
  } catch {
    // Windows ne remplace pas toujours un fichier existant avec rename.
    fs.copyFileSync(tmp, STATE_FILE);
    fs.rmSync(tmp, { force: true });
  }
  hideOnWindows();

  // La sauvegarde peut contenir une clé d'API : on la réserve au compte utilisateur.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(STATE_DIR, 0o700);
      fs.chmodSync(STATE_FILE, 0o600);
      if (fs.existsSync(BACKUP_FILE)) fs.chmodSync(BACKUP_FILE, 0o600);
    } catch (error) {
      console.error('[state] permissions non appliquées:', error.message);
    }
  }
}

export function getState() {
  return state;
}

export function saveState(patch = {}) {
  if (!isObject(patch)) {
    const error = new Error('Sauvegarde invalide.');
    error.status = 400;
    throw error;
  }

  const next = {
    ...state,
    revision: (state.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  };

  if ('settings' in patch) {
    if (!isObject(patch.settings)) {
      const error = new Error('Réglages invalides.');
      error.status = 400;
      throw error;
    }
    next.settings = patch.settings;
  }

  if ('threads' in patch) {
    if (!isObject(patch.threads) || !Array.isArray(patch.threads.threads)) {
      const error = new Error('Conversations invalides.');
      error.status = 400;
      throw error;
    }
    next.threads = normalizeThreads(patch.threads);
  }

  if ('ui' in patch) {
    if (!isObject(patch.ui)) {
      const error = new Error('Préférences invalides.');
      error.status = 400;
      throw error;
    }
    next.ui = { ...state.ui, ...patch.ui };
  }

  writeState(next);
  state = next;
  return state;
}

export function stateInfo() {
  return {
    dir: STATE_DIR,
    file: STATE_FILE,
    revision: state.revision,
    updatedAt: state.updatedAt,
  };
}
