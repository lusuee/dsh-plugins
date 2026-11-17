// Offline harness: load the client half under a fake module loader and assert
// the surface it publishes to the Web GUI (slot entry, keyboard command,
// dictionaries) plus the pure row builder it orders the list with. No browser,
// no React, no Host: this is what `npm test` can prove on its own.
import assert from 'node:assert';

const registered = [];
const dictionaries = [];
const commands = [];
const workspaceOpened = [];
const refreshCalls = [];

globalThis.window = {
  innerWidth: 1280,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn) => fn(),
  getSelection: () => null,
  __ModuleLoader__: {
    load(definition) {
      globalThis.__definition = definition;
    },
  },
};
globalThis.document = {
  body: {},
  addEventListener() {},
  removeEventListener() {},
};

const react = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
};
const requireStub = (name) => {
  if (name === 'react') return react;
  if (name === 'react-dom') return { createPortal: (node) => node };
  throw new Error('unexpected require: ' + name);
};

await import(new URL('../lib/client.js', import.meta.url));
const definition = globalThis.__definition;
assert.equal(definition.id, 'dsh-plugin-session-quick-switch');

const module_ = definition.factory(requireStub);
assert.deepEqual(Array.from(module_.inject).sort(), ['locale', 'slots']);

const ctx = {
  effect(fn) {
    fn();
  },
  locale: {
    register(namespace, dict) {
      dictionaries.push({ namespace, dict });
      return () => {};
    },
    bind(namespace) {
      return (key, params) => (params === undefined ? `${namespace}.${key}` : `${namespace}.${key}${JSON.stringify(params)}`);
    },
  },
  slots: {
    inject(name, factory) {
      // Mimic the slot owner being present: run the factory now.
      factory();
    },
    register(entry, component) {
      registered.push({ entry, component });
      return () => {};
    },
  },
  inject(names, callback) {
    assert.deepEqual(Array.from(names), ['shortcuts']);
    callback({
      effect(fn) {
        fn();
      },
      shortcuts: {
        register(command) {
          commands.push(command);
          return () => {};
        },
      },
    });
  },
  get(name) {
    if (name === 'uiWorkspace') return { openSession: (id) => workspaceOpened.push(id) };
    if (name === 'sessions') return { refresh: () => { refreshCalls.push(Date.now()); return Promise.resolve() } };
    return undefined;
  },
};

module_.apply(ctx);

// --- registration surface ---------------------------------------------------
assert.deepEqual(
  registered.map((item) => `${item.entry.name}#${item.entry.id}@${item.entry.order}`),
  ['shell.overlay#session-quick-switch@40'],
);
assert.equal(registered[0].entry.locale, 'session-quick-switch');
assert.equal(typeof registered[0].component, 'function');

assert.equal(dictionaries.length, 1);
assert.equal(dictionaries[0].namespace, 'session-quick-switch');
assert.equal(typeof dictionaries[0].dict.zh['palette.title'], 'string');
assert.equal(typeof dictionaries[0].dict.en['palette.title'], 'string');
for (const key of ['group.waiting', 'group.running', 'group.recent', 'footer.total', 'footer.matched']) {
  assert.equal(typeof dictionaries[0].dict.zh[key], 'string', `zh is missing ${key}`);
  assert.equal(typeof dictionaries[0].dict.en[key], 'string', `en is missing ${key}`);
}
assert.deepEqual(
  Object.keys(dictionaries[0].dict.zh).sort(),
  Object.keys(dictionaries[0].dict.en).sort(),
  'zh and en must cover the same keys',
);

assert.equal(commands.length, 1);
const command = commands[0];
assert.equal(command.id, 'session-quick-switch.open');
assert.deepEqual(command.defaults['desktop:windows'], { code: 'KeyE', modifiers: ['primary'] });
assert.deepEqual(command.defaults['desktop:macos'], { code: 'KeyE', modifiers: ['primary'] });
assert.deepEqual(command.defaults['desktop:linux'], { code: 'KeyE', modifiers: ['primary'] });
// Browser profiles cannot take the bare chord, so they bind the alt variant.
for (const profile of ['web:macos', 'web:windows']) {
  assert.deepEqual(command.defaults[profile], { code: 'KeyE', modifiers: ['primary', 'alt'] }, `${profile} takes the alt chord`);
}
// Linux Web only admits three combinations; declaring one it rejects would make
// `register` throw for every platform, so it stays unbound.
assert.equal(command.defaults['web:linux'], undefined, 'web:linux stays unbound rather than failing registration');
assert.deepEqual(Array.from(command.regions), ['page', 'editable']);
assert.deepEqual(Array.from(command.modals), []);
assert.equal(typeof command.label, 'function');
assert.equal(typeof command.resolve, 'function');
assert.equal(typeof command.resolve({ region: 'page', modal: null, target: null }).run, 'function');

