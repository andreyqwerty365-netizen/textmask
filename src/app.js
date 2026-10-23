import { maskText } from './mask.js';
import { DEMO_TEXT, DEMO_MANUAL } from './demo.js';
import { readDocument, downloadName } from './files.js';

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
let fileController = null;
let fileRevision = 0;
let originName = '';
const maskTypes = ['email', 'phone', 'url', 'ip', 'text'];
let previewMarks = [], reviewGroups = [], reviewIndex = -1, reviewPage = 0;
const REVIEW_PAGE_SIZE = 20;

function cancelFile() {
  fileRevision++;
  fileController?.abort();
  fileController = null;
  byId('file-progress').hidden = true;
  byId('open-file').disabled = false;
  byId('choose-file').disabled = false;
  byId('mask').disabled = false;
  byId('drop-zone').classList.remove('dragging');
}

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
  byId('drop-zone').classList.toggle('has-source', source.value !== '');
  byId('source-length').textContent = `${source.value.length.toLocaleString('ru-RU')} / 100 000 символов`;
  const rules = new Set(manual.value.split(/\r\n?|\n/).filter(line => line.trim() !== '')).size;
  byId('rule-count').textContent = String(rules);
  byId('manual-length').textContent = `${manual.value.length.toLocaleString('ru-RU')} / 10 000 символов · строк: ${rules} / 100`;
}

function resetResult() {
  current = null;
  result.value = '';
  copy.disabled = true;
  byId('download').disabled = true;
  source.hidden = false;
  byId('copy-help').hidden = true;
  byId('source-preview').hidden = true;
  byId('source-preview').replaceChildren();
  byId('edit-source').hidden = true;
  byId('replacement-summary').hidden = true;
  byId('merge-note').hidden = true;
  byId('review-note').hidden = true;
  byId('review-details').hidden = true;
  byId('review-details').open = false;
  byId('review-nav').hidden = true;
  byId('review-list').replaceChildren();
  previewMarks = []; reviewGroups = []; reviewIndex = -1; reviewPage = 0;
  byId('source-mode').textContent = 'Обычный текст';
  error.hidden = true;
  source.removeAttribute('aria-invalid');
  manual.removeAttribute('aria-invalid');
  badge.textContent = source.value !== '' || manual.value !== '' ? 'Нужно обновить' : 'Ожидает текст';
  badge.classList.remove('ready');
  for (const type of maskTypes) byId(`count-${type}`).textContent = '0';
  byId('summary').textContent = 'Нажмите «Маскировать», чтобы получить актуальный результат.';
  updateInputMeta();
}

function clearAll() {
  cancelFile();
  originName = '';
  byId('file-input').value = '';
  byId('file-info').hidden = true;
  byId('file-info').textContent = '';
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
  for (const [index, match] of current.matches.entries()) {
    fragment.append(document.createTextNode(source.value.slice(cursor, match.start)));
    const mark = document.createElement('mark');
    mark.className = match.type;
    mark.textContent = source.value.slice(match.start, match.end);
    mark.tabIndex = -1;
    previewMarks.push(mark);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'token-label';
    label.textContent = match.token;
    label.setAttribute('aria-label', `${match.token}: показать замену ${index + 1}`);
    label.addEventListener('click', () => selectMatch(index));
    fragment.append(mark, label);
    cursor = match.end;
  }
  fragment.append(document.createTextNode(source.value.slice(cursor)));
  byId('source-preview').replaceChildren(fragment);
  byId('source-preview').hidden = false;
  source.hidden = true;
  byId('edit-source').hidden = false;
  byId('source-mode').textContent = 'Фрагмент → метка';
  const groups = new Map();
  for (const [index, match] of current.matches.entries()) {
    if (!groups.has(match.token)) groups.set(match.token, { token: match.token, index, count: 0 });
    groups.get(match.token).count++;
  }
  reviewGroups = [...groups.values()];
  byId('review-total').textContent = `· ${current.counts.total}`;
  byId('review-details').hidden = !reviewGroups.length;
  byId('review-nav').hidden = !reviewGroups.length;
  byId('review-position').textContent = `Замен: ${current.counts.total}. Выберите метку`;
  byId('review-prev').disabled = byId('review-next').disabled = !reviewGroups.length;
  renderReviewPage();
}

