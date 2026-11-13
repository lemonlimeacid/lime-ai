import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Stockage des projets.
 *  - mode "pc"    : un vrai dossier est créé sur la machine (rootDir).
 *  - mode "cloud" : un dossier interne à Lime AI (data/cloud/<nom>-<id>),
 *                   invisible dans l'interface et exportable en ZIP.
 * Les anciens projets "web" (virtual.json) sont migrés vers data/cloud au démarrage.
 */

export const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA_DIR = process.env.LIME_DATA
  ? path.resolve(process.env.LIME_DATA)
  : path.join(APP_ROOT, 'data');
export const WORKSPACES_DIR = process.env.LIME_WORKSPACES
  ? path.resolve(process.env.LIME_WORKSPACES)
  : path.join(APP_ROOT, 'workspaces');
export const CLOUD_DIR = path.join(DATA_DIR, 'cloud');

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const VIRTUAL_FILE = path.join(DATA_DIR, 'virtual.json');

const IGNORED = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.venv', '__pycache__']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 4000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
fs.mkdirSync(CLOUD_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

let projects = readJson(PROJECTS_FILE, []);
if (!Array.isArray(projects)) projects = [];
const virtualFiles = readJson(VIRTUAL_FILE, {});

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
      fs.writeFileSync(VIRTUAL_FILE, JSON.stringify(virtualFiles));
    } catch (error) {
      console.error('[store] save failed:', error.message);
    }
  }, 250);
}

/** Migration silencieuse des anciens projets "web" vers data/cloud. */
function migrateLegacyWebProjects() {
  let changed = false;
  for (const project of projects) {
    if (project.mode !== 'web') continue;
    project.mode = 'cloud';
    project.rootDir = null;
    const dir = cloudDirFor(project);
    fs.mkdirSync(dir, { recursive: true });
    const bag = virtualFiles[project.id] || {};
    for (const [rel, content] of Object.entries(bag)) {
      try {
        const abs = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(content ?? ''), 'utf8');
      } catch (error) {
        console.error('[store] cloud migration:', error.message);
      }
    }
    delete virtualFiles[project.id];
    changed = true;
  }
  if (changed) persist();
}

migrateLegacyWebProjects();

export function slugify(input) {
  return String(input || 'project')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

/** Dossier Cloud interne, stable même si le projet est renommé. */
export function cloudDirFor(project) {
  return path.join(CLOUD_DIR, project.id);
}

function projectRoot(project) {
  return project.mode === 'cloud' ? cloudDirFor(project) : project.rootDir;
}

function normalizeMode(mode) {
  return mode === 'cloud' || mode === 'web' ? 'cloud' : 'pc';
}

function newId() {
  return crypto.randomBytes(9).toString('hex');
}

function relativeInside(root, target) {
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return rel.split(path.sep).join('/');
}

function resolveSafe(root, relPath) {
  const cleaned = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\0/g, '');
  const target = path.resolve(root, cleaned);
  const rel = relativeInside(root, target);
  if (!rel) {
    const error = new Error('Invalid path');
    error.status = 400;
    throw error;
  }
  return { abs: target, rel };
}

/* ── Projets ─────────────────────────────────────────────────────────────── */

export function listProjects() {
  return [...projects]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((p) => ({ ...p, fileCount: countFiles(p) }));
}

export function getProject(id) {
  return projects.find((p) => p.id === id) || null;
}

export function requireProject(id) {
  const project = getProject(id);
  if (!project) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }
  return project;
}

function countFiles(project) {
  try {
    return listFiles(project.id).length;
  } catch {
    return 0;
  }
}

/**
 * Prochain dossier automatique : « Project - N ».
 * N suit le plus grand des deux nombres : projets existants ou derniers
 * dossiers « Project - N » déjà présents, puis +1 (sans jamais réutiliser).
 */
function nextProjectFolder() {
  let highest = 0;
  try {
    for (const entry of fs.readdirSync(WORKSPACES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^Project\s*-\s*(\d+)$/i);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  } catch (error) {
    console.error('[store] reading workspace folder:', error.message);
  }

  let n = Math.max(projects.length, highest) + 1;
  let dir = path.join(WORKSPACES_DIR, `Project - ${n}`);
  while (fs.existsSync(dir)) {
    n += 1;
    dir = path.join(WORKSPACES_DIR, `Project - ${n}`);
  }
  return dir;
}

export function createProject({ name, mode = 'pc', rootDir = '' } = {}) {
  const id = newId();
  const cleanName = String(name || '').trim() || 'New project';
  const project = {
    id,
    name: cleanName,
    mode: normalizeMode(mode),
    rootDir: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (project.mode === 'pc') {
    let dir;
    if (rootDir) {
      dir = path.resolve(rootDir);
      fs.mkdirSync(dir, { recursive: true });
    } else {
      // Aucun dossier choisi : on crée « Project - N » dans le dossier de travail.
      dir = nextProjectFolder();
      fs.mkdirSync(dir, { recursive: true });
    }
    project.rootDir = dir;
  } else {
    // Cloud : dossier interne, créé immédiatement pour que les écritures soient disque.
    fs.mkdirSync(cloudDirFor(project), { recursive: true });
  }

  projects.push(project);
  persist();
  return project;
}

export function updateProject(id, patch = {}) {
  const project = requireProject(id);
  if (typeof patch.name === 'string' && patch.name.trim()) project.name = patch.name.trim().slice(0, 120);
  if (patch.mode === 'pc' || patch.mode === 'cloud' || patch.mode === 'web') project.mode = normalizeMode(patch.mode);
  project.updatedAt = new Date().toISOString();
  persist();
  return project;
}

export function deleteProject(id) {
  const project = requireProject(id);
  projects = projects.filter((p) => p.id !== id);
  delete virtualFiles[id];
  if (project.mode === 'cloud') {
    const dir = cloudDirFor(project);
    if (relativeInside(CLOUD_DIR, dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        console.error('[store] cloud deletion:', error.message);
      }
    }
  } else if (project.mode === 'pc' && project.rootDir) {
    // On ne supprime que les dossiers créés dans le dossier de travail de l'app.
    const inside = relativeInside(WORKSPACES_DIR, project.rootDir);
    if (inside) {
      try {
        fs.rmSync(project.rootDir, { recursive: true, force: true });
      } catch (error) {
        console.error('[store] folder deletion:', error.message);
      }
    }
  }
  persist();
  return true;
}

export function duplicateAsCloud(id, name) {
  const source = requireProject(id);
  const copy = createProject({ name: name || `${source.name} (cloud)`, mode: 'cloud' });
  for (const file of listFiles(source.id, { withContent: true })) {
    writeFile(copy.id, file.path, file.content);
  }
  return copy;
}

export function touch(id) {
  const project = getProject(id);
  if (project) {
    project.updatedAt = new Date().toISOString();
    persist();
  }
}

/* ── Fichiers ────────────────────────────────────────────────────────────── */

function walkDisk(root, dir, out, depth = 0) {
  if (out.length >= MAX_ENTRIES || depth > 14) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return;
    if (IGNORED.has(entry.name) || entry.name === '.DS_Store') continue;
    const abs = path.join(dir, entry.name);
    const rel = relativeInside(root, abs);
    if (!rel) continue;
    if (entry.isDirectory()) {
      walkDisk(root, abs, out, depth + 1);
    } else if (entry.isFile()) {
      let stat = null;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES * 4) continue;
      out.push({ path: rel, size: stat.size, updatedAt: stat.mtime.toISOString() });
    }
  }
}

