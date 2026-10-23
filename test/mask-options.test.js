import test from 'node:test';
import assert from 'node:assert/strict';
import { maskText } from '../src/mask.js';

test('ссылки и IPv4 обрабатываются только после включения', () => {
  const source = 'https://example.test/private 192.168.1.2';
  assert.equal(maskText(source).text, source);
  assert.equal(maskText(source, '', {url:true,ip:true}).text, '[URL_1] [IP_1]');
});
test('email и телефон можно выключить, ручные строки остаются', () => {
  assert.equal(maskText('a@example.test 89991234567 Секрет', 'Секрет', {email:false,phone:false}).text, 'a@example.test 89991234567 [TEXT_1]');
});
test('URL сохраняет пунктуацию, скобки пути и нормализует домен', () => {
  const source = '(https://EXAMPLE.test/a(b)), https://example.test/a(b)! www.example.test/a(b)';
  assert.equal(maskText(source,'',{url:true}).text, '([URL_1]), [URL_1]! [URL_2]');
});
test('путь URL чувствителен к регистру, некорректный URL не заменяется', () => {
  assert.equal(maskText('https://example.test/A https://example.test/a https://','',{url:true}).text, '[URL_1] [URL_2] https://');
});
test('IPv4 принимает октеты 0–255, не вырезает часть ошибочного адреса', () => {
  const source = '0.0.0.0, 255.255.255.255. 999.1.2.3 1.2.3.4.5 01.2.3.4 abc1.2.3.4';
  assert.equal(maskText(source,'',{ip:true}).text, '[IP_1], [IP_2]. 999.1.2.3 1.2.3.4.5 01.2.3.4 abc1.2.3.4');
});
test('ссылка перекрывает контакты и IPv4 целиком, повторы связываются', () => {
  const source = 'https://a@example.test/private https://192.168.1.2/x a@example.test 192.168.1.2';
  const result = maskText(source,'',{url:true,ip:true});
  assert.equal(result.text, '[URL_1] [URL_2] [URL_1] [URL_2]');
  assert.equal(result.counts.url,4);
  assert.equal(result.counts.ip,0);
});
test('URL/IP учитывают зарезервированные метки и точные позиции', () => {
  const source = '[URL_1] [IP_1] https://example.test 1.2.3.4';
  const result = maskText(source,'',{url:true,ip:true});
  assert.equal(result.text, '[URL_1] [IP_1] [URL_2] [IP_2]');
  assert.equal(source.slice(result.matches[0].start,result.matches[0].end),'https://example.test');
  assert.equal(result.counts.total,2);
});
test('неверный тип настроек отвергается явно', () => {
  for (const options of [null, [], 'email']) assert.throws(()=>maskText('x','',options),TypeError);
});
