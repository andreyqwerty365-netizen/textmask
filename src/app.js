import { maskText } from './mask.js';
import { DEMO_TEXT, DEMO_MANUAL } from './demo.js';

const byId = id => document.getElementById(id);
const source = byId('source');
const manual = byId('manual');
const result = byId('result');
const error = byId('error');
const badge = byId('result-badge');
const copy = byId('copy');
const status = byId('status');
const viewport = window.matchMedia('(max-width: 800px)');
let current = null;
let view = 'source';

function setView(next) {
  view = next;
  byId('source-panel').hidden = viewport.matches && view !== 'source';
  byId('result-panel').hidden = viewport.matches && view !== 'result';
  for (const name of ['source', 'result']) {
    const panel = byId(`${name}-panel`);
    panel.setAttribute('role', viewport.matches ? 'tabpanel' : 'region');
    panel.setAttribute('aria-labelledby', `${name}-${viewport.matches ? 'tab' : 'title'}`);
    const tab = byId(`${name}-tab`);
    tab.setAttribute('aria-selected', String(name === view));
    tab.tabIndex = name === view ? 0 : -1;
  }
}

function updateInputMeta() {
  // Whitespace can be intentional user data. Only two exactly empty fields allow a demo.
  const empty = source.value === '' && manual.value === '';
  byId('demo').hidden = !empty;
  byId('empty-example').hidden = !empty;
  byId('source-length').textContent = `${source.value.length.toLocaleString('ru-RU')} / 100 000 символов`;
  const rules = new Set(manual.value.split(/\r\n?|\n/).filter(line => line.trim() !== '')).size;
  byId('rule-count').textContent = String(rules);
  byId('manual-length').textContent = `${manual.value.length.toLocaleString('ru-RU')} / 10 000 символов · строк: ${rules} / 100`;
}

function resetResult() {
  current = null;
  result.value = '';
  copy.disabled = true;
  source.hidden = false;
  byId('copy-help').hidden = true;
  byId('source-preview').hidden = true;
  byId('source-preview').replaceChildren();
  byId('edit-source').hidden = true;
  byId('replacement-summary').hidden = true;
  byId('merge-note').hidden = true;
  byId('review-note').hidden = true;
  byId('source-mode').textContent = 'Обычный текст';
  error.hidden = true;
  source.removeAttribute('aria-invalid');
  manual.removeAttribute('aria-invalid');
  badge.textContent = source.value !== '' || manual.value !== '' ? 'Нужно обновить' : 'Ожидает текст';
  badge.classList.remove('ready');
  for (const type of ['email', 'phone', 'text']) byId(`count-${type}`).textContent = '0';
  byId('summary').textContent = 'Нажмите «Маскировать», чтобы получить актуальный результат.';
  updateInputMeta();
}

function clearAll() {
  source.value = '';
  manual.value = '';
  resetResult();
  byId('manual-details').open = false;
  byId('summary').textContent = 'Сначала добавьте исходник и нажмите «Маскировать».';
  window.getSelection()?.removeAllRanges();
  setView('source');
  status.textContent = '';
}

function renderPreview() {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of current.matches) {
    fragment.append(document.createTextNode(source.value.slice(cursor, match.start)));
    const mark = document.createElement('mark');
    mark.className = match.type;
    mark.textContent = source.value.slice(match.start, match.end);
    const label = document.createElement('span');
    label.className = 'token-label';
    label.textContent = match.token;
    fragment.append(mark, label);
    cursor = match.end;
  }
  fragment.append(document.createTextNode(source.value.slice(cursor)));
  byId('source-preview').replaceChildren(fragment);
  byId('source-preview').hidden = false;
  source.hidden = true;
  byId('edit-source').hidden = false;
  byId('source-mode').textContent = 'Фрагмент → метка';
}