export function listFiles(id, { withContent = false } = {}) {
  const project = requireProject(id);
  const root = projectRoot(project);
  let files = [];
  if (root) walkDisk(root, root, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (withContent) {
    files = files.map((file) => {
      try {
        return { ...file, content: readFile(id, file.path) };
      } catch {
        return { ...file, content: '' };
      }
    });
  }
  return files;
}

export function fileTree(id) {
  const files = listFiles(id);
  const root = { name: '', path: '', type: 'dir', children: [] };
  const dirs = new Map([['', root]]);
  const ensureDir = (dirPath) => {
    if (dirs.has(dirPath)) return dirs.get(dirPath);
    const parts = dirPath.split('/');
    const name = parts.pop();
    const parentPath = parts.join('/');
    const parent = ensureDir(parentPath);
    const node = { name, path: dirPath, type: 'dir', children: [] };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  };
  for (const file of files) {
    const parts = file.path.split('/');
    const name = parts.pop();
    const dirPath = parts.join('/');
    const parent = ensureDir(dirPath);
    parent.children.push({ name, path: file.path, type: 'file', size: file.size });
  }
  const sortNodes = (node) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.filter((c) => c.type === 'dir').forEach(sortNodes);
  };
  sortNodes(root);
  return { files, tree: root.children };
}

export function readFile(id, relPath) {
  const project = requireProject(id);
  const { rel, abs } = resolveSafe(projectRoot(project), relPath);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      const notFound = new Error(`File not found: ${rel}`);
      notFound.status = 404;
      throw notFound;
    }
    throw error;
  }
}

export function writeFile(id, relPath, content) {
  const project = requireProject(id);
  if (typeof content !== 'string') content = String(content ?? '');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES * 2) {
    throw new Error('File too large (4 MB max)');
  }
  const { rel, abs } = resolveSafe(projectRoot(project), relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  touch(id);
  return { path: rel, size: Buffer.byteLength(content, 'utf8') };
}

export function deleteFile(id, relPath) {
  const project = requireProject(id);
  const { abs } = resolveSafe(projectRoot(project), relPath);
  try {
    fs.rmSync(abs, { recursive: true, force: true });
  } catch (error) {
    console.error('[store] file deletion:', error.message);
  }
  touch(id);
  return true;
}

export function renameFile(id, from, to) {
  const project = requireProject(id);
  const root = projectRoot(project);
  const src = resolveSafe(root, from);
  const dst = resolveSafe(root, to);
  fs.mkdirSync(path.dirname(dst.abs), { recursive: true });
  fs.renameSync(src.abs, dst.abs);
  touch(id);
  return { from: src.rel, to: dst.rel };
}

export function projectDir(id) {
  const project = requireProject(id);
  return projectRoot(project);
}

/** Dossier d'exécution shell : le dossier réel du projet (PC ou Cloud). */
export function ensureShellDir(id) {
  const project = requireProject(id);
  const dir = projectRoot(project);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Arborescence texte compacte pour le prompt système. */
export function projectOutline(id, limit = 200) {
  const files = listFiles(id).slice(0, limit);
  if (!files.length) return '(empty project)';
  return files.map((f) => `${f.path} (${f.size} B)`).join('\n');
}

export function projectSnapshot(id, maxBytes = 60000) {
  const files = listFiles(id, { withContent: true });
  const out = [];
  let total = 0;
  for (const file of files) {
    if (total > maxBytes) break;
    const chunk = `\n--- ${file.path} ---\n${file.content}`;
    total += chunk.length;
    out.push(chunk);
  }
  return out.join('');
}

export function readAllFiles(id) {
  return listFiles(id, { withContent: true });
}

export function stats() {
  return {
    projects: projects.length,
    workspacesDir: WORKSPACES_DIR,
    dataDir: DATA_DIR,
    cloudDir: CLOUD_DIR,
  };
}
