// Only top-level assistant content is public. Tool arguments and reasoning stay private.
export class StructuredContentStream {
  constructor(onText = () => {}) { this.onText = onText; this.raw = ''; this.sent = ''; }
  feed(delta) {
    this.raw += delta;
    if (this.raw.length > 1_000_000) throw new Error('Model response exceeds the streaming limit.');
    let depth = 0, key = null, expectingKey = false, kind, content;
    const raw = this.raw;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') {
        let decoded = '', complete = false;
        for (i++; i < raw.length; i++) {
          if (raw[i] === '"') { complete = true; break; }
          if (raw[i] !== '\\') { decoded += raw[i]; continue; }
          if (i + 1 >= raw.length) break;
          const escape = raw[++i];
          if (escape === 'u') {
            if (!/^[0-9a-f]{4}$/i.test(raw.slice(i + 1, i + 5))) break;
            decoded += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4;
          } else {
            const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
            if (!(escape in escapes)) return;
            decoded += escapes[escape];
          }
        }
        if (depth === 1) {
          if (expectingKey) { if (complete) { key = decoded; expectingKey = false; } }
          else if (key === 'kind' && complete) kind = decoded;
          else if (key === 'content') content = decoded;
        }
      } else if (c === '{' || c === '[') { depth++; if (depth === 1) expectingKey = true; }
      else if (c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 1) { expectingKey = true; key = null; }
    }
    if (kind !== 'assistant' || content === undefined) return;
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
    if (!content.startsWith(this.sent)) throw new Error('Model changed already streamed text.');
    const next = content.slice(this.sent.length);
    if (next) { this.sent = content; this.onText(next); }
  }
}