function renderReviewPage() {
  const nodes = [];
  for (const group of reviewGroups.slice(reviewPage * REVIEW_PAGE_SIZE, (reviewPage + 1) * REVIEW_PAGE_SIZE)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'review-row';
    const token = document.createElement('span'); token.className = 'review-token'; token.textContent = group.token;
    const text = document.createElement('span'); text.className = 'review-original';
    const match = current.matches[group.index];
    const value = source.value.slice(match.start, match.end);
    text.textContent = value.length > 100 ? `${value.slice(0, 100)}…` : value;
    const count = document.createElement('span'); count.className = 'review-count'; count.textContent = `×${group.count}`;
    button.setAttribute('aria-pressed', String(reviewIndex >= 0 && current.matches[reviewIndex].token === group.token));
    button.append(token, text, count); button.addEventListener('click', () => selectMatch(group.index)); nodes.push(button);
  }
  byId('review-list').replaceChildren(...nodes);
  const pageCount = Math.ceil(reviewGroups.length / REVIEW_PAGE_SIZE);
  byId('review-pages').hidden = pageCount <= 1;
  byId('review-page-prev').disabled = reviewPage === 0;
  byId('review-page-next').disabled = reviewPage + 1 >= pageCount;
  byId('review-page-label').textContent = `${reviewPage + 1} / ${pageCount}`;
}

function selectMatch(index) {
  if (!current?.matches.length) return;
  reviewIndex = (index + current.matches.length) % current.matches.length;
  const selected = current.matches[reviewIndex];
  setView('source'); source.hidden = true;
  byId('source-preview').hidden = false; byId('edit-source').hidden = false;
  for (const [i, mark] of previewMarks.entries()) {
    mark.classList.toggle('selected', i === reviewIndex);
    mark.classList.toggle('related', current.matches[i].token === selected.token);
  }
  byId('review-position').textContent = `Замена ${reviewIndex + 1} из ${current.matches.length} · ${selected.token}`;
  let delta = 0;
  for (const match of current.matches.slice(0, reviewIndex)) delta += match.token.length - (match.end - match.start);
  result.setSelectionRange(selected.start + delta, selected.start + delta + selected.token.length);
  renderReviewPage();
  previewMarks[reviewIndex].scrollIntoView({ block: 'nearest' });
  previewMarks[reviewIndex].focus({ preventScroll: true });
}
byId('review-next').addEventListener('click', () => selectMatch(reviewIndex + 1));
byId('review-prev').addEventListener('click', () => selectMatch(reviewIndex < 0 ? (current?.matches.length ?? 0) - 1 : reviewIndex - 1));
for (const [id, step] of [['review-page-prev', -1], ['review-page-next', 1]]) byId(id).addEventListener('click', () => {
  if (!current || reviewPage + step < 0 || (reviewPage + step) * REVIEW_PAGE_SIZE >= reviewGroups.length) return;
  reviewPage += step; renderReviewPage();
});

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
    current = maskText(source.value, manual.value, Object.fromEntries(maskTypes.filter(type => type !== 'text').map(type => [type, byId(`mask-${type}`).checked])));
  } catch (problem) {
    const field = source.value.length > 100000 || problem.message.includes('20 000') ? source : manual;
    showError(problem.message, field);
    return;
  }
  result.value = current.text;
  result.scrollTop = 0;
  for (const type of maskTypes) byId(`count-${type}`).textContent = current.counts[type];
  byId('replacement-summary').hidden = false;
  byId('summary').textContent = `Замен: ${current.counts.total} · уникальных меток: ${current.counts.unique}`;
  byId('merge-note').hidden = current.merged === 0;
  byId('merge-note').textContent = `Объединённых фрагментов: ${current.merged}. Пересечения скрыты целиком; связанные повторы получают общую метку. Приоритет: ссылка → email → телефон → IPv4 → строка.`;
  byId('review-note').hidden = false;
  badge.textContent = 'Готов к проверке';
  badge.classList.add('ready');
  copy.disabled = false;
  byId('download').disabled = false;
  renderPreview();
  setView('result');
  if (viewport.matches) byId('result-tab').focus();
  else if (sourceHadFocus) result.focus();
  status.textContent = current.counts.total ? `Замен: ${current.counts.total}. Результат готов к проверке.` : 'Совпадений не найдено. Текст сохранён без изменений; проверьте его вручную.';
}

