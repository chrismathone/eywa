/* 시각화 공통 기반.
   원칙: 차트는 칸의 실제 크기(CSS px)를 받아 그 크기 그대로 다시 그린다. viewBox와 화면이 1:1이라
   폭이 변해도 원·글자가 늘어나지 않는다. 모든 표식은 같은 scale 함수에서 좌표를 얻고, 배경 이미지는 쓰지 않는다. */
export const V = {};

V.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
V.fmt = (n) => Number(n).toLocaleString('ko-KR');
V.px = (v) => Math.round(v * 100) / 100;
V.signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
/* 금액 표기는 실제 운영실 chartMoney와 같은 규칙: 1억 이상은 억, 1만 이상은 만. */
V.money = (n) => {
  const a = Math.abs(n);
  const [scale, unit] = a >= 1e8 ? [1e8, '억'] : a >= 1e4 ? [1e4, '만'] : [1, '원'];
  return `${(n / scale).toLocaleString('ko-KR', { maximumFractionDigits: unit === '억' ? 2 : 0 })}${unit}`;
};
V.minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

V.linear = (d0, d1, r0, r1) => {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const scale = (v) => r0 + (v - d0) * k;
  scale.k = k;
  return scale;
};

/* 1·2·2.5·5 배수로 떨어지는 축 눈금. 건수·인원에 소수 눈금이 나오지 않게 정수만 쓴다. */
V.ticks = (min, max, count = 3) => {
  const raw = (max - min || 1) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && (Number.isInteger(s) || raw < 0.5));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
};

/* 합이 총폭과 정확히 맞도록 누적값을 반올림한 경계. 이음매에 틈이나 겹침이 생기지 않는다. */
V.edges = (values, total, x0, width) => {
  let run = 0;
  const out = [Math.round(x0)];
  values.forEach((v) => { run += v; out.push(Math.round(x0 + (total > 0 ? run / total : 0) * width)); }); // 합계 0인 줄(학생 0명) = 0÷0 NaN 방지
  return out;
};

/* 글자는 측정한 뒤 배치한다. 크기·굵기는 style.css의 .t-* 와 같은 값이다. */
/* 시안: 앱 글자 단계와 통일 — 차트 글자도 xs(14) 바닥 · 큰 숫자는 lg(20). instruments.css의 .t-* 와 같은 값. */
const TYPE = {
  axis: [14, 500], label: [14, 500], strong: [14, 700],
  value: [14, 800], stat: [20, 800], inbar: [14, 700],
};
V.TYPE = TYPE;
/* 앱 글꼴(next/font)의 실제 이름을 읽는다. canvas는 CSS 변수를 못 읽어서 값을 풀어 넘긴다. */
let family = '';
V.fontFamily = () => {
  family ||= getComputedStyle(document.documentElement).getPropertyValue('--font-pretendard').trim() || 'Pretendard, "Malgun Gothic", sans-serif';
  return family;
};
const ruler = document.createElement('canvas').getContext('2d');
V.textWidth = (s, kind = 'label') => {
  const [size, weight] = TYPE[kind];
  ruler.font = `${weight} ${size}px ${V.fontFamily()}`;
  return ruler.measureText(String(s)).width;
};
V.widest = (list, kind) => Math.ceil(Math.max(0, ...list.map((s) => V.textWidth(s, kind))));

V.text = (x, y, s, kind = 'label', opt = {}) => {
  const anchor = opt.anchor ? ` text-anchor="${opt.anchor}"` : '';
  const cls = opt.cls ? ` ${opt.cls}` : '';
  return `<text class="t-${kind}${cls}" x="${V.px(x)}" y="${V.px(y)}"${anchor}>${V.esc(s)}</text>`;
};

