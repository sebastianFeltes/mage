import { Host } from "@extism/as-pdk";

export function abort(_m: string | null, _f: string | null, _l: u32, _c: u32): void {}

export function calc(): i32 {
  const raw = Host.inputString();
  const expr = extractString(raw, "expr");
  if (expr.length == 0) {
    Host.outputString('{"ok":false,"error":"expr vacío"}');
    return 1;
  }
  const p = new Parser(expr);
  const value = p.parse();
  if (p.err.length > 0) {
    Host.outputString('{"ok":false,"error":"' + esc(p.err) + '"}');
    return 1;
  }
  Host.outputString('{"ok":true,"value":' + f64ToStr(value) + "}");
  return 0;
}

export function json_validate(): i32 {
  const raw = Host.inputString();
  const json = extractString(raw, "json");
  const src = json.length > 0 ? json : raw;
  const s = new JsonScan(src);
  s.skip();
  if (!s.value()) {
    Host.outputString('{"ok":false,"error":"' + esc(s.err) + '"}');
    return 1;
  }
  s.skip();
  if (s.i < s.src.length) {
    Host.outputString('{"ok":false,"error":"trailing"}');
    return 1;
  }
  Host.outputString('{"ok":true}');
  return 0;
}

export function hash(): i32 {
  const raw = Host.inputString();
  const text = extractString(raw, "text");
  const src = text.length > 0 ? text : raw;
  let h: u64 = 14695981039346656037;
  for (let i = 0; i < src.length; i++) {
    h ^= <u64>src.charCodeAt(i);
    h *= 1099511628211;
  }
  Host.outputString('{"ok":true,"fnv1a":"' + u64hex(h) + '"}');
  return 0;
}

export function count_letter(): i32 {
  const raw = Host.inputString();
  const text = extractString(raw, "text");
  const letter = extractString(raw, "letter");
  if (text.length == 0 || letter.length == 0) {
    Host.outputString('{"ok":false,"error":"text/letter vacío"}');
    return 1;
  }
  const target = lowerChar(letter.charAt(0));
  let count: i32 = 0;
  for (let i = 0; i < text.length; i++) {
    if (lowerChar(text.charAt(i)) == target) count++;
  }
  Host.outputString('{"ok":true,"count":' + count.toString() + "}");
  return 0;
}

export function is_palindrome(): i32 {
  const raw = Host.inputString();
  const text = extractString(raw, "text");
  if (text.length == 0) {
    Host.outputString('{"ok":false,"error":"text vacío"}');
    return 1;
  }
  let norm = "";
  for (let i = 0; i < text.length; i++) {
    const c = lowerChar(text.charAt(i));
    if (isAlnum(c)) norm += c;
  }
  if (norm.length == 0) {
    Host.outputString('{"ok":false,"error":"sin alfanuméricos"}');
    return 1;
  }
  let left: i32 = 0;
  let right: i32 = norm.length - 1;
  let ok = true;
  while (left < right) {
    if (norm.charAt(left) != norm.charAt(right)) {
      ok = false;
      break;
    }
    left++;
    right--;
  }
  Host.outputString(
    '{"ok":true,"palindrome":' + (ok ? "true" : "false") + ',"normalized":"' + esc(norm) + '"}',
  );
  return 0;
}

export function next_prime(): i32 {
  const raw = Host.inputString();
  const minStr = extractString(raw, "min");
  const min = parseFloat(minStr.length > 0 ? minStr : "0");
  if (!isFinite(min)) {
    Host.outputString('{"ok":false,"error":"min inválido"}');
    return 1;
  }
  let n: i32 = <i32>Math.floor(min) + 1;
  if (n < 2) n = 2;
  while (n < 2000000) {
    if (isPrime(n)) {
      Host.outputString('{"ok":true,"prime":' + n.toString() + "}");
      return 0;
    }
    n++;
  }
  Host.outputString('{"ok":false,"error":"rango"}');
  return 1;
}

function lowerChar(c: string): string {
  const code = c.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
  return c;
}