// --- injected face + store wiring ------------------------------------------
const face = registered[0].entry.inject();
assert.equal(typeof face.closeSessionQuickSwitch, 'function');
assert.equal(typeof face.selectSession, 'function');
assert.equal(typeof face.hooks.sessionQuickSwitchOpen.getSnapshot, 'function');
assert.equal(face.hooks.sessionQuickSwitchOpen.getSnapshot(), false);

let notified = 0;
const unsubscribe = face.hooks.sessionQuickSwitchOpen.subscribe(() => {
  notified += 1;
});
command.resolve({ region: 'page', modal: null, target: null }).run();
assert.equal(face.hooks.sessionQuickSwitchOpen.getSnapshot(), true, 'the command opens the palette');
assert.equal(notified, 1, 'opening notifies slot subscribers');
command.resolve({ region: 'page', modal: null, target: null }).run();
assert.equal(face.hooks.sessionQuickSwitchOpen.getSnapshot(), false, 'a second press toggles it closed');
unsubscribe();

// Opening asks the Host for a fresh list, but only once a minute: a second pull
// racing the user's pick is what makes a jump feel janky.
assert.equal(refreshCalls.length, 1, 'the first open pulls the list');
command.resolve({ region: 'page', modal: null, target: null }).run();
assert.equal(face.hooks.sessionQuickSwitchOpen.getSnapshot(), true);
assert.equal(refreshCalls.length, 1, 'a repeat open within the minute reuses the cached list');
command.resolve({ region: 'page', modal: null, target: null }).run();
assert.equal(face.hooks.sessionQuickSwitchOpen.getSnapshot(), false);

face.hooks.sessionQuickSwitchOpen.subscribe(() => {});
assert.equal(face.hooks.sessionQuickSwitchOpen.getSnapshot(), false);
face.selectSession('session-b');
assert.deepEqual(workspaceOpened, ['session-b']);
face.selectSession('');
assert.deepEqual(workspaceOpened, ['session-b'], 'empty ids are ignored');

// The swap defers to the next frame so the palette's close paints on its own
// instead of waiting behind the target view's mount.
const frames = [];
globalThis.requestAnimationFrame = (fn) => {
  frames.push(fn);
};
face.selectSession('session-c');
assert.deepEqual(workspaceOpened, ['session-b'], 'the swap waits for a frame');
assert.equal(frames.length, 1, 'one frame is scheduled');
// A second pick before that frame wins, so a double Enter cannot navigate twice.
face.selectSession('session-d');
assert.equal(frames.length, 2);
frames[0]();
assert.deepEqual(workspaceOpened, ['session-b'], 'a superseded frame does not navigate');
frames[1]();
assert.deepEqual(workspaceOpened, ['session-b', 'session-d'], 'the frame performs the swap');
delete globalThis.requestAnimationFrame;

// --- ordering rule ----------------------------------------------------------
const { buildRows, baseName, matchSegments, stepIndex } = module_.__internals;
const list = {
  ids: ['a', 'b', 'c', 'd', 'e'],
  byId: {
    a: { id: 'a', displayTitle: 'Alpha 归档流程', cwd: 'D:\\dsh', running: false, updatedAt: 100 },
    b: { id: 'b', displayTitle: 'Beta 驳回按钮', cwd: 'D:\\github\\fdm-crm', running: true, updatedAt: 50 },
    c: { id: 'c', displayTitle: 'Gamma', running: false, updatedAt: 900, origin: 'subagent' },
    d: { id: 'd', displayTitle: 'Delta', running: false, updatedAt: 800, blank: true },
    e: { id: 'e', displayTitle: 'Epsilon', cwd: 'D:\\other', running: false, updatedAt: 200 },
  },
};