/* 1px 선은 .5 좌표에 놓아야 두 픽셀로 번지지 않는다. */
V.hline = (x0, x1, y, cls = 'grid') => {
  const yy = Math.round(y) + 0.5;
  return `<line class="${cls}" x1="${V.px(x0)}" x2="${V.px(x1)}" y1="${yy}" y2="${yy}"/>`;
};
V.vline = (x, y0, y1, cls = 'grid') => {
  const xx = Math.round(x) + 0.5;
  return `<line class="${cls}" x1="${xx}" x2="${xx}" y1="${V.px(y0)}" y2="${V.px(y1)}"/>`;
};

/* 기준선 쪽은 직각, 값 끝만 둥근 막대 */
V.barUp = (x, baseY, w, h, r = 2) => {
  if (h <= 0) return '';
  const c = Math.min(r, w / 2, h);
  return `M${V.px(x)} ${V.px(baseY)}V${V.px(baseY - h + c)}Q${V.px(x)} ${V.px(baseY - h)} ${V.px(x + c)} ${V.px(baseY - h)}`
    + `H${V.px(x + w - c)}Q${V.px(x + w)} ${V.px(baseY - h)} ${V.px(x + w)} ${V.px(baseY - h + c)}V${V.px(baseY)}Z`;
};
V.barRight = (x, y, w, h, r = 2) => {
  if (w <= 0) return '';
  const c = Math.min(r, h / 2, w);
  return `M${V.px(x)} ${V.px(y)}H${V.px(x + w - c)}Q${V.px(x + w)} ${V.px(y)} ${V.px(x + w)} ${V.px(y + c)}`
    + `V${V.px(y + h - c)}Q${V.px(x + w)} ${V.px(y + h)} ${V.px(x + w - c)} ${V.px(y + h)}H${V.px(x)}Z`;
};

/* data-v: 표식이 나타내는 값. data-viz-tip: "값|설명". */
V.mark = (attrs, value, tip) => `${attrs} data-v="${value}"${tip ? ` data-viz-tip="${V.esc(tip)}"` : ''}`;

/* 초점을 받는 표식이 있으면 role=img 안에 넣을 수 없어 group으로 둔다. */
V.svg = (w, h, label, body) => `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="${body.includes('tabindex') ? 'group' : 'img'}" aria-label="${V.esc(label)}">${body}</svg>`;

let uid = 0;
V.uid = (prefix) => `${prefix}-${++uid}`;

/* ---------- 칸에 차트 걸기(VizSlot이 부른다) ---------- */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 그릴 때마다 바뀌는 내부 id는 비교에서 뺀다. 값이 같으면 다시 그리지도 움직이지도 않는다. */
const signature = (html) => html.replace(/\b(?:gauge|thin)-\d+/g, '');

V.paint = (el, draw, force) => {
  const w = Math.floor(el.clientWidth);
  const h = Math.floor(el.clientHeight);
  if (!w || !h || (!force && el._w === w && el._h === h)) return;
  el._w = w;
  el._h = h;
  const html = draw(w, h);
  el._sig = signature(html);
  el.innerHTML = html;
};

