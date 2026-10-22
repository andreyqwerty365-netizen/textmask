const PRIORITY = { email: 0, phone: 1, text: 2 };
const PREFIX = { email: 'EMAIL', phone: 'PHONE', text: 'TEXT' };
const MAX_MATCHES = 20000;

/** Pure transformation. No DOM, persistence, logging, or network. */
export function maskText(source, manual = '') {
  if (typeof source !== 'string' || typeof manual !== 'string') {
    throw new TypeError('Текст и дополнительные строки должны быть строками.');
  }
  if (source.length > 100000) throw new RangeError('Вставьте не больше 100 000 символов.');
  if (manual.length > 10000) throw new RangeError('Дополнительные строки: не больше 10 000 символов.');
  const literals = [...new Set(manual.split(/\r\n?|\n/).filter(line => line.trim() !== ''))];
  if (literals.length > 100) throw new RangeError('Добавьте не больше 100 строк.');

  const candidates = [];
  const parents = new Map();
  function add(start, end, type, value) {
    if (candidates.length >= MAX_MATCHES) throw new RangeError('Найдено больше 20 000 совпадений. Сократите текст или список строк.');
    const id = `${type}:${value}`;
    parents.set(id, parents.get(id) ?? id);
    candidates.push({ start, end, type, id });
  }
  const emails = /(?<![\p{L}\p{N}._%+'@-])[a-z0-9_%+'-]+(?:\.[a-z0-9_%+'-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?![\p{L}\p{N}_%+'@-])/giu;
  for (const match of source.matchAll(emails)) {
    add(match.index, match.index + match[0].length, 'email', match[0].toLowerCase());
  }
  const phones = /(?<![\p{L}\p{N}+])(?:\+7|8)[ \t\u00a0\u202f-]*(?:\(\d{3}\)|\d{3})[ \t\u00a0\u202f-]*\d{3}[ \t\u00a0\u202f-]*\d{2}[ \t\u00a0\u202f-]*\d{2}(?![\p{L}\p{N}])(?![ \t\u00a0\u202f-]*\d)/gu;
  for (const match of source.matchAll(phones)) {
    add(match.index, match.index + match[0].length, 'phone', `7${match[0].replace(/\D/g, '').slice(1)}`);
  }
  for (const literal of literals) {
    let start = source.indexOf(literal);
    while (start !== -1) {
      add(start, start + literal.length, 'text', literal);
      start = source.indexOf(literal, start + 1);
    }
  }

  function root(id) {
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current);
    while (parents.get(id) !== id) {
      const next = parents.get(id);
      parents.set(id, current);
      id = next;
    }
    return current;
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end || PRIORITY[a.type] - PRIORITY[b.type]);
  const components = [];
  for (const candidate of candidates) {
    const previous = components.at(-1);
    if (previous && candidate.start < previous.end) {
      previous.end = Math.max(previous.end, candidate.end);
      previous.size++;
      parents.set(root(candidate.id), root(previous.id));
    } else {
      components.push({ ...candidate, size: 1 });
    }
  }
  const groupTypes = new Map();
  for (const candidate of candidates) {
    const id = root(candidate.id);
    const type = groupTypes.get(id);
    if (!type || PRIORITY[candidate.type] < PRIORITY[type]) groupTypes.set(id, candidate.type);
  }
  const reserved = new Set(source.match(/\[(?:EMAIL|PHONE|TEXT)_\d+\]/g) ?? []);
  const tokens = new Map();
  const serial = { email: 0, phone: 0, text: 0 };
  const counts = { email: 0, phone: 0, text: 0, total: components.length, unique: 0 };
  const matches = [];
  const output = [];
  let cursor = 0;
  let merged = 0;
  for (const component of components) {
    const id = root(component.id);
    const type = groupTypes.get(id);
    if (!tokens.has(id)) {
      let token;
      do token = `[${PREFIX[type]}_${++serial[type]}]`; while (reserved.has(token));
      tokens.set(id, token);
    }
    const token = tokens.get(id);
    output.push(source.slice(cursor, component.start), token);
    matches.push({ start: component.start, end: component.end, type, token });
    counts[type]++;
    if (component.size > 1) merged++;
    cursor = component.end;
  }
  output.push(source.slice(cursor));
  counts.unique = tokens.size;
  return { text: output.join(''), matches, counts, merged };
}
