import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFile, decodeText, downloadName, pdfText, readDocument } from '../src/files.js';

test('принимаются TXT/MD/DOCX/PDF и PNG/JPEG, остальные форматы отклоняются', () => {
  for (const name of ['a.TXT','a.md','a.docx','a.pdf','a.png','a.jpg','a.jpeg']) assert.doesNotThrow(()=>validateFile({name,size:10}));
  assert.throws(()=>validateFile({name:'a.doc',size:10}), /формат/);
});
test('пустой файл и файл более 20 MiB отклоняются до чтения', () => {
  assert.throws(()=>validateFile({name:'a.pdf',size:0}), /пуст/);
  assert.throws(()=>validateFile({name:'a.pdf',size:20*1024*1024+1}), /20 М/);
});
test('UTF-8 BOM, кириллица и абзацы сохраняются', () => {
  assert.equal(decodeText(new TextEncoder().encode('\ufeffИван\n\nanna@example.test')), 'Иван\n\nanna@example.test');
  assert.throws(()=>decodeText(new Uint8Array([0xff,0xfe,0x61])), /UTF-8/);
  assert.throws(()=>decodeText(new Uint8Array([0,1,2])), /текст/);
});
test('извлечённый текст ограничен 100000 символами', () => {
  assert.throws(()=>decodeText(new TextEncoder().encode('x'.repeat(100001))), /100 000/);
});
test('имя результата всегда TXT, исходное расширение не переносится', () => {
  assert.equal(downloadName('Материалы.DOCX'), 'Материалы_masked.txt');
  assert.equal(downloadName('../a:secret.pdf'), '.._a_secret_masked.txt');
});
test('части PDF склеиваются по геометрии без разрыва email', () => {
  const item=(str,x,w,end=false)=>({str,transform:[10,0,0,10,x,100],width:w,height:10,hasEOL:end});
  assert.equal(pdfText([item('anna@',0,30),item('example.test',30,60,true),item('Next',0,20)]), 'anna@example.test\nNext');
});
test('чтение TXT возвращает текст без маскирования и не изменяет файл', async () => {
  const file=new File(['anna@example.test'], 'a.txt');
  assert.equal((await readDocument(file)).text, 'anna@example.test');
  assert.equal(await file.text(), 'anna@example.test');
});
test('отменённое чтение не возвращает частичный результат', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(readDocument(new File(['x'],'a.txt'),{signal:controller.signal}), {name:'AbortError'});
});
