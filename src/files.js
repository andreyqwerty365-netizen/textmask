const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 100000;
const MAX_PAGES = 30;
const local = path => new URL(path, import.meta.url).href;
export function validateFile(file) {
  if (!/\.(txt|md|docx|pdf|png|jpe?g)$/i.test(file.name)) throw new Error('Этот формат не поддерживается. Выберите TXT, MD, DOCX, PDF, PNG или JPEG.');
  if (!file.size) throw new Error('Файл пуст. Выберите другой файл.');
  if (file.size > MAX_BYTES) throw new Error('Файл больше 20 МиБ. Выберите файл меньшего размера.');
}
function checkedText(text) {
  if (text.length > MAX_TEXT) throw new Error('Из файла извлечено больше 100 000 символов. Разделите документ на части.');
  if (!text.trim()) throw new Error('В файле не найден текст. Для скана включите OCR всех страниц.');
  return text;
}
export function decodeText(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Текстовый файл должен иметь кодировку UTF-8. Пересохраните его в UTF-8.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('Файл не похож на обычный текст.');
  return checkedText(text);
}
export function downloadName(name = 'text') {
  return (name.replace(/\.(txt|md|docx|pdf|png|jpe?g)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100) || 'text') + '_masked.txt';
}
export function pdfText(items) {
  let output = '', previous = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (previous && !output.endsWith('\n')) {
      const lineChanged = Math.abs(item.transform[5] - previous.transform[5]) > Math.max(2, item.height * .5);
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      if (lineChanged) output += '\n';
      else if (gap > Math.max(1, item.height * .15)) output += ' ';
    }
    output += item.str + (item.hasEOL ? '\n' : '');
    previous = item;
  }
  return output.trimEnd();
}
function ensureScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = url;
    script.onload = resolve; script.onerror = () => reject(new Error('Не удалось открыть локальный модуль OCR.'));
    document.head.append(script);
  });
}
let ocrScript;
async function createOcr(signal, progress) {
  ocrScript ??= ensureScript(local('../vendor/tesseract/dist/tesseract.min.js')).catch(error => { ocrScript = null; throw error; });
  await ocrScript; signal?.throwIfAborted();
  progress('prepare', 'Подготовка распознавания русского и английского текста…');
  const worker = await globalThis.Tesseract.createWorker('rus+eng', 1, {
    workerPath: local('../vendor/tesseract/dist/worker.min.js'),
    corePath: local('../vendor/ocr-core/tesseract-core-lstm.wasm.js'),
    langPath: local('../vendor/tessdata/'), gzip: false, cacheMethod: 'none', workerBlobURL: false,
    logger: event => {
      if (event.status === 'recognizing text') {
        const percent = Math.max(0, Math.min(100, Math.round(event.progress * 100)));
        progress('recognize', `Распознавание текста: ${percent}%`, percent);
      } else if (event.status === 'loading language traineddata') progress('models', 'Чтение русской и английской моделей OCR…');
      else if (event.status === 'initializing api') progress('prepare', 'Подготовка языков распознавания…');
    },
  });
  try {
    signal?.throwIfAborted();
    progress('prepare', 'Подготовка распознавания технических обозначений…');
    // Tesseract reads user_words_file during initialization. Keep the word list
    // in its in-memory filesystem and reuse the models already loaded above.
    await worker.writeText('/textmask-words', 'IPv4\nIPv6\n');
    signal?.throwIfAborted();
    await worker.reinitialize('rus+eng', 1, { user_words_file: '/textmask-words' });
    signal?.throwIfAborted();
    return worker;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}
function docxText(buffer, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(local('./docx-worker.js'));
    const finish = (error, text) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate(); error ? reject(error) : resolve(text); };
    const cancel = () => finish(new DOMException('Чтение отменено', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Чтение DOCX заняло больше минуты. Проверьте файл.')), 60000);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.text);
    worker.onerror = () => finish(new Error('Не удалось прочитать DOCX. Файл может быть повреждён или защищён.'));
    worker.postMessage(buffer, [buffer]);
  });
}
export async function readDocument(file, { signal, onProgress = () => {}, forceOcr = false } = {}) {
  signal?.throwIfAborted(); validateFile(file);
  let pageNumber = 0, pageCount = 0;
  const progress = (stage, message, percent) => onProgress(message, { stage, page: pageNumber, pages: pageCount, percent });
  progress('read', 'Чтение файла…');
  const extension = file.name.split('.').at(-1).toLowerCase();
  const buffer = await file.arrayBuffer(); signal?.throwIfAborted();
  if (['txt', 'md'].includes(extension)) return { text: decodeText(buffer), ocr: false };
  if (extension === 'docx') {
    progress('extract', 'Извлечение текста DOCX…');
    const text = await docxText(buffer, signal); signal?.throwIfAborted();
    return { text: checkedText(text), ocr: false };
  }
  let ocr, task, pdf, usedOcr = false;
  const cancel = () => { ocr?.terminate(); task?.destroy(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    async function recognize(image) {
      ocr ??= await createOcr(signal, progress); signal?.throwIfAborted();
      usedOcr = true;
      progress('recognize', 'Распознавание текста: 0%', 0);
      const { data } = await ocr.recognize(image); signal?.throwIfAborted();
      return data.text;
    }
    if (['png', 'jpg', 'jpeg'].includes(extension)) { pageNumber = pageCount = 1; return { text: checkedText(await recognize(file)), ocr: true }; }
    progress('prepare', 'Открытие PDF…');
    const pdfjs = await import('../vendor/pdfjs/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = local('../vendor/pdfjs/build/pdf.worker.mjs');
    task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, cMapUrl: local('../vendor/pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: local('../vendor/pdfjs/standard_fonts/'), wasmUrl: local('../vendor/pdfjs/wasm/') });
    task.onPassword = () => { task.destroy(); };
    pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES) throw new Error('PDF содержит больше 30 страниц. Разделите его на части.');
    pageCount = pdf.numPages;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      signal?.throwIfAborted(); pageNumber = i; progress('extract', 'Чтение текстового слоя PDF…');
      const page = await pdf.getPage(i);
      let text = forceOcr ? '' : pdfText((await page.getTextContent()).items);
      if (!text.trim()) {
        progress('render', 'Подготовка страницы для OCR…');
        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(size.width, size.height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        text = await recognize(canvas); canvas.width = canvas.height = 0;
      }
      pages.push(text); if (pages.join('\n\n').length > MAX_TEXT) checkedText(pages.join('\n\n'));
      page.cleanup();
    }
    return { text: checkedText(pages.join('\n\n')), ocr: usedOcr };
  } catch (error) {
    signal?.throwIfAborted();
    if (/password|destroyed|Worker was destroyed/i.test(error.message)) throw new Error('PDF защищён паролем или чтение прервано. Выберите открытый PDF.');
    throw new Error(error.message || 'Не удалось прочитать документ.');
  } finally { signal?.removeEventListener('abort', cancel); await ocr?.terminate(); await task?.destroy(); }
}
