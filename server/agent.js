import { spawn } from 'node:child_process';
import * as store from './store.js';
import { streamChat } from './providers.js';
import { listTools, callTool } from './mcp.js';

/**
 * Boucle d'agent : prompt système + streaming + exécution des actions.
 * Protocole texte (compatible avec TOUS les modèles, même sans function calling) :
 *   <file path="index.html">…</file>
 *   <delete path="vieux.css"/>
 *   <shell>npm install</shell>
 *   <mcp tool="serveur.outil">{"arg":1}</mcp>
 */

const OPEN_TAG = /<(file|delete|shell|mcp)\b([^>]*)>/i;

function parseAttrs(source) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(String(source || '')))) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return attrs;
}

class ProtocolParser {
  constructor() {
    this.buf = '';
    this.scan = 0;
    this.block = null;
  }

  push(chunk) {
    this.buf += chunk;
    return this.step(false);
  }

  end() {
    return this.step(true);
  }

  safeTextEnd() {
    // Une balise peut être longue (attributs) et arriver coupée entre deux chunks :
    // tant qu'on n'a pas vu son '>', on retient tout ce qui suit le dernier '<'.
    const tail = this.buf.slice(this.scan);
    const lt = tail.lastIndexOf('<');
    if (lt === -1) return this.buf.length;
    if (tail.slice(lt).includes('>')) return this.buf.length;
    return this.scan + lt;
  }

  step(final) {
    const events = [];
    for (let guard = 0; guard < 500; guard++) {
      if (this.block) {
        const close = `</${this.block.type}>`;
        // On cherche depuis le début du contenu : `sentTo` ne sert qu'à
        // n'émettre chaque morceau de contenu qu'une seule fois.
        const index = this.buf.indexOf(close, this.block.contentStart);
        if (index === -1) {
          if (final) {
            const content = this.buf.slice(this.block.contentStart);
            events.push({ kind: 'end', block: this.block, content });
            this.block = null;
            this.scan = this.buf.length;
          } else {
            let safe = this.buf.length;
            if (this.block.type === 'file') {
              safe = Math.max(this.block.contentStart, this.buf.length - (close.length - 1));
            }
            if (safe > this.block.sentTo) {
              events.push({ kind: 'chunk', block: this.block, text: this.buf.slice(this.block.sentTo, safe) });
              this.block.sentTo = safe;
            }
          }
          break;
        }
        const content = this.buf.slice(this.block.contentStart, index);
        events.push({ kind: 'end', block: this.block, content });
        this.block = null;
        this.scan = index + close.length;
        continue;
      }

      const rest = this.buf.slice(this.scan);
      const match = rest.match(OPEN_TAG);
      if (!match) {
        const safeEnd = final ? this.buf.length : this.safeTextEnd();
        if (safeEnd > this.scan) {
          events.push({ kind: 'text', text: this.buf.slice(this.scan, safeEnd) });
          this.scan = safeEnd;
        }
        break;
      }

      const tagStart = this.scan + match.index;
      if (tagStart > this.scan) events.push({ kind: 'text', text: this.buf.slice(this.scan, tagStart) });

      const openEnd = tagStart + match[0].length;
      const type = match[1].toLowerCase();
      const attrs = parseAttrs(match[2] || '');

      if (type === 'delete') {
        events.push({ kind: 'block', type, attrs, content: '' });
        this.scan = openEnd;
        continue;
      }

      this.block = { type, attrs, contentStart: openEnd, sentTo: openEnd };
      this.scan = openEnd;
      events.push({ kind: 'start', block: this.block });
    }
    return events;
  }
}

