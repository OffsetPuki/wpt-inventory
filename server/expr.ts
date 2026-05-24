/**
 * Formula evaluator — hand-written recursive-descent parser.
 *
 * Grammar:
 *   expr       → term (('+' | '-') term)*
 *   term       → unary (('*' | '/') unary)*
 *   unary      → '-' unary | call
 *   call       → IDENT '(' args ')' | primary
 *   args       → expr (',' expr)*
 *   primary    → NUMBER | IDENT | '(' expr ')'
 *
 * Supported functions: ceil, floor, round, min, max, abs, sqrt
 * Identifiers are resolved case-insensitively from the params object.
 * Missing or non-numeric values resolve to 0.
 * Returns Math.max(0, round(result * 100) / 100).
 * Returns 1 on any parse error (safe fallback).
 */

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
};

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    // whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // number (integer or decimal)
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i++];
      }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }

    // identifier (letters, digits, underscores — must start with letter or _)
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        id += input[i++];
      }
      tokens.push({ type: "ident", value: id });
      continue;
    }

    // operators
    if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }

    // skip unknown characters
    i++;
  }
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos: number;
  private params: Record<string, any>;

  constructor(tokens: Token[], params: Record<string, any>) {
    this.tokens = tokens;
    this.pos = 0;
    this.params = params;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: string): Token {
    const t = this.advance();
    if (!t || t.type !== type) {
      throw new Error(`Expected ${type}, got ${t?.type ?? "EOF"}`);
    }
    return t;
  }

  parse(): number {
    const result = this.expr();
    if (this.pos < this.tokens.length) {
      throw new Error("Unexpected token after expression");
    }
    return result;
  }

  private expr(): number {
    let left = this.term();
    let t = this.peek();
    while (t && t.type === "op" && (t.value === "+" || t.value === "-")) {
      this.advance();
      const right = this.term();
      left = t.value === "+" ? left + right : left - right;
      t = this.peek();
    }
    return left;
  }

  private term(): number {
    let left = this.unary();
    let t = this.peek();
    while (t && t.type === "op" && (t.value === "*" || t.value === "/")) {
      this.advance();
      const right = this.unary();
      left = t.value === "*" ? left * right : right !== 0 ? left / right : 0;
      t = this.peek();
    }
    return left;
  }

  private unary(): number {
    const t = this.peek();
    if (t && t.type === "op" && t.value === "-") {
      this.advance();
      return -this.unary();
    }
    return this.call();
  }

  private call(): number {
    const t = this.peek();
    if (t?.type === "ident") {
      const name = t.value.toLowerCase();
      if (name in FUNCTIONS && this.tokens[this.pos + 1]?.type === "lparen") {
        this.advance(); // consume ident
        this.advance(); // consume lparen
        const args: number[] = [];
        if (this.peek()?.type !== "rparen") {
          args.push(this.expr());
          while (this.peek()?.type === "comma") {
            this.advance(); // consume comma
            args.push(this.expr());
          }
        }
        this.expect("rparen");
        return FUNCTIONS[name](...args);
      }
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.peek();

    if (t?.type === "number") {
      this.advance();
      return isNaN(t.value) ? 0 : t.value;
    }

    if (t?.type === "ident") {
      this.advance();
      // Case-insensitive lookup in params
      const lower = t.value.toLowerCase();
      for (const key of Object.keys(this.params)) {
        if (key.toLowerCase() === lower) {
          const v = this.params[key];
          const n = typeof v === "number" ? v : parseFloat(v);
          return isNaN(n) ? 0 : n;
        }
      }
      return 0; // missing identifier
    }

    if (t?.type === "lparen") {
      this.advance();
      const val = this.expr();
      this.expect("rparen");
      return val;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
}

/**
 * Evaluate a formula expression or return a plain number.
 *
 * @param formula - A number or a formula string (e.g. "ceil((length+width+height)*4/20)")
 * @param params  - A key-value map of variables
 * @returns The computed quantity, clamped to >= 0 and rounded to 2 decimals. Returns 1 on parse error.
 */
export function evalQty(
  formula: string | number,
  params: Record<string, any>
): number {
  // If it's already a plain number, just clamp and return
  if (typeof formula === "number") {
    return Math.max(0, Math.round(formula * 100) / 100);
  }

  // Try parsing as a plain number first
  const plain = parseFloat(formula);
  if (!isNaN(plain) && formula.trim() === String(plain)) {
    return Math.max(0, Math.round(plain * 100) / 100);
  }

  try {
    const tokens = tokenize(formula);
    if (tokens.length === 0) return 1;
    const parser = new Parser(tokens, params);
    const result = parser.parse();
    if (!isFinite(result)) return 1;
    return Math.max(0, Math.round(result * 100) / 100);
  } catch {
    return 1; // safe fallback on parse error
  }
}
