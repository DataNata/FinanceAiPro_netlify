/**
 * Разбор TOML — того подмножества, что используется в config/*.toml:
 * [таблица], [a.b], [[массив таблиц]], key = значение, ключи без кавычек и в кавычках,
 * строки "…" и '…', числа, true/false, массивы (в т. ч. многострочные), встроенные таблицы { … }, комментарии #.
 * Работает в браузере, в Node (тесты, сборка) и в Deno (Edge Function).
 */

export function parseToml(text) {
  const root = {};
  let cur = root;
  const src = String(text).replace(/^﻿/, "");
  let i = 0;
  let line = 1;

  const fail = (msg) => { throw new Error(`TOML, строка ${line}: ${msg}`); };
  const peek = () => src[i];
  const skipWs = () => { while (i < src.length && (src[i] === " " || src[i] === "\t")) i++; };
  const skipComment = () => { if (src[i] === "#") while (i < src.length && src[i] !== "\n") i++; };
  const skipAll = () => {   // пробелы, переводы строк, комментарии (внутри массивов)
    for (;;) {
      skipWs(); skipComment();
      if (src[i] === "\r") { i++; continue; }
      if (src[i] === "\n") { i++; line++; continue; }
      break;
    }
  };

  function parseString() {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\n") fail("перевод строки внутри строки");
      if (q === '"' && src[i] === "\\") {
        const c = src[i + 1];
        const map = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", b: "\b", f: "\f" };
        if (c in map) { out += map[c]; i += 2; continue; }
        if (c === "u" || c === "U") {
          const n = c === "u" ? 4 : 8;
          out += String.fromCodePoint(parseInt(src.slice(i + 2, i + 2 + n), 16));
          i += 2 + n; continue;
        }
        fail("неизвестная escape-последовательность");
      }
      out += src[i++];
    }
    if (src[i] !== q) fail("строка не закрыта");
    i++;
    return out;
  }

  function parseKey() {
    skipWs();
    if (src[i] === '"' || src[i] === "'") return parseString();
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
    if (!m) fail("ожидается ключ");
    i += m[0].length;
    return m[0];
  }

  function parseDottedKey() {
    const parts = [parseKey()];
    skipWs();
    while (src[i] === ".") { i++; parts.push(parseKey()); skipWs(); }
    return parts;
  }

  function parseValue() {
    skipWs();
    const c = peek();
    if (c === '"' || c === "'") return parseString();
    if (c === "[") {
      i++;
      const arr = [];
      for (;;) {
        skipAll();
        if (src[i] === "]") { i++; return arr; }
        arr.push(parseValue());
        skipAll();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "]") { i++; return arr; }
        fail("ожидается , или ]");
      }
    }
    if (c === "{") {
      i++;
      const obj = {};
      skipWs();
      if (src[i] === "}") { i++; return obj; }
      for (;;) {
        const keys = parseDottedKey();
        skipWs();
        if (src[i] !== "=") fail("ожидается =");
        i++;
        setPath(obj, keys, parseValue());
        skipWs();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "}") { i++; return obj; }
        fail("ожидается , или }");
      }
    }
    const m = /^[^\s,\]\}#]+/.exec(src.slice(i));
    if (!m) fail("ожидается значение");
    i += m[0].length;
    const t = m[0];
    if (t === "true") return true;
    if (t === "false") return false;
    const n = t.replace(/_/g, "");
    if (/^[+-]?\d+$/.test(n)) return parseInt(n, 10);
    if (/^[+-]?(\d+\.\d+|\d+)([eE][+-]?\d+)?$/.test(n) || /^[+-]?\d+\.\d+$/.test(n)) return parseFloat(n);
    if (/^[+-]?inf$/.test(n)) return n.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(n)) return NaN;
    fail(`непонятное значение «${t}»`);
  }

  function setPath(obj, keys, value) {
    let o = obj;
    for (const k of keys.slice(0, -1)) {
      if (!(k in o)) o[k] = {};
      o = o[k];
    }
    const last = keys[keys.length - 1];
    if (last in o) fail(`повтор ключа «${keys.join(".")}»`);
    o[last] = value;
  }

  function table(keys, isArray) {
    let o = root;
    keys.forEach((k, idx) => {
      const lastKey = idx === keys.length - 1;
      if (lastKey && isArray) {
        if (!(k in o)) o[k] = [];
        if (!Array.isArray(o[k])) fail(`«${k}» — не массив таблиц`);
        const t = {};
        o[k].push(t);
        o = t;
        return;
      }
      if (!(k in o)) o[k] = {};
      o = Array.isArray(o[k]) ? o[k][o[k].length - 1] : o[k];
    });
    return o;
  }

  while (i < src.length) {
    skipWs(); skipComment();
    if (i >= src.length) break;
    const c = src[i];
    if (c === "\r") { i++; continue; }
    if (c === "\n") { i++; line++; continue; }
    if (c === "[") {
      const isArray = src[i + 1] === "[";
      i += isArray ? 2 : 1;
      const keys = parseDottedKey();
      if (src[i] !== "]" || (isArray && src[i + 1] !== "]")) fail("ожидается ]");
      i += isArray ? 2 : 1;
      cur = table(keys, isArray);
    } else {
      const keys = parseDottedKey();
      skipWs();
      if (src[i] !== "=") fail("ожидается =");
      i++;
      setPath(cur, keys, parseValue());
    }
    skipWs(); skipComment();
    if (i < src.length && src[i] !== "\n" && src[i] !== "\r") fail("лишние символы в конце строки");
  }
  return root;
}