function cleanContent(content) {
  return String(content || '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

export function buildSystemPrompt({ project, settings = {}, tools = [] }) {
  const mode = project?.mode === 'cloud'
    ? 'CLOUD (Supernova AI internal storage, ZIP export, folder hidden from the user)'
    : 'PC (direct writes to a folder on the machine)';
  const outline = project ? store.projectOutline(project.id, 160) : '(no project)';
  const toolList = tools.length
    ? tools
        .map((tool) => {
          const schema = tool.schema ? ` — schema: ${JSON.stringify(tool.schema).slice(0, 400)}` : '';
          return `- \`${tool.serverId}.${tool.name}\` : ${tool.description || 'no description'}${schema}`;
        })
        .join('\n')
    : '(no MCP server connected)';

  const custom = String(settings.systemPrompt || '').trim();

  return `You are **Supernova AI**, an autonomous software development agent working in a local project.
You combine the rigor of a coding agent (project reading, file writing, command execution, MCP tools) with the speed of an app generator with a live preview.

Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Response language: ${settings.language || 'English'}
Project mode: ${mode}
Project name: ${project?.name || '—'}
Folder / workspace: ${project?.mode === 'cloud' ? '(Supernova internal cloud)' : project?.rootDir || '—'}

Current file tree:
${outline}

Available MCP tools:
${toolList}

## Action protocol (REQUIRED)
To act, use ONLY these tags. Everything else is text shown to the user.

<file path="relative/path.ext">
COMPLETE file content
</file>

<delete path="relative/path.ext"/>

<shell>shell command</shell>

<mcp tool="server.tool">{"argument": "value"}</mcp>

Rules:
- Always write the **entire** file (never “…” or a partial diff).
- Relative paths, no \`..\`, no absolute paths. Create subfolders implicitly.
- One <file> block per file; multiple files = multiple blocks.
- Use <shell> to install, build, or test. Commands run at the project root; wait for the result before concluding.
- Only call an MCP tool if it is listed above, with arguments matching the schema.
- Keep text concise: one sentence of intent, then the blocks, then a 2–4 bullet summary.
- If the user asks for a targeted change, rewrite only the affected files.
- Do not put Markdown fences inside <file> blocks.
- If information is missing, make a reasonable assumption and state it.
- For a simple web project, do not add dependencies: HTML/CSS/JS is enough and the preview is instant.
${custom ? `\n## Additional user instructions\n${custom}` : ''}`;
}

/* ── Exécution shell ─────────────────────────────────────────────────────── */

const SHELL_DISABLED = process.env.SUPERNOVA_DISABLE_SHELL === '1';

function runShell({ command, cwd, emit, signal, timeout = 180000 }) {
  return new Promise((resolve) => {
    if (SHELL_DISABLED) {
      emit({ type: 'shell_end', code: 1, output: 'Shell execution disabled (SUPERNOVA_DISABLE_SHELL=1).' });
      resolve({ code: 1, output: 'shell disabled' });
      return;
    }
    const shell = process.platform === 'win32'
      ? { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
      : { bin: process.env.SHELL || '/bin/sh', args: ['-lc', command] };
    let output = '';
    let finished = false;
    let child;
    try {
      child = spawn(shell.bin, shell.args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' },
      });
    } catch (error) {
      emit({ type: 'shell_end', code: 1, output: error.message });
      resolve({ code: 1, output: error.message });
      return;
    }

    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      emit({ type: 'shell_end', code, output: output.slice(-20000) });
      resolve({ code, output });
    };

    const timer = setTimeout(() => {
      output += '\n[Supernova] Timed out, command interrupted.';
      child.kill('SIGKILL');
      finish(124);
    }, timeout);

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(130);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      emit({ type: 'shell_output', stream: 'stdout', text });
    });
    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      emit({ type: 'shell_output', stream: 'stderr', text });
    });
    child.on('error', (error) => {
      output += error.message;
      finish(1);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      finish(code ?? 0);
    });
  });
}

/* ── Boucle principale ───────────────────────────────────────────────────── */

