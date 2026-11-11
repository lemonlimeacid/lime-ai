import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import { WebSocketServer } from 'ws';

import * as store from './store.js';
import * as userState from './state.js';
import { PROVIDER_PRESETS, listModels, enhancePrompt } from './providers.js';
import { runAgent } from './agent.js';
import { searchWeb } from './search.js';
import { createZip } from './zip.js';
import * as mcp from './mcp.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SHELL_DISABLED = process.env.SUPERNOVA_DISABLE_SHELL === '1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

/* ── Utilitaires ─────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

const CONSOLE_BRIDGE = `<script data-supernova-bridge>
(function () {
  function send(type, payload) {
    try { parent.postMessage({ __supernova: type, payload: payload }, '*'); } catch (error) {}
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (value) {
        try { return typeof value === 'string' ? value : JSON.stringify(value); }
        catch (error) { return String(value); }
      });
      send('console', { level: level, text: args.join(' ') });
      original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    send('error', { text: event.message + ' (' + (event.filename || 'inline') + ':' + (event.lineno || 0) + ')' });
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('error', { text: 'Promise rejetée : ' + (event.reason && event.reason.message ? event.reason.message : String(event.reason)) });
  });
  send('ready', { url: location.pathname });
})();
</script>`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/* ── API système ─────────────────────────────────────────────────────────── */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0', uptime: process.uptime() });
});

app.get('/api/config', (req, res) => {
  res.json({
    app: 'Supernova IA',
    version: '1.0.0',
    shellEnabled: !SHELL_DISABLED,
    workspacesDir: store.WORKSPACES_DIR,
    dataDir: store.DATA_DIR,
    cloudDir: store.CLOUD_DIR,
    stateDir: userState.STATE_DIR,
    providers: PROVIDER_PRESETS,
    mcpServers: mcp.getConfig(),
    formats: ['OpenAI compatible', 'Anthropic', 'Google Gemini', 'Ollama', 'LM Studio', 'vLLM'],
  });
});

/* ── Sauvegarde locale (réglages, conversations, préférences) ───────────── */

app.get('/api/state', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(userState.getState());
});

const saveUserState = (req, res, next) => {
  try {
    res.json(userState.saveState(req.body || {}));
  } catch (error) {
    next(error);
  }
};

app.put('/api/state', saveUserState);
app.post('/api/state', saveUserState); // navigator.sendBeacon / fermeture d'onglet

/* ── Projets ─────────────────────────────────────────────────────────────── */

app.get('/api/projects', (req, res) => {
  res.json({ projects: store.listProjects(), stats: store.stats() });
});