// The list's own flag alone: the running row leads even though it is older.
let groups = buildRows(list, new Map(), '');
assert.deepEqual(
  groups.running.map((row) => row.id),
  ['b'],
);
assert.deepEqual(
  groups.recent.map((row) => row.id),
  ['e', 'a'],
  'idle rows by recency, subagent and blank rows dropped',
);

// Live status beats the list flag: `a` starts running, `b` stopped.
groups = buildRows(list, new Map([['a', { running: true }], ['b', { running: false }]]), '');
assert.deepEqual(
  groups.running.map((row) => row.id),
  ['a'],
);
assert.deepEqual(
  groups.recent.map((row) => row.id),
  ['e', 'b'],
);

// Filtering by title and by directory, case-insensitive.
assert.deepEqual(
  buildRows(list, new Map(), '驳回').running.map((row) => row.id),
  ['b'],
);
assert.deepEqual(
  buildRows(list, new Map(), 'FDm').running.map((row) => row.id),
  ['b'],
);
assert.equal(buildRows(list, new Map(), 'zzz').total, 0);

// Live status splits three ways: a session asking the user outranks one that is
// still working, and a finished-but-unread session outranks plain idle rows.
groups = buildRows(
  list,
  new Map([
    ['a', { running: true }],
    ['b', { running: true, pendingInteraction: { kind: 'approval' } }],
    ['e', { running: false, completionUnread: true }],
  ]),
  '',
);
assert.deepEqual(groups.waiting.map((row) => row.id), ['b'], 'pending interaction leads');
assert.deepEqual(groups.running.map((row) => row.id), ['a'], 'still-working rows come next');
assert.deepEqual(groups.recent.map((row) => row.id), ['e'], 'unread completion sorts ahead of idle');
assert.equal(groups.waiting[0].state, 'waiting');
assert.equal(groups.total, 3);

// An explicit `false` is not a set flag; a plain idle row stays idle.
groups = buildRows(list, new Map([['a', { running: true, pendingInteraction: false, completionUnread: false }]]), '');
assert.deepEqual(groups.waiting, [], 'a false flag does not ask for the user');
assert.deepEqual(groups.running.map((row) => row.id), ['a', 'b'], 'live state beats the list flag, newest first');
assert.equal(buildRows(list, new Map([['e', { running: false }]]), '').recent[0].state, 'idle');

// Only kinds the sidebar itself surfaces count as an ask: a domain-owned request
// with no answer surface here stays inside "running" instead of asking.
groups = buildRows(
  list,
  new Map([
    ['a', { running: false, pendingInteraction: { kind: 'question' } }],
    ['b', { running: true, pendingInteraction: { kind: 'subagent-internal' } }],
  ]),
  '',
);
assert.deepEqual(groups.waiting.map((row) => row.id), ['a'], 'a question kind asks for the user');
assert.deepEqual(groups.running.map((row) => row.id), ['b'], 'an unknown kind does not ask');

// Row shape is what the row renderer reads.
const rowB = buildRows(list, new Map(), 'beta').running[0];
assert.equal(rowB.title, 'Beta 驳回按钮');
assert.equal(rowB.folder, 'fdm-crm');
assert.equal(rowB.running, true);
assert.equal(baseName('D:\\github\\fdm-crm'), 'fdm-crm');
assert.equal(baseName(''), '');

// Highlight segments: case-insensitive, every occurrence, needle kept verbatim.
assert.deepEqual(matchSegments('Beta 驳回按钮 beta', 'beta'), [
  { text: 'Beta', match: true },
  { text: ' 驳回按钮 ', match: false },
  { text: 'beta', match: true },
]);
assert.deepEqual(matchSegments('Alpha', ''), [{ text: 'Alpha', match: false }]);
assert.deepEqual(matchSegments('', 'beta'), [{ text: '', match: false }]);
assert.deepEqual(matchSegments('Alpha', 'zzz'), [{ text: 'Alpha', match: false }]);
assert.deepEqual(matchSegments('aaa', 'aa'), [
  { text: 'aa', match: true },
  { text: 'a', match: false },
]);

// Arrow navigation: the first ↓ must leave the already-highlighted row 0.
assert.equal(stepIndex(0, 3, 1), 1, 'first ↓ moves off row 0');
assert.equal(stepIndex(2, 3, 1), 0, '↓ wraps to the top');
assert.equal(stepIndex(0, 3, -1), 2, '↑ wraps to the bottom');
assert.equal(stepIndex(0, 1, 1), 0, 'a single row stays selected');
assert.equal(stepIndex(0, 0, 1), 0, 'an empty list has no cursor');

