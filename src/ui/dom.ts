/** DOM 构造小工具 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
  fmt: (v: number) => string = (v) => v.toFixed(2)
): HTMLElement {
  const wrap = el('div', { class: 'ctrl' });
  const lab = el('label', {}, label);
  const val = el('span', { class: 'ctrl-val' }, fmt(value));
  lab.append(val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  wrap.append(lab, input);
  return wrap;
}

export function select(
  label: string,
  options: { value: string; text: string }[],
  value: string,
  onChange: (v: string) => void
): HTMLElement {
  const wrap = el('div', { class: 'ctrl' });
  const lab = el('label', {}, label);
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(lab, sel);
  return wrap;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function fmtLumens(lm: number): string {
  if (lm >= 1e6) return (lm / 1e6).toFixed(2) + ' Mlm';
  if (lm >= 1e3) return (lm / 1e3).toFixed(1) + ' klm';
  return lm.toFixed(0) + ' lm';
}
