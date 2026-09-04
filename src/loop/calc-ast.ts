type Op = "+" | "-" | "*" | "/";

type Tok =
  | { kind: "num" }
  | { kind: "op"; op: Op }
  | { kind: "lparen" }
  | { kind: "rparen" };

const NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/;

const tokenize = (src: string): Tok[] | null => {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (c === "+" || c === "*" || c === "/" || c === "-") {
      tokens.push({ kind: "op", op: c });
      i += 1;
      continue;
    }
    if (c === "." || (c >= "0" && c <= "9")) {
      const m = NUMBER_RE.exec(src.slice(i));
      if (!m) return null;
      const lexed = m[0];
      const next = src[i + lexed.length];
      if (next === "." || next === "e" || next === "E" || (next !== undefined && next >= "0" && next <= "9")) {
        return null;
      }
      tokens.push({ kind: "num" });
      i += lexed.length;
      continue;
    }
    return null;
  }
  return tokens;
};

class Parser {
  constructor(
    private readonly tokens: Tok[],
    private i = 0,
  ) {}

  peek(): Tok | undefined {
    return this.tokens[this.i];
  }

  take(): Tok | undefined {
    return this.tokens[this.i++];
  }

  parseAll(): boolean {
    if (this.tokens.length === 0) return false;
    if (!this.expr()) return false;
    return this.i === this.tokens.length;
  }

  private expr(): boolean {
    if (!this.term()) return false;
    for (;;) {
      const t = this.peek();
      if (t?.kind !== "op" || (t.op !== "+" && t.op !== "-")) break;
      this.take();
      if (!this.term()) return false;
    }
    return true;
  }

  private term(): boolean {
    if (!this.unary()) return false;
    for (;;) {
      const t = this.peek();
      if (t?.kind !== "op" || (t.op !== "*" && t.op !== "/")) break;
      this.take();
      if (!this.unary()) return false;
    }
    return true;
  }

  private unary(): boolean {
    const t = this.peek();
    if (t?.kind === "op" && t.op === "-") {
      this.take();
      return this.unary();
    }
    return this.primary();
  }

  private primary(): boolean {
    const t = this.peek();
    if (t?.kind === "num") {
      this.take();
      return true;
    }
    if (t?.kind === "lparen") {
      this.take();
      if (!this.expr()) return false;
      if (this.peek()?.kind !== "rparen") return false;
      this.take();
      return true;
    }
    return false;
  }
}

/** True si `src` es una expresión aritmética completa (sin tokens sobrantes). */
export const isCompleteCalcExpr = (src: string): boolean => {
  const tokens = tokenize(src);
  if (!tokens) return false;
  if (tokens.length === 1 && tokens[0]?.kind === "num") return false;
  return new Parser(tokens).parseAll();
};
