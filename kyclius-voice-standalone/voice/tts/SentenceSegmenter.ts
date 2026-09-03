/**
 * SentenceSegmenter (04 section 3): incremental, single-pass, runs in main on
 * the token stream. Boundaries: . ! ? ... followed by whitespace/end; hard
 * newlines; colon introducing a list item. Guarded non-boundaries:
 * abbreviations (Mr., e.g., vs.), decimal numbers (3.14), URLs kept as link
 * text, mid-sentence ellipses, single-letter initials. Length clamps: long
 * sentences split at clause punctuation; short ones attach to the next.
 * Markdown: fenced code blocks are held back (spoken prose only); inline code
 * and links reduce to their text.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc',
  'eg', 'ie', 'fig', 'approx', 'dept', 'est', 'no', 'inc', 'ltd',
]);
const MIN_CHARS = 40;
const MAX_CHARS = 280;

function isFalseDotBoundary(text: string, i: number): boolean {
  const prev = text[i - 1] ?? '';
  const next = text[i + 1] ?? '';
  // decimals: 3.14
  if (/\d/.test(prev) && /\d/.test(next)) return true;
  // mid-sentence ellipsis: ... or ...
  if (text.startsWith('...', i - 2)) return true;
  // single-letter initials: "A. Smith"
  if (/[A-Za-z]/.test(prev) && /\s/.test(next) && /(^|\s)[A-Za-z]$/.test(text.slice(0, i))) return true;
  // abbreviations: Mr. / e.g. / vs.
  const m = /([A-Za-z][A-Za-z.]*)$/.exec(text.slice(0, i));
  if (m && ABBREVIATIONS.has(m[1].toLowerCase().replace(/\./g, ''))) return true;
  return false;
}

export class SentenceSegmenter {
  private buffer = '';
  private held: string | null = null; // short sentence attached to the next one
  private inFence = false;

  push(token: string): string[] {
    // Fenced code blocks are held back entirely (rendered visually only).
    if (token.includes('```')) {
      const before = token.slice(0, token.indexOf('```'));
      this.inFence = !this.inFence;
      this.buffer += before;
      return this.drain(false);
    }
    if (this.inFence) return [];
    this.buffer += this.stripInline(token);
    return this.drain(false);
  }

  /** Emits the tail immediately on stream end. */
  flush(): string[] {
    return this.drain(true);
  }

  get pendingChars(): number {
    return this.buffer.length;
  }

  private stripInline(token: string): string {
    return token
      .replace(/`([^`]*)`/g, '$1')            // inline code -> text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // [text](url) -> text
  }

  private findBoundary(text: string): number {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') return i; // hard newline is a boundary
      if (ch === ':' && (text[i + 1] === '\n' || /^[\s][\-*\d]/.test(text.slice(i + 1, i + 3)))) return i;
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\u2026') {
        const next = text[i + 1];
        if (next === undefined || /\s/.test(next)) {
          if (ch === '.' && isFalseDotBoundary(text, i)) continue;
          return i;
        }
      }
    }
    return -1;
  }

  private drain(final: boolean): string[] {
    const raw: string[] = [];
    let idx = this.findBoundary(this.buffer);
    while (idx !== -1) {
      raw.push(this.buffer.slice(0, idx + 1).trim());
      this.buffer = this.buffer.slice(idx + 1);
      idx = this.findBoundary(this.buffer);
    }
    if (final && this.buffer.trim().length > 0) {
      raw.push(this.buffer.trim());
      this.buffer = '';
    }
    // Attach a previously held short fragment to the next sentence.
    if (this.held !== null && raw.length > 0) {
      raw[0] = `${this.held} ${raw[0]}`;
      this.held = null;
    } else if (this.held !== null && final) {
      raw.unshift(this.held);
      this.held = null;
    }
    // Length clamps.
    const out: string[] = [];
    for (const sentence of raw) out.push(...this.splitLong(sentence));
    // Backpressure rule: a too-short trailing fragment waits for more text.
    if (!final && out.length > 0 && out[out.length - 1].length < MIN_CHARS) {
      this.held = out.pop()!;
    }
    return out;
  }

  private splitLong(sentence: string): string[] {
    if (sentence.length <= MAX_CHARS) return [sentence];
    const window = sentence.slice(0, MAX_CHARS);
    const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' - '));
    if (cut < MIN_CHARS) return [sentence]; // cannot split safely; send as one
    const head = sentence.slice(0, cut + 1).trim();
    const tail = sentence.slice(cut + 1).trim();
    return [head, ...this.splitLong(tail)];
  }
}