export async function runAgent({ projectId, messages, settings = {}, emit, signal, requestApproval }) {
  const project = store.requireProject(projectId);

  let tools = [];
  let mcpServers = [];
  try {
    const discovered = await listTools({ timeout: 8000 });
    tools = discovered.tools;
    mcpServers = discovered.servers;
    if (mcpServers.length) emit({ type: 'mcp_status', servers: mcpServers });
  } catch (error) {
    emit({ type: 'mcp_status', servers: [], error: error.message });
  }

  const system = buildSystemPrompt({ project, settings, tools });
  const history = (messages || [])
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .slice(-24)
    .map((message) => ({ role: message.role, content: String(message.content || '') }));

  if (!history.length) throw new Error('No messages to send.');

  let finalText = '';
  let filesWritten = 0;
  let toolCalls = 0;
  const MAX_STEPS = settings.autoContinue === false ? 1 : 3;

  for (let step = 0; step < MAX_STEPS; step++) {
    emit({ type: 'step', step: step + 1, max: MAX_STEPS });

    const parser = new ProtocolParser();
    const asyncJobs = [];
    let stepText = '';
    let proposed = [];

    const handle = (events) => {
      for (const event of events) {
        if (event.kind === 'text') {
          if (!event.text) continue;
          stepText += event.text;
          emit({ type: 'token', text: event.text });
          continue;
        }
        if (event.kind === 'start') {
          if (event.block.type === 'file') {
            emit({ type: 'file_start', path: event.block.attrs.path || '' });
          }
          continue;
        }
        if (event.kind === 'chunk') {
          emit({ type: 'file_chunk', path: event.block.attrs.path || '', text: event.text });
          continue;
        }
        if (event.kind === 'end') {
          const type = event.block.type;
          const attrs = event.block.attrs;
          if (type === 'file') {
            const filePath = String(attrs.path || '').trim();
            const content = cleanContent(event.content);
            if (!filePath) {
              emit({ type: 'warning', message: 'File block without a path attribute ignored.' });
              continue;
            }
            if (settings.autoApply === false) {
              proposed.push({ path: filePath, content });
              emit({ type: 'file_proposed', path: filePath, bytes: Buffer.byteLength(content), content });
            } else {
              try {
                const info = store.writeFile(project.id, filePath, content);
                filesWritten++;
                emit({ type: 'file_saved', path: info.path, bytes: info.size });
              } catch (error) {
                emit({ type: 'error', message: `Unable to write (${filePath}): ${error.message}` });
              }
            }
          } else if (type === 'delete') {
            const filePath = String(attrs.path || '').trim();
            if (!filePath) continue;
            try {
              store.deleteFile(project.id, filePath);
              emit({ type: 'file_deleted', path: filePath });
            } catch (error) {
              emit({ type: 'error', message: `Unable to delete: ${error.message}` });
            }
          } else if (type === 'shell') {
            const command = String(event.content || '').trim();
            if (!command) continue;
            asyncJobs.push(async () => {
              emit({ type: 'shell_start', command });
              let allowed = settings.shellPolicy !== 'never';
              if (settings.shellPolicy === 'ask' && typeof requestApproval === 'function') {
                allowed = await requestApproval('shell', { command });
              }
              if (!allowed) {
                emit({ type: 'shell_denied', command });
                return;
              }
              const cwd = store.ensureShellDir(project.id);
              const result = await runShell({ command, cwd, emit, signal });
              if (result.output.trim()) {
                emit({ type: 'terminal_append', text: `$ ${command}\n${result.output}\n` });
              }
            });
          } else if (type === 'mcp') {
            const toolName = String(attrs.tool || '').trim();
            const argsText = String(event.content || '').trim();
            asyncJobs.push(async () => {
              if (!toolName) return;
              emit({ type: 'tool_start', tool: toolName });
              let args = {};
              if (argsText) {
                try {
                  args = JSON.parse(argsText);
                } catch {
                  emit({ type: 'tool_result', tool: toolName, error: 'Invalid JSON arguments', result: argsText.slice(0, 500) });
                  return;
                }
              }
              try {
                const result = await callTool(toolName, args);
                toolCalls++;
                emit({ type: 'tool_result', tool: toolName, result: result.result, server: result.server });
                appendToolOutput(toolName, result.result);
              } catch (error) {
                emit({ type: 'tool_result', tool: toolName, error: error.message });
              }
            });
          }
        }
      }
    };

    let toolOutput = '';
    const appendToolOutput = (tool, result) => {
      toolOutput += `\n### ${tool}\n${String(result).slice(0, 8000)}\n`;
    };

    try {
      await streamChat(
        {
          provider: settings.provider,
          model: settings.model,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          temperature: settings.temperature,
          system,
          messages: history,
          project,
          files: store.readAllFiles(project.id),
          settings,
        },
        {
          signal,
          onSearch: (search) => emit({ type: 'search', ...search }),
          onUsage: (usage) => emit({ type: 'usage', ...usage }),
          onDelta: (delta, kind) => {
            if (kind === 'reasoning') {
              emit({ type: 'reasoning', text: delta });
              return;
            }
            handle(parser.push(delta));
          },
        }
      );
      handle(parser.end());
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) {
        emit({ type: 'cancelled' });
        return finalText;
      }
      throw error;
    }

    for (const job of asyncJobs) {
      if (signal?.aborted) break;
      await job();
    }

    finalText += stepText;

    if (proposed.length) {
      emit({ type: 'proposals', files: proposed });
    }

    if (!toolOutput.trim() || signal?.aborted) break;

    history.push({ role: 'assistant', content: stepText.slice(0, 12000) });
    history.push({
      role: 'user',
      content: `MCP tool results:${toolOutput}\n\nContinue the task based on these results, or conclude if it is done.`,
    });
  }

  emit({ type: 'stats', filesWritten, toolCalls, characters: finalText.length });
  return finalText;
}
