import test from 'node:test';
import assert from 'node:assert/strict';
import { maskText } from '../src/mask.js';

test('пустой ввод возвращает пустой результат и нулевые счётчики', () => {
  assert.deepEqual(maskText(''), { text: '', matches: [], counts: { email: 0, phone: 0, text: 0, total: 0, unique: 0 }, merged: 0 });
});
test('пробелы и текст без совпадений сохраняются буквально', () => {
  assert.equal(maskText('  Привет\nмир!\t').text, '  Привет\nмир!\t');
});
test('email с плюсом и точками заменяется целиком, пунктуация остаётся', () => {
  assert.equal(maskText('Почта: one.two+tag@sub.example.test.').text, 'Почта: [EMAIL_1].');
});
test('апостроф в email скрывается вместе с полной локальной частью', () => {
  assert.equal(maskText("o'connor@example.test").text, '[EMAIL_1]');
});
test('повторы email в разном регистре получают один токен', () => {
  const result = maskText('A@example.test a@EXAMPLE.test b@example.test');
  assert.equal(result.text, '[EMAIL_1] [EMAIL_1] [EMAIL_2]');
  assert.equal(result.counts.email, 3);
  assert.equal(result.counts.unique, 2);
});
test('разные форматы российского телефона имеют одну идентичность', () => {
  const formats = ['+7 (999) 123-45-67', '8 999 123 45 67', '+79991234567', '89991234567', '8-999-123-45-67', '+7\u00a0999\u202f123 45 67', '+7(999)1234567'];
  assert.equal(maskText(formats.join('; ')).text, formats.map(() => '[PHONE_1]').join('; '));
});
test('разные телефоны нумеруются по первому появлению', () => {
  assert.equal(maskText('8 (999) 000-00-01, +7 (999) 000-00-02').text, '[PHONE_1], [PHONE_2]');
});
test('неполный номер, международный номер и фрагмент длинного номера не распознаются', () => {
  const text = '+7 999 123-45; +1 202 555 0123; 189991234567; +799912345678; abc89991234567';
  assert.equal(maskText(text).text, text);
});
test('невалидные email не распознаются частично', () => {
  const text = 'bad..name@example.test name@-example.test name@example.c имя@example.test';
  assert.equal(maskText(text).text, text);
});
test('точные строки с regexp-символами трактуются как литералы', () => {
  assert.equal(maskText('C++ [a-z].*? C++ [a-z].*?', 'C++\n[a-z].*?').text, '[TEXT_1] [TEXT_2] [TEXT_1] [TEXT_2]');
});
test('регистр ручных строк значим, пустые и повторные строки игнорируются', () => {
  assert.equal(maskText('Проект проект Проект', '\nПроект\nПроект\r\n').text, '[TEXT_1] проект [TEXT_1]');
});
test('пробелы внутри непустой ручной строки значимы', () => {
  assert.equal(maskText('x код y; код', ' код ').text, 'x[TEXT_1]y; код');
});
test('вложенные ручные строки не оставляют хвосты полного совпадения', () => {
  assert.equal(maskText('Альфа Бета / Альфа', 'Альфа\nАльфа Бета').text, '[TEXT_1] / [TEXT_1]');
});
test('цепочка пересечений закрывается целиком, соседние совпадения не объединяются', () => {
  assert.equal(maskText('abcdef / xy', 'abc\ncde\ndef\nx\ny').text, '[TEXT_1] / [TEXT_2][TEXT_3]');
});
test('ручная строка внутри email не оставляет открытый домен', () => {
  assert.equal(maskText('anna@example.test anna', 'anna').text, '[EMAIL_1] [EMAIL_1]');
});
test('ручная строка за границей контакта также закрывается целиком', () => {
  assert.equal(maskText('a@example.test хвост; a@example.test', '.test хвост').text, '[EMAIL_1]; [EMAIL_1]');
});
test('мост между контактами объединяет идентичности во всех повторах', () => {
  const result = maskText('a@example.test +79991234567 / 89991234567 / a@example.test', '.test +7999');
  assert.equal(result.text, '[EMAIL_1] / [EMAIL_1] / [EMAIL_1]');
  assert.equal(result.counts.unique, 1);
  assert.equal(result.merged, 1);
});
test('результат содержит точные непересекающиеся позиции исходника', () => {
  const source = 'До a@example.test и 89991234567 после';
  const result = maskText(source);
  assert.equal(result.matches.length, 2);
  assert.equal(source.slice(result.matches[0].start, result.matches[0].end), 'a@example.test');
  assert.ok(result.matches[0].end <= result.matches[1].start);
  assert.equal(result.counts.total, 2);
});
test('уже присутствующие токены не занимают создаваемые номера', () => {
  assert.equal(maskText('[EMAIL_1] a@example.test a@example.test').text, '[EMAIL_1] [EMAIL_2] [EMAIL_2]');
});
test('HTML остаётся обычным текстом', () => {
  assert.equal(maskText('<script>alert(1)</script> x@example.test').text, '<script>alert(1)</script> [EMAIL_1]');
});
test('некорректные типы и превышение ограничений дают явную ошибку', () => {
  assert.throws(() => maskText(null), TypeError);
  assert.throws(() => maskText('a', []), TypeError);
  assert.throws(() => maskText('a'.repeat(100001)), /100 000/);
  assert.throws(() => maskText('a', Array.from({ length: 101 }, (_, i) => `строка ${i}`).join('\n')), /100 строк/);
  assert.throws(() => maskText('a', 'a'.repeat(10001)), /10 000/);
});
test('чрезмерное число совпадений прерывается явной ошибкой', () => {
  assert.throws(() => maskText('a'.repeat(20001), 'a'), /20 000/);
});