function isAlnum(c: string): bool {
  const code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function isPrime(n: i32): bool {
  if (n < 2) return false;
  if (n == 2) return true;
  if (n % 2 == 0) return false;
  let i: i32 = 3;
  while (i * i <= n) {
    if (n % i == 0) return false;
    i += 2;
  }
  return true;
}

function extractString(raw: string, key: string): string {
  const needle = '"' + key + '"';
  const at = raw.indexOf(needle);
  if (at < 0) return "";
  let i = at + needle.length;
  while (i < raw.length && (raw.charCodeAt(i) == 32 || raw.charCodeAt(i) == 9 || raw.charCodeAt(i) == 58)) {
    i++;
  }
  if (i >= raw.length || raw.charCodeAt(i) != 34) return "";
  i++;
  let out = "";
  while (i < raw.length) {
    const c = raw.charCodeAt(i);
    if (c == 34) break;
    if (c == 92 && i + 1 < raw.length) {
      i++;
      out += raw.charAt(i);
    } else {
      out += raw.charAt(i);
    }
    i++;
  }
  return out;
}

function esc(s: string): string {
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c == 34) o += '\\"';
    else if (c == 92) o += "\\\\";
    else if (c == 10) o += "\\n";
    else o += s.charAt(i);
  }
  return o;
}

function f64ToStr(n: f64): string {
  if (!isFinite(n)) return "null";
  return n.toString();
}

function u64hex(n: u64): string {
  const hex = "0123456789abcdef";
  let o = "";
  for (let i: i32 = 0; i < 16; i++) {
    const shift: u64 = <u64>(60 - i * 4);
    const nib = <i32>((n >> shift) & 0xf);
    o += hex.charAt(nib);
  }
  return o;
}

class Parser {
  src: string;
  i: i32;
  err: string;

  constructor(src: string) {
    this.src = src;
    this.i = 0;
    this.err = "";
  }

  parse(): f64 {
    const v = this.expr();
    this.skip();
    if (this.i < this.src.length && this.err.length == 0) this.err = "trailing";
    return v;
  }

  expr(): f64 {
    let v = this.term();
    while (this.err.length == 0) {
      this.skip();
      const c = this.peek();
      if (c == 43) {
        this.i++;
        v = v + this.term();
      } else if (c == 45) {
        this.i++;
        v = v - this.term();
      } else break;
    }
    return v;
  }

  term(): f64 {
    let v = this.unary();
    while (this.err.length == 0) {
      this.skip();
      const c = this.peek();
      if (c == 42) {
        this.i++;
        v = v * this.unary();
      } else if (c == 47) {
        this.i++;
        const d = this.unary();
        if (d == 0) {
          this.err = "div0";
          return 0;
        }
        v = v / d;
      } else break;
    }
    return v;
  }

  unary(): f64 {
    this.skip();
    if (this.peek() == 45) {
      this.i++;
      return -this.unary();
    }
    if (this.peek() == 40) {
      this.i++;
      const v = this.expr();
      this.skip();
      if (this.peek() != 41) {
        this.err = "paren";
        return 0;
      }
      this.i++;
      return v;
    }
    if (this.starts("sqrt")) {
      this.i += 4;
      this.skip();
      if (this.peek() != 40) {
        this.err = "sqrt(";
        return 0;
      }
      this.i++;
      const v = this.expr();
      this.skip();
      if (this.peek() != 41) {
        this.err = "sqrt)";
        return 0;
      }
      this.i++;
      if (v < 0) {
        this.err = "sqrt<0";
        return 0;
      }
      return Math.sqrt(v);
    }
    return this.number();
  }

