/**
 * A minimal DOM stand-in, just enough to run the real UI code inside a Node VM.
 *
 * Elements are plain objects. Every id that appears in index.html is created
 * upfront, so asking for an element that does not exist returns null and the
 * smoke test fails instead of silently passing.
 */

/** @param {string} html */
function extractIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1]);
  return [...ids];
}

/** @param {string} html */
function extractTabs(html) {
  const tabs = [];
  for (const match of html.matchAll(/data-tab="([^"]+)"/g)) tabs.push(match[1]);
  return tabs;
}

function createClassList() {
  const set = new Set();
  return {
    _set: set,
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle: (name, force) => {
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if (on) set.add(name);
      else set.delete(name);
      return on;
    },
    contains: (name) => set.has(name),
    get value() {
      return [...set].join(' ');
    },
  };
}

/**
 * @param {string} tagName
 * @param {string} [id]
 */
function createElement(tagName, id) {
  const children = [];
  const listeners = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    id: id ?? '',
    children,
    style: {},
    dataset: {},
    classList: createClassList(),
    value: '',
    hidden: false,
    width: 900,
    height: 560,
    clientWidth: 900,
    clientHeight: 560,
    files: [],
    appendChild(child) {
      children.push(child);
      child.parentNode = element;
      return child;
    },
    append(...nodes) {
      nodes.forEach((node) => children.push(node));
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
    remove() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    click() {
      const handlers = listeners.get('click') ?? [];
      handlers.forEach((handler) => handler({ target: element }));
    },
    select() {},
    focus() {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      (listeners.get(type) ?? []).forEach((handler) => handler({ target: element, ...event }));
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    getContext() {
      return createCanvasContext();
    },
    toDataURL() {
      return '';
    },
  };
  Object.defineProperty(element, 'firstChild', { get: () => children[0] ?? null });
  // className and classList are two views of the same thing, as in the DOM.
  Object.defineProperty(element, 'className', {
    get: () => element.classList.value,
    set: (value) => {
      element.classList._set.clear();
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => element.classList.add(name));
    },
  });
  // Setting textContent clears the children, exactly like the real DOM. Code
  // that re-renders a table relies on that.
  let text = '';
  Object.defineProperty(element, 'textContent', {
    get: () => text,
    set: (value) => {
      text = value === null || value === undefined ? '' : String(value);
      children.length = 0;
    },
  });
  return element;
}

/** A 2D context where every method is a no-op and every property is writable. */
function createCanvasContext() {
  const state = {};
  return new Proxy(state, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

/**
 * Builds a `document`/`window` pair for the given HTML source.
 *
 * @param {string} html
 */
export function createDom(html) {
  const ids = extractIds(html);
  const tabs = extractTabs(html);
  const elements = new Map();
  for (const id of ids) elements.set(id, createElement('div', id));

  // The nav element needs to hand out its tab buttons.
  const tabsElement = elements.get('tabs');
  if (tabsElement) {
    const buttons = tabs.map((name) => {
      const button = createElement('button');
      button.dataset.tab = name;
      return button;
    });
    tabsElement.querySelectorAll = (selector) => (selector.includes('data-tab') ? buttons : []);
    tabsElement.tabButtons = buttons;
  }
  for (const section of ['eye', 'seed', 'guide']) {
    const element = elements.get(`tab-${section}`);
    if (element) element.hidden = section !== 'eye';
  }
  for (const id of ['measureBody', 'seedBody']) {
    const element = elements.get(id);
    if (element) element.children.length = 0;
  }

  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };

  const document = {
    readyState: 'complete',
    documentElement: createElement('html'),
    body: createElement('body'),
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => createElement(tag),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    execCommand: () => true,
  };
  document.documentElement.dataset = {};

  const window = {
    document,
    localStorage,
    navigator: { language: 'zh-CN', clipboard: null },
    location: { hash: '', origin: 'http://localhost:8123', pathname: '/', href: 'http://localhost:8123/' },
    history: { replaceState() {} },
    devicePixelRatio: 2,
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    __STRONGHOLD_FINDER_READY__: false,
    btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
    atob: (text) => Buffer.from(text, 'base64').toString('binary'),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob: class {
      constructor(parts) {
        this.parts = parts;
      }
    },
    URL: Object.assign(URL, { createObjectURL: () => 'blob:stub', revokeObjectURL() {} }),
    console,
  };
  window.window = window;
  window.globalThis = window;

  return { document, window, elements, localStorage, tabs: tabsElement?.tabButtons ?? [] };
}