// --- component smoke render -------------------------------------------------
const walk = (node, visit) => {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
};

const renderWith = (isOpen) =>
  registered[0].component({
    ...face,
    t: (key) => key,
    useSessionQuickSwitchOpen: (select) => select(isOpen),
    useSessions: (select) => select({ ids: list.ids, byId: list.byId }),
    useSessionStatus: () => new Map([['a', { running: true }]]),
  });

assert.equal(renderWith(false), null, 'nothing is rendered while closed');

const tree = renderWith(true);
const seen = [];
const dots = [];
walk(tree, (node) => {
  const marker = node.props && node.props['data-session-quick-switch'];
  if (typeof node.type === 'string' && marker === 'dot') dots.push(node.props['data-state']);
  if (typeof node.type === 'string' && marker !== undefined) seen.push(`${node.type}:${marker}`);
  if (typeof node.type === 'string' && node.props && node.props.role !== undefined) seen.push(`${node.type}:role=${node.props.role}`);
});

assert.ok(seen.includes('div:layer'), 'the overlay root opts back into pointer events');
assert.ok(seen.includes('input:query'), 'the filter input exists');
assert.ok(seen.includes('div:list'), 'the listbox exists');
assert.ok(seen.includes('div:role=listbox'));
assert.ok(seen.includes('div:role=dialog'));
assert.equal(
  seen.filter((entry) => entry === 'div:row').length,
  3,
  'two running rows plus one idle session render as three rows',
);
assert.ok(
  seen.some((entry) => entry === 'div:role=option'),
  'rows expose the listbox option role',
);
assert.deepEqual(dots, ['running', 'running', 'idle'], 'each dot carries the row state');

// A palette with nothing to show still says so instead of rendering a blank box.
const textsOf = (root) => {
  const out = [];
  const collect = (node) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) collect(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const child of node.children || []) collect(child);
  };
  collect(root);
  return out;
};

const quiet = registered[0].component({
  ...face,
  t: (key) => key,
  useSessionQuickSwitchOpen: (select) => select(true),
  useSessions: (select) => select({ ids: [], byId: {} }),
  useSessionStatus: () => new Map(),
});
assert.ok(textsOf(quiet).includes('palette.none'), 'an empty list renders the empty label');

// A session blocked on the user gets its own leading group.
const waiting = registered[0].component({
  ...face,
  t: (key) => key,
  useSessionQuickSwitchOpen: (select) => select(true),
  useSessions: (select) => select({ ids: list.ids, byId: list.byId }),
  useSessionStatus: () => new Map([['a', { running: true }], ['b', { running: true, pendingInteraction: { kind: 'plan-review' } }]]),
});
const waitingTexts = textsOf(waiting);
assert.ok(waitingTexts.includes('group.waiting'), 'the waiting group is labelled');
assert.ok(
  waitingTexts.indexOf('group.waiting') < waitingTexts.indexOf('group.running')
    && waitingTexts.indexOf('group.running') < waitingTexts.indexOf('group.recent'),
  'groups render as waiting, running, recent',
);
assert.ok(waitingTexts.includes('footer.total'), 'an unfiltered footer counts everything');

// A rejected shortcut default must not take the palette down with it: `register`
// validates every declared profile, so one bad chord would otherwise abort apply
// and the overlay slot would never mount.
const warnings = [];
const originalWarn = console.warn;
const slotsBefore = registered.length;
console.warn = (...args) => warnings.push(args.join(' '));
try {
  module_.apply({
    ...ctx,
    inject(names, callback) {
      assert.deepEqual(Array.from(names), ['shortcuts']);
      callback({
        effect(fn) {
          fn();
        },
        shortcuts: {
          register() {
            throw new Error('Conflicting shortcut defaults: a and b (web:windows)');
          },
        },
      });
    },
  });
} finally {
  console.warn = originalWarn;
}
assert.equal(registered.length, slotsBefore + 1, 'the overlay slot still mounts when the shortcut is rejected');
assert.equal(warnings.length, 1, 'the rejection is reported once');
assert.match(warnings[0], /shortcut registration rejected/);

console.log('test-client: ok');