app.post('/api/projects', (req, res, next) => {
  try {
    const { name, mode, rootDir } = req.body || {};
    const project = store.createProject({ name, mode, rootDir });
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id', (req, res, next) => {
  try {
    const project = store.requireProject(req.params.id);
    const { files, tree } = store.fileTree(project.id);
    res.json({ project, files, tree });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/projects/:id', (req, res, next) => {
  try {
    res.json({ project: store.updateProject(req.params.id, req.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id', (req, res, next) => {
  try {
    store.deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/duplicate-web', (req, res, next) => {
  try {
    const copy = store.duplicateAsCloud(req.params.id, req.body?.name);
    res.status(201).json({ project: copy });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/files', (req, res, next) => {
  try {
    const { files, tree } = store.fileTree(req.params.id);
    res.json({ files, tree });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/file', (req, res, next) => {
  try {
    const filePath = String(req.query.path || '');
    const content = store.readFile(req.params.id, filePath);
    res.json({ path: filePath, content });
  } catch (error) {
    next(error);
  }
});

app.put('/api/projects/:id/file', (req, res, next) => {
  try {
    const { path: filePath, content } = req.body || {};
    const info = store.writeFile(req.params.id, filePath, content ?? '');
    res.json({ ok: true, file: info });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id/file', (req, res, next) => {
  try {
    store.deleteFile(req.params.id, String(req.query.path || ''));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/rename', (req, res, next) => {
  try {
    const { from, to } = req.body || {};
    res.json(store.renameFile(req.params.id, from, to));
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/zip', (req, res, next) => {
  try {
    const project = store.requireProject(req.params.id);
    const files = store.listFiles(project.id, { withContent: true });
    if (!files.length) {
      return res.status(400).json({ error: 'Projet vide : rien à exporter.' });
    }
    const zip = createZip(files.map((file) => ({ path: file.path, data: file.content })));
    const filename = `${store.slugify(project.name)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', zip.length);
    res.end(zip);
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/import', (req, res, next) => {
  try {
    const files = asArray(req.body?.files);
    if (!files.length) return res.status(400).json({ error: 'Aucun fichier fourni.' });
    let written = 0;
    for (const file of files) {
      if (!file?.path) continue;
      store.writeFile(req.params.id, file.path, String(file.content ?? ''));
      written++;
    }
    res.json({ ok: true, written });
  } catch (error) {
    next(error);
  }
});

/* ── Chat / agent ────────────────────────────────────────────────────────── */

const runs = new Map();

app.post('/api/chat', async (req, res) => {
  const { projectId, messages, settings = {} } = req.body || {};

  if (!projectId) return res.status(400).json({ error: 'projectId manquant' });
  if (!store.getProject(projectId)) return res.status(404).json({ error: 'Projet introuvable' });
  if (!asArray(messages).length) return res.status(400).json({ error: 'messages manquants' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const runId = crypto.randomUUID();
  const controller = new AbortController();
  const pending = new Map();
  runs.set(runId, { controller, pending, createdAt: Date.now() });

  const emit = (event) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client parti */
    }
  };

  const requestApproval = (kind, payload) =>
    new Promise((resolve) => {
      const callId = crypto.randomUUID();
      emit({ type: 'approval_request', callId, kind, payload });
      pending.set(callId, resolve);
      setTimeout(() => {
        if (pending.has(callId)) {
          pending.delete(callId);
          resolve(false);
          emit({ type: 'approval_timeout', callId });
        }
      }, 120000);
    });

  emit({ type: 'run_started', runId });
  emit({ type: 'mode', mode: store.getProject(projectId)?.mode || 'pc' });

  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  try {
    const summary = await runAgent({
      projectId,
      messages,
      settings,
      emit,
      signal: controller.signal,
      requestApproval,
    });
    emit({ type: 'done', summary: String(summary || '').slice(0, 8000) });
  } catch (error) {
    if (error.name === 'AbortError') emit({ type: 'cancelled' });
    else emit({ type: 'error', message: error.message || 'Erreur inconnue' });
  } finally {
    runs.delete(runId);
    res.removeListener('close', onClose);
    if (!res.writableEnded) res.end();
  }
});

app.post('/api/agent/:runId/approve', (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Exécution inconnue ou terminée.' });
  const { callId, approved } = req.body || {};
  const resolve = run.pending.get(callId);
  if (!resolve) return res.status(404).json({ error: 'Demande inconnue.' });
  run.pending.delete(callId);
  resolve(Boolean(approved));
  res.json({ ok: true });
});

app.post('/api/agent/:runId/cancel', (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Exécution inconnue.' });
  run.controller.abort();
  res.json({ ok: true });
});

/* ── Modèles, recherche, prompt ──────────────────────────────────────────── */

app.post('/api/models', async (req, res) => {
  try {
    const { provider, baseUrl, apiKey } = req.body || {};
    const models = await listModels({ provider, baseUrl, apiKey });
    res.json({ models });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const result = await searchWeb(req.body?.query || '', { limit: Number(req.body?.limit) || 5 });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/enhance', async (req, res) => {
  try {
    const { prompt, settings = {} } = req.body || {};
    if (!String(prompt || '').trim()) return res.status(400).json({ error: 'Prompt vide' });
    const enhanced = await enhancePrompt({
      prompt,
      provider: settings.provider,
      model: settings.model,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
    });
    res.json({ prompt: enhanced });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/* ── MCP ─────────────────────────────────────────────────────────────────── */

app.get('/api/mcp/servers', async (req, res) => {
  const config = mcp.getConfig();
  let tools = [];
  let servers = [];
  if (req.query.discover !== '0') {
    try {
      const discovered = await mcp.listTools({ timeout: 7000 });
      tools = discovered.tools;
      servers = discovered.servers;
    } catch (error) {
      servers = config.map((server) => ({ ...server, status: 'error', error: error.message, tools: [] }));
    }
  }
  res.json({ servers, config, tools });
});

app.put('/api/mcp/servers', (req, res) => {
  try {
    const servers = mcp.saveConfig(req.body?.servers);
    res.json({ ok: true, servers });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/mcp/tools', async (req, res) => {
  try {
    res.json(await mcp.listTools({ timeout: 9000 }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/mcp/test', async (req, res) => {
  try {
    const server = req.body?.server;
    if (!server) return res.status(400).json({ error: 'Serveur manquant' });
    const result = await mcp.testServer({
      id: server.id || 'test',
      name: server.name || 'test',
      transport: server.transport === 'http' ? 'http' : 'stdio',
      command: String(server.command || '').trim(),
      args: asArray(server.args),
      env: server.env || {},
      url: String(server.url || '').trim(),
      headers: server.headers || {},
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/* ── Aperçu live ─────────────────────────────────────────────────────────── */

function serveProjectFile(req, res, relPath = '') {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).type('html').send('<h1>Projet introuvable</h1>');

  const rel = String(relPath || '').trim();
  if (!rel || rel.endsWith('/')) {
    for (const candidate of [`${rel}index.html`, 'index.html']) {
      try {
        return sendPreview(res, req, project, candidate, store.readFile(project.id, candidate));
      } catch {
        /* essaie le candidat suivant */
      }
    }
    return res
      .status(404)
      .type('html')
      .send(missingPage(project, 'Aucun fichier index.html : demande à Supernova de créer une page.'));
  }

  try {
    return sendPreview(res, req, project, rel, store.readFile(project.id, rel));
  } catch {
    try {
      const nested = `${rel}/index.html`;
      return sendPreview(res, req, project, nested, store.readFile(project.id, nested));
    } catch {
      return res.status(404).type('html').send(missingPage(project, `Fichier introuvable : ${rel}`));
    }
  }
}

app.get(['/preview/:id', '/preview/:id/'], (req, res) => serveProjectFile(req, res, ''));
app.get('/preview/:id/*', (req, res) => serveProjectFile(req, res, req.params[0]));

function sendPreview(res, req, project, rel, content) {
  const ext = path.extname(rel).toLowerCase();
  res.setHeader('Cache-Control', 'no-store');
  if (ext === '.html' || ext === '.htm' || !ext) {
    let html = content;
    const base = `<base href="/preview/${project.id}/">`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n${base}\n${CONSOLE_BRIDGE}`);
    } else {
      html = `${base}\n${CONSOLE_BRIDGE}\n${html}`;
    }
    return res.type('html').send(html);
  }
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  return res.send(content);
}

function missingPage(project, message) {
  const files = store
    .listFiles(project.id)
    .map((file) => `<li>${file.path}</li>`)
    .join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Aperçu — ${project.name}</title>
<style>body{font-family:system-ui;background:#0a0c16;color:#e6eaf7;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
main{max-width:560px;background:#111527;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:28px}
h1{font-size:1.3rem;margin:0 0 8px}p{color:#98a3c2;font-size:14px}ul{color:#98a3c2;font-size:13px;max-height:220px;overflow:auto}
code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>Aperçu en attente</h1><p>${message}</p>
<p>Les fichiers du projet :</p><ul>${files || '<li><em>projet vide</em></li>'}</ul></main></body></html>`;
}

/* ── Front statique ──────────────────────────────────────────────────────── */

app.use(express.static(path.join(store.APP_ROOT, 'public'), { index: 'index.html', extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue' });
  res.status(404).type('html').send('<h1>404</h1><p><a href="/">Retour à Supernova IA</a></p>');
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  if (status >= 500) console.error('[supernova]', error);
  res.status(status).json({ error: error.message || 'Erreur serveur' });
});

/* ── Serveur + terminal WebSocket ────────────────────────────────────────── */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost');
  const projectId = url.searchParams.get('projectId') || '';
  let child = null;

  const send = (payload) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };

  send({ type: 'ready', shellEnabled: !SHELL_DISABLED, projectId });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'kill') {
      if (child) child.kill('SIGTERM');
      return;
    }

    if (message.type === 'ping') {
      send({ type: 'pong' });
      return;
    }

    if (message.type !== 'run') return;
    if (SHELL_DISABLED) {
      send({ type: 'output', stream: 'stderr', text: 'Exécution shell désactivée (SUPERNOVA_DISABLE_SHELL=1).\n' });
      send({ type: 'exit', code: 1 });
      return;
    }
    if (child) child.kill('SIGTERM');

    const command = String(message.command || '').trim();
    if (!command) return;

    let cwd;
    try {
      cwd = store.ensureShellDir(projectId);
    } catch (error) {
      send({ type: 'output', stream: 'stderr', text: `${error.message}\n` });
      send({ type: 'exit', code: 1 });
      return;
    }

    send({ type: 'start', command, cwd });
    const shell = process.platform === 'win32'
      ? { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
      : { bin: process.env.SHELL || '/bin/sh', args: ['-lc', command] };
    child = spawn(shell.bin, shell.args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' },
    });

    const timer = setTimeout(() => {
      child?.kill('SIGKILL');
      send({ type: 'output', stream: 'stderr', text: '\n[Supernova] Commande interrompue après 5 minutes.\n' });
    }, 300000);

    child.stdout.on('data', (data) => send({ type: 'output', stream: 'stdout', text: data.toString() }));
    child.stderr.on('data', (data) => send({ type: 'output', stream: 'stderr', text: data.toString() }));
    child.on('error', (error) => send({ type: 'output', stream: 'stderr', text: `${error.message}\n` }));
    child.on('close', (code) => {
      clearTimeout(timer);
      send({ type: 'exit', code: code ?? 0 });
      child = null;
    });
  });

  socket.on('close', () => {
    if (child) child.kill('SIGTERM');
  });
});

server.listen(PORT, HOST, () => {
  const display = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('  ✦ Supernova IA');
  console.log(`  → http://${display}:${PORT}`);
  console.log(`  projets PC : ${store.WORKSPACES_DIR}`);
  console.log(`  cloud      : ${store.CLOUD_DIR}`);
  console.log(`  données    : ${store.DATA_DIR}`);
  console.log(`  sauvegarde : ${userState.STATE_FILE}`);
  console.log(`  shell      : ${SHELL_DISABLED ? 'désactivé' : 'activé'}`);
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    mcp.disconnectAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
