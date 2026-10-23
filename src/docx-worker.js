importScripts('../vendor/mammoth/mammoth.browser.min.js');
self.onmessage = async ({ data }) => {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    if (result.value.length > 100000) throw new Error('Из файла извлечено больше 100 000 символов. Разделите документ на части.');
    self.postMessage({ text: result.value });
  } catch (error) { self.postMessage({ error: error.message || 'DOCX повреждён или защищён.' }); }
};