const MORPH = 'path.bar, path.line, path.area';
const TIMING = { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' };
const commands = (d) => d.replace(/[-\d.\s,]+/g, ' ');
const canMorph = () => typeof CSS !== 'undefined' && CSS.supports?.('d', 'path("M0 0")');

const capture = (el) => ({
  paths: [...el.querySelectorAll(MORPH)].map((p) => p.getAttribute('d')),
  dots: [...el.querySelectorAll('circle.pt')].map((c) => [c.getAttribute('cx'), c.getAttribute('cy')]),
  gauge: el.querySelector('.gauge-asset')?.dataset.gauge,
});

/* 막대·선·점은 옛 위치에서 새 위치로 옮겨 간다. 개수가 달라 이을 수 없으면 처음 나타날 때처럼 자라게 한다. */
function morph(el, before) {
  if (before.gauge !== undefined && V.enterGauge?.(el, Number(before.gauge))) return;
  const paths = [...el.querySelectorAll(MORPH)];
  const dots = [...el.querySelectorAll('circle.pt')];
  const joined = canMorph() && paths.length > 0 && paths.length === before.paths.length
    && paths.every((p, i) => commands(p.getAttribute('d')) === commands(before.paths[i]));
  el.querySelectorAll('text, line').forEach((node) => node.animate({ opacity: [0, 1] }, { duration: 320, easing: 'ease-out' }));
  if (!joined) {
    el.classList.add('enter');
    setTimeout(() => el.classList.remove('enter'), 800);
    return;
  }
  paths.forEach((p, i) => p.animate({ d: [`path("${before.paths[i]}")`, `path("${p.getAttribute('d')}")`] }, TIMING));
  if (dots.length === before.dots.length) {
    dots.forEach((c, i) => c.animate({ cx: [`${before.dots[i][0]}px`, `${c.getAttribute('cx')}px`], cy: [`${before.dots[i][1]}px`, `${c.getAttribute('cy')}px`] }, TIMING));
  }
}

/* 버튼으로 값이 바뀌었을 때 부른다. 폭이 바뀌어 다시 그릴 때(V.paint)는 움직이지 않는다. */
V.update = (el, draw) => {
  const w = Math.floor(el.clientWidth);
  const h = Math.floor(el.clientHeight);
  if (!w || !h) return;
  const html = draw(w, h);
  const sig = signature(html);
  if (el._sig === sig) return;
  const before = el._sig && el.dataset.entered && !reduced() ? capture(el) : null;
  el._w = w;
  el._h = h;
  el._sig = sig;
  el.innerHTML = html;
  if (before) morph(el, before);
};

V.enter = (el) => {
  if (el.dataset.entered) return;
  el.dataset.entered = '1';
  if (reduced()) return;
  if (V.enterGauge?.(el)) return;
  el.classList.add('enter');
  setTimeout(() => el.classList.remove('enter'), 1100);
};

/* 글자 폭을 재서 배치하므로 글꼴이 준비되면 한 번 더 그린다. */
V.fontsReady = () => document.fonts.load(`500 13px ${V.fontFamily()}`).catch(() => undefined);

/* ---------- 하나의 안내 말풍선 ---------- */
/* 앱의 data-tip 카드와 겹치지 않게 data-viz-tip을 쓴다. 화면에 있는 동안만 붙이고 떠날 때 뗀다. */
V.attachTips = () => {
  const host = document.createElement('div');
  host.className = 'aywa-instruments';
  const tip = document.createElement('div');
  tip.id = 'viz-tip';
  tip.hidden = true;
  host.append(tip);
  document.body.append(host);
  const place = (x, y) => {
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
  };
  const add = (parent, tag, cls, label) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (label !== undefined) node.textContent = label;
    parent.append(node);
    return node;
  };
  const show = (el, x, y) => {
    const [value, note] = el.dataset.vizTip.split('|');
    tip.replaceChildren();
    if (el.dataset.vizTipRows) {
      /* 계열이 여럿이면 범례와 같은 색 표시로 한 줄씩 */
      add(tip, 'span', 'tip-title', value);
      JSON.parse(el.dataset.vizTipRows).forEach((r) => {
        const row = add(tip, 'div', 'tip-row');
        add(row, 'i', `tip-key ${r.tone}`);
        add(row, 'span', '', r.name);
        add(row, 'b', '', r.value);
      });
    } else {
      add(tip, 'b', '', value);
      if (note) add(tip, 'span', '', note);
    }
    tip.hidden = false;
    place(x, y);
  };
  const hide = () => { tip.hidden = true; };
  const over = (e) => {
    const el = e.target.closest?.('[data-viz-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  };
  const move = (e) => { if (!tip.hidden) place(e.clientX, e.clientY); };
  const focus = (e) => {
    const el = e.target.closest?.('[data-viz-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  };
  document.addEventListener('pointerover', over);
  document.addEventListener('pointermove', move);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', hide);
  return () => {
    document.removeEventListener('pointerover', over);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('focusin', focus);
    document.removeEventListener('focusout', hide);
    host.remove();
  };
};