  number(): f64 {
    this.skip();
    const start = this.i;
    if (this.peek() == 46 || (this.peek() >= 48 && this.peek() <= 57)) {
      if (this.peek() != 46) {
        while (this.peek() >= 48 && this.peek() <= 57) this.i++;
      }
      if (this.peek() == 46) {
        this.i++;
        while (this.peek() >= 48 && this.peek() <= 57) this.i++;
      }
      if (this.peek() == 101 || this.peek() == 69) {
        this.i++;
        if (this.peek() == 43 || this.peek() == 45) this.i++;
        while (this.peek() >= 48 && this.peek() <= 57) this.i++;
      }
      return parseFloat(this.src.substring(start, this.i));
    }
    this.err = "num";
    return 0;
  }

  skip(): void {
    while (
      this.peek() == 32 ||
      this.peek() == 9 ||
      this.peek() == 10 ||
      this.peek() == 13
    ) {
      this.i++;
    }
  }

  peek(): i32 {
    if (this.i >= this.src.length) return 0;
    return this.src.charCodeAt(this.i);
  }

  starts(s: string): bool {
    if (this.i + s.length > this.src.length) return false;
    return this.src.substring(this.i, this.i + s.length) == s;
  }
}

class JsonScan {
  src: string;
  i: i32;
  err: string;

  constructor(src: string) {
    this.src = src;
    this.i = 0;
    this.err = "json";
  }

  skip(): void {
    while (
      this.peek() == 32 ||
      this.peek() == 9 ||
      this.peek() == 10 ||
      this.peek() == 13
    ) {
      this.i++;
    }
  }

  peek(): i32 {
    if (this.i >= this.src.length) return 0;
    return this.src.charCodeAt(this.i);
  }

  value(): bool {
    this.skip();
    const c = this.peek();
    if (c == 123) return this.object();
    if (c == 91) return this.array();
    if (c == 34) return this.string();
    if (c == 116) return this.lit("true");
    if (c == 102) return this.lit("false");
    if (c == 110) return this.lit("null");
    if (c == 45 || (c >= 48 && c <= 57)) return this.num();
    this.err = "value";
    return false;
  }

  object(): bool {
    this.i++;
    this.skip();
    if (this.peek() == 125) {
      this.i++;
      return true;
    }
    while (true) {
      this.skip();
      if (!this.string()) return false;
      this.skip();
      if (this.peek() != 58) {
        this.err = ":";
        return false;
      }
      this.i++;
      if (!this.value()) return false;
      this.skip();
      if (this.peek() == 44) {
        this.i++;
        continue;
      }
      if (this.peek() == 125) {
        this.i++;
        return true;
      }
      this.err = "}";
      return false;
    }
  }

  array(): bool {
    this.i++;
    this.skip();
    if (this.peek() == 93) {
      this.i++;
      return true;
    }
    while (true) {
      if (!this.value()) return false;
      this.skip();
      if (this.peek() == 44) {
        this.i++;
        continue;
      }
      if (this.peek() == 93) {
        this.i++;
        return true;
      }
      this.err = "]";
      return false;
    }
  }

  string(): bool {
    if (this.peek() != 34) {
      this.err = '"';
      return false;
    }
    this.i++;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (c == 34) {
        this.i++;
        return true;
      }
      if (c == 92) {
        this.i++;
        if (this.i >= this.src.length) {
          this.err = "esc";
          return false;
        }
      }
      this.i++;
    }
    this.err = "unterminated";
    return false;
  }

  num(): bool {
    if (this.peek() == 45) this.i++;
    if (this.peek() < 48 || this.peek() > 57) {
      this.err = "num";
      return false;
    }
    while (this.peek() >= 48 && this.peek() <= 57) this.i++;
    if (this.peek() == 46) {
      this.i++;
      while (this.peek() >= 48 && this.peek() <= 57) this.i++;
    }
    if (this.peek() == 101 || this.peek() == 69) {
      this.i++;
      if (this.peek() == 43 || this.peek() == 45) this.i++;
      while (this.peek() >= 48 && this.peek() <= 57) this.i++;
    }
    return true;
  }

  lit(s: string): bool {
    if (this.src.substring(this.i, this.i + s.length) != s) {
      this.err = s;
      return false;
    }
    this.i += s.length;
    return true;
  }
}
