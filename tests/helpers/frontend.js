const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', '..', 'public', 'script.js');
const source = fs.readFileSync(filename, 'utf8');

function frontend(overrides = {}) {
  const timers = new Map();
  const elements = new Map();
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', value: '', className: '', loading: false,
      classList: { toggle(_name, show) { elements.get(id).loading = show; } },
      setAttribute() {}
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById: element },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    AbortController,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: () => { throw new Error('테스트에서 실제 네트워크 호출을 허용하지 않는다'); },
    ...overrides
  });
  vm.runInContext(source, context, { filename });
  return { context, timers, element, run: code => vm.runInContext(code, context) };
}

module.exports = { frontend };