byId('mask-form').addEventListener('submit', event => { event.preventDefault(); transform(); });
for (const type of maskTypes.filter(type => type !== 'text')) byId(`mask-${type}`).addEventListener('change', () => {
  resetResult(); status.textContent = 'Правила изменены. Нажмите «Маскировать», чтобы обновить результат.';
});
for (const field of [source, manual]) field.addEventListener('input', () => {
  if (fileController) cancelFile();
  resetResult();
  status.textContent = 'Текст или правила изменены. Нажмите «Маскировать», чтобы обновить результат.';
});
byId('demo').addEventListener('click', () => {
  if (source.value !== '' || manual.value !== '') return;
  if (fileController) cancelFile();
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
  if (fileController) return;
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); transform(); }
});
byId('open-file').addEventListener('click', () => byId('file-input').click());
byId('choose-file').addEventListener('click', () => byId('file-input').click());
byId('cancel-file').addEventListener('click', () => {
  cancelFile(); status.textContent = 'Чтение отменено. Исходный текст и правила сохранены.';
});
byId('file-input').addEventListener('change', () => {
  const file = byId('file-input').files?.[0];
  byId('file-input').value = '';
  return openFile(file);
});
let dragDepth = 0;
byId('drop-zone').addEventListener('dragenter', event => {
  event.preventDefault(); dragDepth++; byId('drop-zone').classList.add('dragging');
});
byId('drop-zone').addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
byId('drop-zone').addEventListener('dragleave', event => {
  event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; byId('drop-zone').classList.remove('dragging'); }
});
byId('drop-zone').addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; byId('drop-zone').classList.remove('dragging');
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  if (files.length !== 1) { showError('Выберите один файл за раз. Текущий исходник сохранён.', source); return; }
  return openFile(files[0]);
});
// Prevent the browser from navigating away and losing the editor on an off-target file drop.
document.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault(); });
async function openFile(file) {
  if (!file) return;
  if (source.value !== '' && !window.confirm('Заменить исходный текст содержимым файла? Дополнительные правила сохранятся.')) return;
  cancelFile();
  const revision = fileRevision;
  fileController = new AbortController();
  const controller = fileController;
  resetResult(); setView('source');
  status.textContent = 'Чтение документа. Дождитесь завершения или отмените чтение.';
  byId('file-progress').hidden = false;
  byId('open-file').disabled = true;
  byId('choose-file').disabled = true;
  byId('mask').disabled = true;
  try {
    const loaded = await readDocument(file, { signal: controller.signal, forceOcr: byId('force-ocr').checked, onProgress: (message, detail = {}) => {
      if (revision !== fileRevision) return;
      byId('file-status').textContent = message;
      byId('file-context').textContent = `${file.name}${detail.page ? ` · страница ${detail.page} из ${detail.pages}` : ''}`;
      if (Number.isFinite(detail.percent)) byId('file-meter').setAttribute('value', String(detail.percent));
      else byId('file-meter').removeAttribute('value');
    } });
    if (revision !== fileRevision) return;
    source.value = loaded.text; originName = file.name;
    resetResult();
    byId('file-info').textContent = `Файл: ${file.name} · ${loaded.ocr ? 'OCR: проверьте распознавание.' : 'Текст извлечён.'}`;
    byId('file-info').hidden = false;
    status.textContent = 'Файл прочитан. Проверьте текст, добавьте правила и нажмите «Маскировать».';
    source.focus(); source.setSelectionRange(0, 0); source.scrollTop = 0;
  } catch (problem) {
    if (revision !== fileRevision || problem.name === 'AbortError') return;
    showError(`Не удалось открыть файл. ${problem.message}`, source);
  } finally {
    if (revision === fileRevision) cancelFile();
  }
}
byId('download').addEventListener('click', () => {
  if (!current || !result.value || fileController) return;
  const url = URL.createObjectURL(new Blob([current.text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = downloadName(originName || 'text');
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Подготовлен обработанный TXT-файл.';
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
