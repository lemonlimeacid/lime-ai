/* Supernova IA — roster et contrôle des agents d'un projet super agents */

import { $, h, state, bus, toast, updateThread, icon } from './core.js';

const MAX_AGENTS = 6;
const MIN_AGENTS = 2;

let roster = null;
let listEl = null;
let addBtn = null;
let countEl = null;
let supervisorEl = null;
let hintEl = null;

function newAgentId() {
  try {
    if (globalThis.crypto?.randomUUID) return `agent-${globalThis.crypto.randomUUID()}`;
  } catch {
    /* pas de crypto disponible */
  }
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function currentAgents() {
  return Array.isArray(state.thread?.agents) ? state.thread.agents : [];
}

function availableModels() {
  const preset = (state.config.providers || []).find((item) => item.id === state.settings.provider);
  const models = [
    state.settings.model,
    ...(preset?.models || []),
  ];
  if (!models.some(Boolean)) models.push('supernova-mini');
  return [...new Set(models.map((model) => String(model || '').trim()).filter(Boolean))];
}

export function defaultSuperAgents() {
  const model = String(state.settings.model || availableModels()[0] || 'supernova-mini');
  return [1, 2].map((number) => ({
    id: newAgentId(),
    name: `Agent ${number}`,
    model,
  }));
}

function nextAgentNumber(agents) {
  const highest = agents.reduce((max, agent) => {
    const match = /(\d+)/.exec(String(agent.name || ''));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return Math.max(highest + 1, agents.length + 1);
}

function persistAgents(agents) {
  if (!state.thread || state.thread.kind !== 'super') return null;
  const updated = updateThread(state.thread.id, { agents });
  if (!updated) return null;
  state.thread = updated;
  state.threadId = updated.id;
  bus.emit('threads:changed');
  bus.emit('superagents:changed', updated);
  return updated;
}

function updateAgentModel(agentId, model) {
  const agents = currentAgents().map((agent) => (
    agent.id === agentId ? { ...agent, model } : agent
  ));
  persistAgents(agents);
}

function addAgent() {
  if (state.streaming) return;
  if (!state.thread || state.thread.kind !== 'super') return;
  const agents = currentAgents();
  if (agents.length >= MAX_AGENTS) {
    toast(`Maximum ${MAX_AGENTS} agents per super agents project.`, 'warn', 3200);
    return;
  }
  const model = String(state.settings.model || availableModels()[0] || 'supernova-mini');
  const agent = {
    id: newAgentId(),
    name: `Agent ${nextAgentNumber(agents)}`,
    model,
  };
  const updated = persistAgents([...agents, agent]);
  if (!updated) return;
  render();
  setTimeout(() => {
    const select = listEl?.querySelector(`.super-agent[data-agent-id="${CSS.escape(agent.id)}"] select`);
    select?.focus();
  }, 30);
}

function removeAgent(agentId) {
  if (state.streaming) return;
  const agents = currentAgents();
  if (agents.length <= MIN_AGENTS) {
    toast(`Keep at least ${MIN_AGENTS} agents for orchestration.`, 'warn', 3000);
    return;
  }
  const updated = persistAgents(agents.filter((agent) => agent.id !== agentId));
  if (updated) render();
}

function render() {
  if (!roster) return;
  const active = Boolean(state.project && state.thread?.kind === 'super');
  roster.hidden = !active;
  if (!active) {
    if (listEl) listEl.innerHTML = '';
    return;
  }

  if (!state.streaming && currentAgents().length < MIN_AGENTS) {
    const updated = persistAgents(defaultSuperAgents());
    if (updated) state.thread = updated;
  }

  const agents = currentAgents();
  const models = availableModels();
  if (supervisorEl) supervisorEl.textContent = state.settings.model || '—';
  if (countEl) countEl.textContent = `${agents.length} agent${agents.length > 1 ? 's' : ''}`;
  if (hintEl) {
    hintEl.textContent = state.streaming
      ? 'Orchestration in progress — agents are working in parallel.'
      : agents.length >= MAX_AGENTS
        ? `Maximum reached (${MAX_AGENTS}).`
        : 'One prompt, one supervisor, multiple agents in parallel.';
  }
  if (addBtn) {
    addBtn.disabled = state.streaming || agents.length >= MAX_AGENTS;
    addBtn.title = state.streaming
      ? 'Wait for the generation to finish.'
      : agents.length >= MAX_AGENTS
        ? `Maximum ${MAX_AGENTS} agents.`
        : 'Add an agent';
  }

  if (!listEl) return;
  listEl.innerHTML = '';
  agents.forEach((agent, index) => {
    const card = h('div', {
      class: 'super-agent',
      dataset: { agentId: agent.id },
    });
    const number = h('span', {
      class: 'super-agent-index',
      text: String(index + 1).padStart(2, '0'),
      'aria-hidden': 'true',
    });
    const copy = h('div', { class: 'super-agent-copy' });
    copy.append(h('strong', { class: 'super-agent-name', text: agent.name || `Agent ${index + 1}` }));

    const select = h('select', {
      class: 'super-agent-model',
      'aria-label': `Model for ${agent.name || `agent ${index + 1}`}`,
      title: 'Model used by this agent',
    });
    const choices = [...new Set([...models, agent.model].filter(Boolean))];
    for (const model of choices) {
      const option = h('option', { value: model, text: model });
      if (model === agent.model) option.selected = true;
      select.append(option);
    }
    select.disabled = state.streaming;
    select.addEventListener('change', () => updateAgentModel(agent.id, select.value));
    copy.append(select);

    const remove = h('button', {
      class: 'super-agent-remove',
      type: 'button',
      title: agents.length <= MIN_AGENTS ? `Keep at least ${MIN_AGENTS} agents` : 'Remove this agent',
      'aria-label': `Remove ${agent.name || `agent ${index + 1}`}`,
      html: icon('x', 'xs'),
    });
    remove.disabled = state.streaming || agents.length <= MIN_AGENTS;
    remove.addEventListener('click', () => removeAgent(agent.id));

    card.append(number, copy, remove);
    listEl.append(card);
  });
}

export function initSuperAgents() {
  roster = $('#superRoster');
  listEl = $('#superAgentList');
  addBtn = $('#addSuperAgent');
  countEl = $('#superAgentCount');
  supervisorEl = $('#superOrchestratorModel');
  hintEl = $('#superAgentHint');
  if (!roster || !listEl || !addBtn) return;

  addBtn.addEventListener('click', addAgent);
  bus.on('thread:changed', render);
  bus.on('thread:active', render);
  bus.on('project:changed', render);
  bus.on('settings:changed', render);
  bus.on('streaming:changed', render);
  render();
}
