import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { maskText } from '../src/mask.js';
import { DEMO_TEXT, DEMO_MANUAL } from '../src/demo.js';

// Browser boundary only: run the actual controller and actual masking function.
// Responsive layout, clipboard permissions and DOM rendering are tested in Edge.
async function openApp() {
  const [html, code] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
  ]);
  let document;
  class Element {
    value = ''; _hidden = false; disabled = false; open = false;
    get hidden() { return this._hidden; }
    set hidden(value) {
      this._hidden = value;
      if (value && document?.activeElement === this) document.activeElement = document.body;
    }
    textContent = ''; children = []; attributes = new Map(); listeners = new Map();
    classList = { add() {}, remove() {}, toggle() {} };
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    dispatch(type, values = {}) { return this.listeners.get(type)?.({ preventDefault() {}, target: this, ...values }); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    replaceChildren(...nodes) { this.children = nodes; }
    append(...nodes) { this.children.push(...nodes); }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    select() { this.setSelectionRange(0, this.value.length); }
  }
  const elements = new Map();
  for (const match of html.matchAll(/<[a-z][\w-]*\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const element = new Element();
    element.hidden = /\bhidden\b/.test(match[0]);
    element.disabled = /\bdisabled\b/.test(match[0]);
    element.checked = /\bchecked\b/.test(match[0]);
    elements.set(match[1], element);
  }
  document = Object.assign(new Element(), {
    body: new Element(),
    getElementById: id => elements.get(id),
    createDocumentFragment: () => new Element(),
    createElement: () => new Element(),
    createTextNode: text => ({ textContent: text }),
  });
  const window = Object.assign(new Element(), {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getSelection: () => ({ removeAllRanges() {} }),
  });
  runInNewContext(code.replace(/^import .*;\r?$/gm, ''), {
    document, window, maskText, DEMO_TEXT, DEMO_MANUAL,
    navigator: {},
  }, { filename: 'src/app.js' });
  const get = id => elements.get(id);
  const input = (id, value) => { get(id).value = value; get(id).dispatch('input'); };
  return { get, input, document, window };
}

test('пример заполняет оба поля только на пустой странице', async () => {
  const { get } = await openApp();
  get('demo').dispatch('click');
  assert.equal(get('source').value, DEMO_TEXT);
  assert.equal(get('manual').value, DEMO_MANUAL);
  assert.equal(get('demo').hidden, true);
});

test('TEXT-01: пример не заменяет введённый исходник даже при прямом вызове команды', async () => {
  const { get, input } = await openApp();
  input('source', 'Рабочий текст');
  get('demo').dispatch('click');
  assert.equal(get('source').value, 'Рабочий текст');
  assert.equal(get('manual').value, '');
  assert.equal(get('demo').hidden, true);
});

test('TEXT-01: отдельный ручной список защищён от загрузки примера', async () => {
  const { get, input } = await openApp();
  input('manual', 'Иван Иванов\nC++[42]');
  get('demo').dispatch('click');
  assert.equal(get('source').value, '');
  assert.equal(get('manual').value, 'Иван Иванов\nC++[42]');
  assert.equal(get('demo').hidden, true);
});

test('TEXT-01: пробельный ввод считается рабочим и не перезаписывается примером', async () => {
  const { get, input } = await openApp();
  input('source', ' \n\t');
  get('demo').dispatch('click');
  assert.equal(get('source').value, ' \n\t');
});

test('редактирование ручного списка блокирует копирование старого результата', async () => {
  const { get, input } = await openApp();
  input('source', 'Иван Иванов anna@example.test');
  get('mask-form').dispatch('submit');
  assert.equal(get('result').value, 'Иван Иванов [EMAIL_1]');
  assert.equal(get('copy').disabled, false);
  input('manual', 'Иван Иванов');
  assert.equal(get('result').value, '');
  assert.equal(get('copy').disabled, true);
});

test('очистка удаляет текст, правила и результат и возвращает пример', async () => {
  const { get } = await openApp();
  get('demo').dispatch('click');
  get('mask-form').dispatch('submit');
  get('clear').dispatch('click');
  for (const id of ['source', 'manual', 'result']) assert.equal(get(id).value, '');
  assert.equal(get('count-email').textContent, '0');
  assert.equal(get('copy').disabled, true);
  assert.equal(get('demo').hidden, false);
});

test('ссылка пропуска возвращает фокус в исходник после показа выделенных замен', async () => {
  const { get, input, document } = await openApp();
  input('source', 'anna@example.test');
  get('mask-form').dispatch('submit');
  assert.equal(get('source').hidden, true);
  get('skip-source').dispatch('click');
  assert.equal(get('source').hidden, false);
  assert.equal(document.activeElement, get('source'));
  assert.equal(get('result').value, '[EMAIL_1]');
});

test('Ctrl+Enter из исходника переводит фокус в результат до потери активного скрытого поля', async () => {
  const { get, input, document } = await openApp();
  input('source', 'anna@example.test');
  get('source').focus();
  document.dispatch('keydown', { ctrlKey: true, key: 'Enter' });
  assert.equal(get('source').hidden, true);
  assert.equal(get('result').value, '[EMAIL_1]');
  assert.equal(document.activeElement, get('result'));
});
