import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './store.js';

/**
 * Client MCP (Model Context Protocol) maison, sans dépendance.
 *  - transport "stdio" : process enfant + JSON-RPC délimité par des retours ligne
 *  - transport "http"  : Streamable HTTP (POST JSON-RPC, session id, SSE optionnel)
 * Expose tools/list et tools/call agrégés pour l'agent.
 */

const CONFIG_FILE = path.join(DATA_DIR, 'mcp.json');
const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'lime-ai', version: '1.0.3' };

let config = loadConfig();
const connections = new Map(); // serverId -> connection | {error}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.servers)) return raw.servers;
  } catch {
    /* fichier absent ou invalide */
  }
  return [];
}

export function saveConfig(servers) {
  const clean = (Array.isArray(servers) ? servers : []).map((server, index) => ({
    id: String(server.id || `mcp-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40),
    name: String(server.name || server.id || `Server ${index + 1}`).slice(0, 60),
    transport: server.transport === 'http' ? 'http' : 'stdio',
    command: String(server.command || '').trim(),
    args: Array.isArray(server.args) ? server.args.map(String) : String(server.args || '').split(/\s+/).filter(Boolean),
    env: server.env && typeof server.env === 'object' ? server.env : {},
    url: String(server.url || '').trim(),
    headers: server.headers && typeof server.headers === 'object' ? server.headers : {},
    enabled: server.enabled !== false,
  }));
  config = clean;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ servers: clean }, null, 2));
  closeAll();
  return clean;
}

export function getConfig() {
  return config;
}

class StdioConnection {
  constructor(server) {
    this.server = server;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = '';
    this.ready = false;
    this.status = 'idle';
  }

  async start() {
    const command = this.server.command;
    if (!command) throw new Error('Missing MCP command');
    this.child = spawn(command, this.server.args || [], {
      env: { ...process.env, ...(this.server.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.status = 'running';

    this.child.on('error', (error) => {
      this.status = 'error';
      this.stderr += `\n${error.message}`;
      this.failAll(new Error(`MCP ${this.server.name}: ${error.message}`));
    });

    this.child.on('exit', (code) => {
      this.status = code === 0 ? 'stopped' : `error (${code})`;
      this.ready = false;
      this.failAll(new Error(`MCP server ${this.server.name} stopped (code ${code})${this.stderr ? `: ${this.stderr.slice(-400)}` : ''}`));
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });

    this.child.stdout.on('data', (chunk) => this.onData(chunk));

    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false }, sampling: {} },
        clientInfo: CLIENT_INFO,
      },
      20000
    );
    this.notify('notifications/initialized', {});
    this.ready = true;
    return this;
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || `MCP error ${message.error.code}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) {
      // Requêtes serveur → client : on répond proprement.
      if (message.method === 'roots/list') {
        this.write({ jsonrpc: '2.0', id: message.id, result: { roots: [] } });
      } else if (message.method === 'ping') {
        this.write({ jsonrpc: '2.0', id: message.id, result: {} });
      } else {
        this.write({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Unsupported method: ${message.method}` },
        });
      }
    }
  }

  write(payload) {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  request(method, params, timeout = 30000) {
    if (!this.child) return Promise.reject(new Error('MCP server not started'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout (${method}) on ${this.server.name}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  failAll(error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.ready = false;
    try {
      this.child?.kill('SIGTERM');
      setTimeout(() => this.child?.kill('SIGKILL'), 1500).unref?.();
    } catch {
      /* ignore */
    }
  }
}

class HttpConnection {
  constructor(server) {
    this.server = server;
    this.sessionId = null;
    this.nextId = 1;
    this.ready = false;
  }

  async post(payload) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.server.headers || {}),
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const res = await fetch(this.server.url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const text = await res.text();
      const lines = text.split('\n').filter((line) => line.startsWith('data:'));
      for (const line of lines) {
        try {
          const message = JSON.parse(line.slice(5).trim());
          if (message.id === payload.id) return message;
        } catch {
          /* ignore */
        }
      }
      throw new Error('Empty MCP HTTP response');
    }
    return await res.json();
  }

  async start() {
    if (!this.server.url) throw new Error('Missing MCP URL');
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }).catch(() => {});
    this.ready = true;
    return result;
  }

  async request(method, params) {
    const id = this.nextId++;
    const message = await this.post({ jsonrpc: '2.0', id, method, params });
    if (message.error) throw new Error(message.error.message || 'MCP error');
    return message.result;
  }

  close() {
    this.ready = false;
    this.sessionId = null;
  }
}

async function connect(server) {
  const connection = server.transport === 'http' ? new HttpConnection(server) : new StdioConnection(server);
  await connection.start();
  return connection;
}

async function getConnection(server) {
  const existing = connections.get(server.id);
  if (existing instanceof StdioConnection) {
    if (existing.ready) return existing;
    existing.close();
    connections.delete(server.id);
  } else if (existing instanceof HttpConnection) {
    return existing;
  }
  const promise = connect(server).then(
    (connection) => {
      connections.set(server.id, connection);
      return connection;
    },
    (error) => {
      connections.set(server.id, { error: error.message, at: Date.now() });
      throw error;
    }
  );
  connections.set(server.id, { pendingStart: promise });
  const started = await promise;
  return started;
}

export function closeAll() {
  for (const [, connection] of connections) {
    if (connection && typeof connection.close === 'function') connection.close();
  }
  connections.clear();
}

/** Liste les outils de tous les serveurs activés. */
export async function listTools({ timeout = 12000 } = {}) {
  const tools = [];
  const servers = [];
  for (const server of config.filter((s) => s.enabled !== false)) {
    const entry = { id: server.id, name: server.name, transport: server.transport, status: 'ok', tools: [], error: '' };
    try {
      const connection = await Promise.race([
        getConnection(server),
        new Promise((_, reject) => setTimeout(() => reject(new Error('MCP connection timeout')), timeout)),
      ]);
      const result = await connection.request('tools/list', {});
      const list = Array.isArray(result?.tools) ? result.tools : [];
      entry.tools = list.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        schema: tool.inputSchema || tool.input_schema || null,
        qualified: `${server.id}.${tool.name}`,
      }));
      tools.push(...entry.tools.map((tool) => ({ ...tool, serverId: server.id, serverName: server.name })));
    } catch (error) {
      entry.status = 'error';
      entry.error = error.message;
    }
    servers.push(entry);
  }
  return { servers, tools };
}

export async function callTool(qualified, args = {}) {
  const dot = String(qualified).indexOf('.');
  if (dot === -1) throw new Error('Invalid MCP tool name (expected: server.tool)');
  const serverId = qualified.slice(0, dot);
  const toolName = qualified.slice(dot + 1);
  const server = config.find((s) => s.id === serverId);
  if (!server) throw new Error(`Unknown MCP server: ${serverId}`);
  if (server.enabled === false) throw new Error(`MCP server disabled: ${server.name}`);
  const connection = await getConnection(server);
  const result = await connection.request('tools/call', { name: toolName, arguments: args || {} }, 90000);
  return { server: server.name, tool: toolName, result: normalizeResult(result) };
}

function normalizeResult(result) {
  if (!result) return '';
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = [];
  for (const item of content) {
    if (item.type === 'text') parts.push(item.text);
    else if (item.type === 'image') parts.push(`[image ${item.mimeType || 'binary'} ${String(item.data || '').length} base64 bytes]`);
    else if (item.type === 'resource') parts.push(`[resource ${item.resource?.uri || ''}]`);
    else parts.push(JSON.stringify(item));
  }
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n').slice(0, 20000) || 'Empty result';
}

export async function testServer(server) {
  const connection = await connect(server);
  try {
    const result = await connection.request('tools/list', {});
    return { ok: true, tools: (result?.tools || []).map((t) => t.name) };
  } finally {
    connection.close();
  }
}

export function disconnectAll() {
  closeAll();
}