function showError(message, field) {
  setView('source');
  if (field === manual) byId('manual-details').open = true;
  error.textContent = message;
  error.hidden = false;
  field.setAttribute('aria-invalid', 'true');
  field.focus();
  status.textContent = 'Исправьте ввод и повторите маскирование.';
}

function transform() {
  const sourceHadFocus = document.activeElement === source;
  resetResult();
  if (!source.value.trim()) {
    showError('Сначала вставьте текст для маскирования.', source);
    return;
  }
  try {
    current = maskText(source.value, manual.value);
  } catch (problem) {
    const field = source.value.length > 100000 || problem.message.includes('20 000') ? source : manual;
    showError(problem.message, field);
    return;
  }
  result.value = current.text;
  result.scrollTop = 0;
  for (const type of ['email', 'phone', 'text']) byId(`count-${type}`).textContent = current.counts[type];
  byId('replacement-summary').hidden = false;
  byId('summary').textContent = `Замен: ${current.counts.total} · уникальных меток: ${current.counts.unique}`;
  byId('merge-note').hidden = current.merged === 0;
  byId('merge-note').textContent = `Объединённых фрагментов: ${current.merged}. Пересечения скрыты целиком; связанные повторы получают общую метку. Приоритет: email → телефон → строка.`;
  byId('review-note').hidden = false;
  badge.textContent = 'Готов к проверке';
  badge.classList.add('ready');
  copy.disabled = false;
  renderPreview();
  setView('result');
  if (viewport.matches) byId('result-tab').focus();
  else if (sourceHadFocus) result.focus();
  status.textContent = current.counts.total ? `Замен: ${current.counts.total}. Результат готов к проверке.` : 'Совпадений не найдено. Текст сохранён без изменений; проверьте его вручную.';
}

byId('mask-form').addEventListener('submit', event => { event.preventDefault(); transform(); });
for (const field of [source, manual]) field.addEventListener('input', () => {
  resetResult();
  status.textContent = 'Текст или правила изменены. Нажмите «Маскировать», чтобы обновить результат.';
});
byId('demo').addEventListener('click', () => {
  if (source.value !== '' || manual.value !== '') return;
  source.value = DEMO_TEXT;
  manual.value = DEMO_MANUAL;
  resetResult();
  byId('manual-details').open = true;
  setView('source');
  status.textContent = 'Пример вставлен. Нажмите «Маскировать».';
  source.focus();
  source.setSelectionRange(0, 0);
  source.scrollTop = 0;
});
byId('clear').addEventListener('click', () => {
  clearAll();
  status.textContent = 'Текст, правила и результат очищены.';
  source.focus();
});
function editSource() {
  setView('source');
  source.hidden = false;
  byId('source-preview').hidden = true;
  byId('edit-source').hidden = true;
  byId('source-mode').textContent = 'Обычный текст';
  source.focus();
}
byId('edit-source').addEventListener('click', editSource);
byId('skip-source').addEventListener('click', event => {
  event.preventDefault();
  editSource();
});
for (const name of ['source', 'result']) {
  byId(`${name}-tab`).addEventListener('click', () => setView(name));
  byId(`${name}-tab`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'source' : event.key === 'End' ? 'result' : name === 'source' ? 'result' : 'source';
    setView(next);
    byId(`${next}-tab`).focus();
  });
}
viewport.addEventListener('change', () => setView(view));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); transform(); }
});
copy.addEventListener('click', async () => {
  if (!current || !result.value) return;
  const snapshot = current;
  const text = result.value;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (current !== snapshot) return;
    byId('copy-help').hidden = true;
    status.textContent = 'Результат скопирован.';
  } catch {
    if (current !== snapshot) return;
    setView('result');
    result.focus();
    result.select();
    byId('copy-help').hidden = false;
    status.textContent = 'Автокопирование недоступно. Результат выделен для ручного копирования.';
  }
});
// Clear values restored by form history or bfcache as well as a normal reload.
window.addEventListener('pageshow', clearAll);
window.addEventListener('pagehide', clearAll);
clearAll();
