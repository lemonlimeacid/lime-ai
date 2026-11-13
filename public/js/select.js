/* Lime AI — menus déroulants thémés (remplace le popup natif du système) */

let menuUid = 0;
let activeMenu = null;

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function chevronIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i xs ui-select-chevron');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-chevron-down');
  use.setAttributeNS(XLINK_NS, 'xlink:href', '#i-chevron-down');
  svg.append(use);
  return svg;
}

function optionLabel(option) {
  return String(option?.textContent || option?.label || option?.value || '').trim();
}

function selectedLabel(select) {
  const option = select.options[select.selectedIndex];
  return optionLabel(option) || select.getAttribute('placeholder') || 'Select…';
}

function accessibleName(select) {
  const aria = select.getAttribute('aria-label');
  if (aria) return aria.trim();

  const labelledBy = select.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = document.getElementById(labelledBy);
    if (label) return label.textContent.trim();
  }

  const label = select.closest('label');
  if (label) {
    const first = [...label.children].find(
      (child) => child.tagName === 'SPAN' && !child.classList.contains('sr-only')
    );
    if (first) return first.textContent.trim();
  }

  if (select.id) {
    const explicit = [...document.querySelectorAll('label')].find((item) => item.htmlFor === select.id);
    if (explicit) return explicit.textContent.trim();
  }

  return select.getAttribute('title') || 'Choose an option';
}

function closeMenu({ focus = false } = {}) {
  if (!activeMenu) return;
  const current = activeMenu;
  activeMenu = null;
  current.menu.remove();
  current.trigger.setAttribute('aria-expanded', 'false');
  current.trigger.removeAttribute('aria-controls');
  if (focus && current.trigger.isConnected) current.trigger.focus({ preventScroll: true });
}

function positionMenu(menu, trigger) {
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const viewportGap = 8;
  const width = Math.max(180, Math.min(Math.max(rect.width, 180), window.innerWidth - viewportGap * 2));
  const below = window.innerHeight - rect.bottom - viewportGap;
  const above = rect.top - viewportGap;
  const preferred = Math.min(300, Math.max(120, menu.scrollHeight + 8));
  const openUp = below < preferred && above > below;
  const maxHeight = Math.max(120, Math.min(300, openUp ? above : below));

  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.left = `${Math.min(
    Math.max(viewportGap, rect.left),
    window.innerWidth - width - viewportGap
  )}px`;

  const height = Math.min(menu.getBoundingClientRect().height, maxHeight);
  const top = openUp ? rect.top - height - gap : rect.bottom + gap;
  menu.style.top = `${Math.max(viewportGap, Math.min(top, window.innerHeight - height - viewportGap))}px`;
}

function focusOption(option) {
  if (!option) return;
  option.focus({ preventScroll: true });
  const menu = activeMenu?.menu;
  if (menu) {
    menu.scrollTop = Math.max(0, option.offsetTop - menu.clientHeight / 2 + option.offsetHeight / 2);
  }
}

function buildMenu(select, trigger) {
  const menu = document.createElement('div');
  menu.className = 'ui-select-menu';
  menu.id = `ui-select-menu-${++menuUid}`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', accessibleName(select));

  const options = [];
  [...select.options].forEach((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ui-select-option';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === select.selectedIndex));
    item.tabIndex = -1;
    item.disabled = option.disabled;
    item.dataset.index = String(index);
    item.textContent = optionLabel(option) || '—';
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (option.disabled) return;
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeMenu({ focus: true });
    });
    options.push(item);
    menu.append(item);
  });

  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('.ui-select-option:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(items[(current + 1 + items.length) % items.length]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(items[(current - 1 + items.length) % items.length]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(items[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(items[items.length - 1]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (document.activeElement?.classList.contains('ui-select-option')) {
        document.activeElement.click();
      }
    } else if (event.key === 'Tab') {
      closeMenu({ focus: true });
    }
  });

  return menu;
}

function openMenu(select, trigger) {
  if (select.disabled || !select.options.length) return;
  if (activeMenu?.select === select) {
    closeMenu({ focus: true });
    return;
  }
  closeMenu();

  const menu = buildMenu(select, trigger);
  const dialog = trigger.closest('dialog');
  (dialog && dialog.open ? dialog : document.body).append(menu);
  activeMenu = { select, trigger, menu };

  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', menu.id);

  if (dialog) {
    dialog.addEventListener('close', () => closeMenu(), { once: true });
  }

  positionMenu(menu, trigger);

  const items = [...menu.querySelectorAll('.ui-select-option:not(:disabled)')];
  const selected = items.find((item) => item.getAttribute('aria-selected') === 'true') || items[0];
  focusOption(selected);
}

function syncTrigger(select, trigger, valueEl) {
  const label = selectedLabel(select);
  valueEl.textContent = label;
  trigger.disabled = select.disabled || !select.options.length;
  trigger.setAttribute('aria-disabled', String(trigger.disabled));
  trigger.setAttribute(
    'aria-label',
    `${accessibleName(select)}: ${label}`
  );
  trigger.title = label;
}

export function enhanceSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.dataset.limeSelect || select.multiple || select.size > 1) return;
  select.dataset.limeSelect = 'true';

  const wrapper = document.createElement('span');
  wrapper.className = 'ui-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ui-select-trigger';
  trigger.id = select.id ? `${select.id}-ui-trigger` : `ui-select-trigger-${++menuUid}`;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const valueEl = document.createElement('span');
  valueEl.className = 'ui-select-value';
  trigger.append(valueEl, chevronIcon());

  select.classList.add('ui-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select, trigger);

  const sync = () => syncTrigger(select, trigger, valueEl);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (descriptor?.get && descriptor?.set) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      enumerable: true,
      get() {
        return descriptor.get.call(select);
      },
      set(value) {
        descriptor.set.call(select, value);
        sync();
      },
    });
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu(select, trigger);
  });

  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      openMenu(select, trigger);
    }
  });

  select.addEventListener('change', sync);
  new MutationObserver(() => {
    sync();
    if (activeMenu?.select === select) closeMenu();
  }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  const labels = new Set();
  const wrappingLabel = select.closest('label');
  if (wrappingLabel) labels.add(wrappingLabel);
  if (select.id) {
    const explicit = [...document.querySelectorAll('label')].find((item) => item.htmlFor === select.id);
    if (explicit) labels.add(explicit);
  }
  for (const label of labels) {
    label.addEventListener('click', (event) => {
      if (event.target.closest('.ui-select-trigger, .ui-select-menu, button, input, textarea, select, a')) return;
      event.preventDefault();
      openMenu(select, trigger);
    });
  }

  sync();
}

export function initSelects() {
  for (const select of document.querySelectorAll('select')) enhanceSelect(select);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.('select')) enhanceSelect(node);
        node.querySelectorAll?.('select').forEach((select) => enhanceSelect(select));
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!activeMenu) return;
      if (activeMenu.menu.contains(event.target) || activeMenu.trigger.contains(event.target)) return;
      closeMenu();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!activeMenu) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ focus: true });
    },
    true
  );

  window.addEventListener(
    'scroll',
    (event) => {
      if (!activeMenu) return;
      if (event.target instanceof Node && activeMenu.menu.contains(event.target)) return;
      closeMenu();
    },
    true
  );
  window.addEventListener('resize', () => closeMenu());
}
