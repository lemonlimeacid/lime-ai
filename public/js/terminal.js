/* Supernova IA — terminal (WebSocket) */

import { $, state, bus, toast } from './core.js';
import { notifyTerminalTab } from './workspace.js';

let socket = null;
let outputEl = null;
let form = null;
let inputEl = null;
let history = [];
let historyIndex = -1;
let pending = [];
let bufferText = '';

export function initTerminal() {
  outputEl = $('#termOutput');
  form = $('#termForm');
  inputEl = $('#termInput');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = inputEl.value.trim();
    if (!command) return;
    history.push(command);
    if (history.length > 100) history.shift();
    historyIndex = history.length;
    inputEl.value = '';
    runCommand(command);
  });

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        inputEl.value = history[historyIndex] || '';
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex++;
        inputEl.value = history[historyIndex] || '';
      } else {
        historyIndex = history.length;
        inputEl.value = '';
      }
    }
  });

  bus.on('terminal:append', ({ text, stream }) => append(text, stream));

  bus.on('project:changed', () => {
    closeSocket();
    bufferText = '';
    if (outputEl) {
      outputEl.innerHTML = '';
      append(
        state.project?.mode === 'cloud'
          ? 'Terminal prêt (mode Cloud : les commandes tournent dans le stockage interne Supernova).\n'
          : 'Terminal prêt. Les commandes s’exécutent à la racine du projet.\n',
        'sys'
      );
      append('Astuce : « npm install », « npm run dev », « ls », « node -v ». Les commandes de l’agent apparaissent ici.\n\n', 'sys');
    }
  });

  if (outputEl) {
    append('Terminal prêt. Sélectionne un projet puis lance une commande.\n', 'sys');
  }
}

function append(text, stream = 'stdout') {
  if (!outputEl || !text) return;
  bufferText += text;
  if (bufferText.length > 400000) {
    bufferText = bufferText.slice(-200000);
    outputEl.innerHTML = '';
    appendRaw(bufferText, 'sys');
  } else {
    appendRaw(text, stream);
  }
  outputEl.scrollTop = outputEl.scrollHeight;
}

function appendRaw(text, stream) {
  const span = document.createElement('span');
  if (stream === 'stderr') span.className = 'err';
  else if (stream === 'sys') span.className = 'sys';
  else if (stream === 'cmd') span.className = 'cmd';
  span.textContent = text;
  outputEl.append(span);
}

function openSocket() {
  return new Promise((resolve, reject) => {
    if (!state.project) return reject(new Error('Aucun projet'));
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws/terminal?projectId=${encodeURIComponent(state.project.id)}`;
    let settled = false;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      settled = true;
      socket = ws;
      for (const payload of pending.splice(0)) ws.send(JSON.stringify(payload));
      resolve(ws);
    };

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'start') {
        /* commande démarrée */
      } else if (message.type === 'output') {
        append(message.text || '', message.stream);
        notifyTerminalTab();
      } else if (message.type === 'exit') {
        append(`\n[code ${message.code}]\n`, message.code === 0 ? 'sys' : 'err');
        notifyTerminalTab();
      } else if (message.type === 'ready' && message.shellEnabled === false) {
        append('Commande non exécutée : l’exécution shell est désactivée (SUPERNOVA_DISABLE_SHELL=1).\n', 'sys');
      }
    };

    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (!settled) reject(new Error('Connexion au terminal impossible'));
    };

    ws.onerror = () => {
      if (!settled) reject(new Error('Erreur de connexion au terminal'));
    };

    setTimeout(() => {
      if (!settled) {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error('Délai de connexion dépassé'));
      }
    }, 6000);
  });
}

function closeSocket() {
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
}

async function runCommand(command) {
  append(`\n$ ${command}\n`, 'cmd');
  try {
    if (!socket || socket.readyState !== WebSocket.OPEN) await openSocket();
    socket.send(JSON.stringify({ type: 'run', command }));
  } catch (error) {
    append(`Impossible d’exécuter la commande : ${error.message}\n`, 'err');
    toast('Terminal indisponible. Vérifie que le serveur Node tourne.', 'err');
  }
}

export function focusTerminal() {
  inputEl?.focus();
}
