/* 240도 원형 계기판. 빈 창 위에 실제 값까지 색을 드러내며, 첫 20% 구간은 붉게 표시한다.
   값 v 하나에서 각도를 얻어 ① 채움 부채꼴 ② 바늘 ③ 판독 숫자를 그리므로 셋은 어긋날 수 없다. */
import { GAUGE_GEOM as G } from './gauge-geometry';
import { V } from './viz-core';
const { start: START, span: SPAN } = G.sweep;
const clampValue = (v) => Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;

/* 값 → 수학 각도 */
const degOf = (v) => START - (v / 100) * SPAN;
V.gaugeDeg = degOf;
const at = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
};
const pt = ([x, y]) => `${V.px(x)} ${V.px(y)}`;

/* 채워진 창을 드러내는 고리 부채꼴. 앞날 각도는 값의 각도와 같다.
   양 끝은 창 밖으로 1도 넉넉히 잡아 끝 창이 안티앨리어싱으로 깎이지 않게 한다. */
function wedge(cx, cy, R, v) {
  if (v <= 0) return '';
  const inner = (G.track.inner - 0.02) * R;
  const outer = (G.track.outer + 0.02) * R;
  const from = START + 1;
  const to = v >= 100 ? degOf(100) - 1 : degOf(v);
  const large = from - to > 180 ? 1 : 0;
  return `M${pt(at(cx, cy, outer, from))}A${V.px(outer)} ${V.px(outer)} 0 ${large} 1 ${pt(at(cx, cy, outer, to))}`
    + `L${pt(at(cx, cy, inner, to))}A${V.px(inner)} ${V.px(inner)} 0 ${large} 0 ${pt(at(cx, cy, inner, from))}Z`;
}

function scale(cx, cy, R, fontSize) {
  let body = '';
  for (let v = 0; v <= 100; v += 5) {
    const kind = v % 20 === 0 ? 'major' : v % 10 === 0 ? 'middle' : 'minor';
    const [r0, r1] = G.ticks[kind];
    const [x0, y0] = at(cx, cy, r0 * R, degOf(v));
    const [x1, y1] = at(cx, cy, r1 * R, degOf(v));
    body += `<line class="g-tick g-${kind}" x1="${V.px(x0)}" y1="${V.px(y0)}" x2="${V.px(x1)}" y2="${V.px(y1)}"/>`;
  }
  const style = ` style="font-size:${V.px(fontSize)}px"`;
  for (let v = 0; v <= 100; v += 20) {
    const [x, y] = at(cx, cy, G.numerals.radius * R, degOf(v));
    body += `<text class="g-num" x="${V.px(x)}" y="${V.px(y)}"${style}>${v}</text>`;
  }
  return body;
}

/* 면이 둘인 바늘: 축 중심선을 기준으로 위아래 면의 밝기가 다르다. 기본 방향은 +x(0도). */
function needle(cx, cy, R, v) {
  const n = G.needle;
  const half = (n.base * R) / 2;
  const tip = `${V.px(cx + n.tip * R)},${V.px(cy)}`;
  const tail = `${V.px(cx - n.tail * R)},${V.px(cy)}`;
  const up = [tip, `${V.px(cx)},${V.px(cy - half)}`, `${V.px(cx - n.tail * R)},${V.px(cy - half * 0.7)}`, tail].join(' ');
  const down = [tip, `${V.px(cx)},${V.px(cy + half)}`, `${V.px(cx - n.tail * R)},${V.px(cy + half * 0.7)}`, tail].join(' ');
  return `<g class="g-needle" transform="rotate(${V.px(-degOf(v))} ${V.px(cx)} ${V.px(cy)})"><polygon class="g-face-a" points="${up}"/><polygon class="g-face-b" points="${down}"/></g>`;
}

function hub(cx, cy, R, id) {
  const r = G.hub.radius * R;
  return `<circle class="g-hub" cx="${V.px(cx)}" cy="${V.px(cy)}" r="${V.px(r)}" fill="url(#${id}-hub)"/>`
    + `<circle class="g-hub-dot" cx="${V.px(cx)}" cy="${V.px(cy)}" r="${V.px(r * 0.34)}"/>`;
}

/* 유리 반사: 위쪽 초승달. 바늘 위에 얹혀 다이얼이 유리 아래 있는 것처럼 보인다. */
function glass(cx, cy, R, id) {
  const r = (1 - G.plate.bezel - G.plate.flange) * R;
  const inner = r * 1.42;
  const a = at(cx, cy, r, 157);
  const b = at(cx, cy, r, 23);
  return `<path class="g-glass" fill="url(#${id}-glass)" d="M${pt(a)}A${V.px(r)} ${V.px(r)} 0 0 1 ${pt(b)}A${V.px(inner)} ${V.px(inner)} 0 0 0 ${pt(a)}Z"/>`;
}

