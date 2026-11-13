import * as store from './store.js';

/**
 * Passerelle GitHub minimale.
 *
 * L'application est locale : le jeton personnel est fourni par le client à
 * chaque appel, utilise l'API REST GitHub et n'est jamais journalisé ni renvoyé.
 * Aucun jeton n'est stocké dans ce module.
 */

const GITHUB_API = 'https://api.github.com';
const MAX_FILES = 800;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function githubError(status, data) {
  const detail = data?.message || data?.error || '';
  const hints = {
    401: 'GitHub token is invalid or expired.',
    403: 'Insufficient permissions or GitHub rate limit reached.',
    404: 'Repository not found or inaccessible.',
    422: 'GitHub rejected this operation.',
  };
  const message = `${hints[status] || `GitHub responded ${status}.`}${detail ? ` — ${detail}` : ''}`;
  const error = new Error(message);
  error.status = status === 401 ? 401 : status === 403 ? 403 : status === 404 ? 404 : status === 422 ? 422 : 502;
  return error;
}

function tokenFrom(value) {
  const token = String(value || '').trim();
  if (token.length < 8) {
    const error = new Error('GitHub token is missing or too short.');
    error.status = 400;
    throw error;
  }
  return token;
}

async function gh(token, endpoint, { method = 'GET', body } = {}) {
  // Valide le jeton avant le bloc réseau : une erreur de jeton doit rester un 400,
  // pas être transformée en « connexion à GitHub impossible » (502).
  const authToken = tokenFrom(token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(`${GITHUB_API}${endpoint}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${authToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Lime-AI',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      const timeout = new Error('GitHub is taking too long to respond.');
      timeout.status = 504;
      throw timeout;
    }
    const network = new Error(`Unable to connect to GitHub: ${error.message}`);
    network.status = 502;
    throw network;
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) throw githubError(response.status, data);
  return data;
}

function splitRepo(fullName) {
  const match = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/.exec(String(fullName || '').trim());
  if (!match) {
    const error = new Error('Invalid GitHub repository (expected owner/repo format).');
    error.status = 400;
    throw error;
  }
  return { owner: match[1], repo: match[2] };
}

function normalizeRepo(repo) {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login || '',
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch || 'main',
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
    permissions: repo.permissions || {},
  };
}

function slugRepoName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export async function connect(token) {
  const user = await gh(token, '/user');
  return {
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url || '',
    htmlUrl: user.html_url || '',
  };
}

export async function listRepos(token) {
  const repos = await gh(
    token,
    '/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100'
  );
  return (Array.isArray(repos) ? repos : [])
    .filter((repo) => repo?.permissions?.push || repo?.permissions?.admin)
    .map(normalizeRepo);
}

export async function createRepo(token, { name, private: isPrivate = true } = {}) {
  const repoName = slugRepoName(name);
  if (!repoName) {
    const error = new Error('Invalid repository name.');
    error.status = 400;
    throw error;
  }
  const repo = await gh(token, '/user/repos', {
    method: 'POST',
    body: {
      name: repoName,
      private: Boolean(isPrivate),
      auto_init: true,
      description: 'Project created with Lime AI',
    },
  });
  return normalizeRepo(repo);
}

function isUsableTextFile(file) {
  if (!file?.path || typeof file.content !== 'string') return false;
  if (Buffer.byteLength(file.content, 'utf8') > MAX_FILE_BYTES) return false;
  return !file.content.includes('\u0000');
}

export async function pushProject(token, { projectId, repo: repoName, message } = {}) {
  const project = store.requireProject(projectId);
  const files = store.listFiles(project.id, { withContent: true })
    .filter(isUsableTextFile)
    .slice(0, MAX_FILES);

  if (!files.length) {
    const error = new Error('The project has no publishable text files.');
    error.status = 400;
    throw error;
  }

  const { owner, repo: name } = splitRepo(repoName);
  const repo = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  const branch = repo.default_branch || 'main';

  let parentSha = null;
  let baseTree = null;
  try {
    const ref = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodeURIComponent(branch)}`);
    parentSha = ref?.object?.sha || null;
    if (parentSha) {
      const parent = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits/${parentSha}`);
      baseTree = parent?.tree?.sha || null;
    }
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const entries = [];
  for (let index = 0; index < files.length; index += 5) {
    const batch = files.slice(index, index + 5);
    const blobs = await Promise.all(batch.map((file) => (
      gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs`, {
        method: 'POST',
        body: { content: file.content, encoding: 'utf-8' },
      })
    )));
    batch.forEach((file, offset) => {
      entries.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobs[offset].sha,
      });
    });
  }

  const tree = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees`, {
    method: 'POST',
    body: {
      tree: entries,
      ...(baseTree ? { base_tree: baseTree } : {}),
    },
  });

  const commit = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits`, {
    method: 'POST',
    body: {
      message: String(message || `${project.name} — Lime AI update`).slice(0, 500),
      tree: tree.sha,
      ...(parentSha ? { parents: [parentSha] } : {}),
    },
  });

  if (parentSha) {
    await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    });
  } else {
    await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  }

  return {
    repo: `${owner}/${name}`,
    branch,
    commitSha: commit.sha,
    commitUrl: `${repo.html_url}/commit/${commit.sha}`,
    files: entries.length,
    skipped: store.listFiles(project.id, { withContent: true }).length - entries.length,
  };
}