/* maxR: 판 반지름 상한(px). 칸이 작으면 비례해서 줄지만 가로세로 비는 변하지 않는다. */
V.gauge = (w, h, { value, label, caption = '', maxR = 80, align = 'center' }) => {
  value = clampValue(value);
  const img = G.image;
  const R = Math.floor(Math.min(maxR, (w - 2) / 2, (h - 2) / 2));
  const cx = align === 'left' ? R + 1 : Math.round(w / 2);
  const cy = Math.round(h / 2);
  const id = V.uid('gauge');
  const sm = R * (window.devicePixelRatio || 1) > 130 ? '' : '-sm';
  const box = `x="${V.px(cx + img.x0 * R)}" y="${V.px(cy - img.y1 * R)}" width="${V.px((img.x1 - img.x0) * R)}" height="${V.px((img.y1 - img.y0) * R)}"`;
  const fontSize = Math.max(12, Math.min(15, R * 0.15));
  const readY = cy + G.readout.cy * R;
  const bigSize = V.px(R * 0.31);
  const unitSize = V.px(R * 0.155);
  const capSize = V.px(Math.max(12, R * 0.145));
  return `<svg class="chart gauge-asset" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${V.esc(label)} ${value}%"`
    + ` data-gauge="${value}" data-label="${V.esc(label)}" data-cx="${cx}" data-cy="${cy}" data-r="${R}">`
    + `<defs><clipPath id="${id}"><path class="g-wedge" d="${wedge(cx, cy, R, value)}"/></clipPath>`
    + `<clipPath id="${id}-low"><path d="${wedge(cx, cy, R, 20)}"/></clipPath>`
    + `<radialGradient id="${id}-hub" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#8d979d"/><stop offset=".55" stop-color="#3a4147"/><stop offset="1" stop-color="#16191c"/></radialGradient>`
    + `<linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".17"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
    + `<image class="g-layer g-base" href="/dashboard-instruments/gauge-empty${sm}.webp" ${box}/>`
    + `<g class="g-lit" clip-path="url(#${id})">`
    + `<image class="g-layer" href="/dashboard-instruments/gauge-lit${sm}.webp" ${box}/>`
    + `<image class="g-layer g-low" href="/dashboard-instruments/gauge-lit${sm}.webp" ${box} clip-path="url(#${id}-low)"/></g>`
    + scale(cx, cy, R, fontSize)
    + `<text class="g-read" x="${V.px(cx)}" y="${V.px(readY)}" style="font-size:${bigSize}px"><tspan class="g-read-num">${value}</tspan><tspan class="g-read-unit" style="font-size:${unitSize}px" dx="1">%</tspan></text>`
    + (caption ? `<text class="g-cap" x="${V.px(cx)}" y="${V.px(cy + G.readout.labelCy * R)}" style="font-size:${capSize}px">${V.esc(caption)}</text>` : '')
    + needle(cx, cy, R, value)
    + hub(cx, cy, R, id)
    + glass(cx, cy, R, id)
    + '</svg>';
};

/* 같은 수식으로 값만 바꾼다. 슬라이더와 진입 움직임이 함께 쓴다. */
V.setGauge = (svg, v) => {
  v = clampValue(v);
  const cx = Number(svg.dataset.cx);
  const cy = Number(svg.dataset.cy);
  const R = Number(svg.dataset.r);
  const shown = Math.round(v);
  svg.querySelector('.g-wedge').setAttribute('d', wedge(cx, cy, R, v));
  svg.querySelector('.g-needle').setAttribute('transform', `rotate(${V.px(-degOf(v))} ${cx} ${cy})`);
  svg.querySelector('.g-read-num').textContent = String(shown);
  svg.dataset.gauge = String(v);
  svg.setAttribute('aria-label', `${svg.dataset.label} ${shown}%`);
};

V.enterGauge = (el, from = 0) => {
  const svg = el.querySelector('.gauge-asset');
  if (!svg) return false;
  const target = Number(svg.dataset.gauge);
  const t0 = performance.now();
  const step = (t) => {
    const live = el.querySelector('.gauge-asset');
    if (!live) return;
    const p = Math.max(0, Math.min(1, (t - t0) / 950));
    const eased = 1 - (1 - p) ** 4;
    V.setGauge(live, p >= 1 ? target : from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  V.setGauge(svg, from);
  requestAnimationFrame(step);
  return true;
};
