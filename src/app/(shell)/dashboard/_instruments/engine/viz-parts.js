/* 구성·분포·시간 차트: 도넛 · 얇은 구성 띠 · 단위 칸 행 · 학교 묶음 · 시간대. */
import { V } from './viz-core';
const { px, fmt, text, hline, vline, linear, widest, textWidth, mark, svg } = V;

/* ---------- 도넛: 합계는 가운데, 값은 오른쪽 목록 ---------- */
V.ring = (w, h, { parts, tones, center, unit = '', title = '' }) => {
  const total = parts.reduce((n, p) => n + p[1], 0);
  const R = Math.floor(Math.min(h / 2 - 1, 62));
  const thick = 15;
  const cx = R + 1;
  const cy = Math.round(h / 2);
  const r = R - thick / 2;
  let body = '';
  let run = 0;
  parts.forEach(([name, v], i) => {
    const a0 = (run / total) * 2 * Math.PI - Math.PI / 2;
    run += v;
    const a1 = (run / total) * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${px(cx + r * Math.cos(a0))} ${px(cy + r * Math.sin(a0))}A${r} ${r} 0 ${large} 1 ${px(cx + r * Math.cos(a1))} ${px(cy + r * Math.sin(a1))}`;
    body += `<path ${mark(`class="ring-seg ${tones[i].replace('m-', 'r-')}" d="${d}" stroke-width="${thick}"`, v, `${fmt(v)}${unit} · ${Math.round((v / total) * 100)}%|${name}`)}/>`;
  });
  body += text(cx, cy - 7, fmt(total), 'stat', { anchor: 'middle', cls: 'mid' });
  body += text(cx, cy + 12, center, 'axis', { anchor: 'middle', cls: 'mid' });
  const lx = cx + R + 16;
  const nameW = widest(parts.map((p) => p[0]), 'label');
  const rowH = Math.min(24, (h - 8) / parts.length);
  const y0 = cy - (rowH * parts.length) / 2;
  parts.forEach(([name, v], i) => {
    const y = y0 + rowH * (i + 0.5);
    body += `<rect class="${tones[i]}" x="${lx}" y="${px(y - 5)}" width="10" height="10" rx="2"/>`;
    body += text(lx + 15, y, name, 'label', { cls: 'mid' });
    body += text(Math.max(lx + 15 + nameW + 42, w - 40), y, `${fmt(v)}${unit}`, 'strong', { cls: 'mid', anchor: 'end' });
    body += text(w, y, `${Math.round((v / total) * 100)}%`, 'axis', { cls: 'mid', anchor: 'end' });
  });
  return svg(w, h, `${title}: ${parts.map((p) => `${p[0]} ${p[1]}${unit}`).join(', ')}`, body);
};

/* ---------- 얇은 구성 띠: 합계가 총폭과 정확히 맞는다 ---------- */
V.thinBar = (w, h, { parts, tones, unit = '', title = '' }) => {
  const total = parts.reduce((n, p) => n + p[1], 0);
  const e = V.edges(parts.map((p) => p[1]), total, 0, w);
  const id = V.uid('thin');
  const barH = Math.min(h, 10);
  const y = Math.round((h - barH) / 2);
  let body = `<defs><clipPath id="${id}"><rect x="0" y="${y}" width="${w}" height="${barH}" rx="3"/></clipPath></defs><g clip-path="url(#${id})">`;
  parts.forEach(([name, v], i) => {
    if (!v) return;
    body += `<rect ${mark(`class="seg grow-x ${tones[i]}" x="${e[i]}" y="${y}" width="${e[i + 1] - e[i]}" height="${barH}"`, v, `${fmt(v)}${unit}|${name}`)}/>`;
  });
  return svg(w, h, `${title}: ${parts.map((p) => `${p[0]} ${p[1]}${unit}`).join(', ')}`, `${body}</g>`);
};

/* ---------- 연료 게이지: 20%씩 5칸. 칸마다 채운 길이의 합 = 값 ---------- */
V.fuel = (w, h, { value, low = 70, tip = '', label = '' }) => {
  const textW = Math.ceil(textWidth('100%', 'strong'));
  const barW = Math.max(30, w - textW - 8);
  const gap = 2;
  const count = 5;
  const cell = (barW - gap * (count - 1)) / count;
  const barH = 8;
  const y = Math.round((h - barH) / 2);
  const tone = value < low ? 'm-red' : 'm-yellow';
  let cells = '';
  for (let i = 0; i < count; i++) {
    const x0 = px(i * (cell + gap));
    const part = Math.max(0, Math.min(1, (value - i * 20) / 20));
    cells += `<rect class="fuel-cell" x="${x0}" y="${y}" width="${px(cell)}" height="${barH}" rx="2"/>`;
    if (part > 0) cells += `<rect class="fuel-fill grow-x ${tone}" x="${x0}" y="${y}" width="${px(cell * part)}" height="${barH}" rx="2"/>`;
  }
  const body = `<g data-viz-tip="${V.esc(tip)}" data-v="${value}" class="fuel"><rect class="hit-area" x="0" y="0" width="${barW}" height="${h}"/>${cells}</g>`
    + text(w, h / 2, `${value}%`, 'strong', { anchor: 'end', cls: `mid${value < low ? ' is-low' : ''}` });
  return svg(w, h, `${label} ${value}%`, body);
};

/* ---------- 칸 묶음 행: 한 칸 = 한 학생 ---------- */
V.unitRows = (w, h, { rows, of = null, unit = '', tone = 'm-char', title = '' }) => {
  const slots = of ?? Math.max(...rows.map((r) => r[1]));
  const gap = 3;
  const labelW = widest(rows.map((r) => r[0]), 'label');
  const ends = rows.map((r) => `${r[1]}${of ? ` / ${of}` : ''}${unit}`);
  const countW = widest(ends, 'strong');
  const x0 = labelW + 12;
  const avail = w - x0 - countW - 10;
  const cell = Math.max(6, Math.min(16, Math.floor((avail + gap) / slots) - gap));
  const rowH = h / rows.length;
  let body = '';
  rows.forEach(([name, n], i) => {
    const cy = rowH * (i + 0.5);
    const y0 = Math.round(cy - cell / 2);
    body += text(0, cy, name, 'label', { cls: 'mid' });
    for (let k = 0; k < slots; k++) {
      const on = k < n;
      if (!on && !of) continue;
      body += `<rect class="unit ${on ? `grow-y ${tone}` : 'm-pale'}" x="${x0 + k * (cell + gap)}" y="${y0}" width="${cell}" height="${cell}" rx="2"${on ? ' data-v="1"' : ''}/>`;
    }
    body += `<g class="hit" data-viz-tip="${V.esc(`${n}${unit}|${name}`)}"><rect class="hit-area" x="0" y="${px(cy - rowH / 2)}" width="${w}" height="${px(rowH)}"/></g>`;
    body += text(x0 + (of ? slots : n) * (cell + gap) + 5, cy, ends[i], 'strong', { cls: 'mid' });
  });
  return svg(w, h, `${title}: ${rows.map((r) => `${r[0]} ${r[1]}${unit}`).join(', ')}`, body);
};

/* ---------- 학교 묶음: 초등·중등·고등 칸마다 상위 학교 ---------- */
V.schoolGroups = (w, h, { groups, unit = '명', title = '' }) => {
  const gap = 16;
  const colW = (w - gap * (groups.length - 1)) / groups.length;
  const headH = 22;
  const max = Math.max(...groups.flatMap((g) => g.schools.map((s) => s[1])));
  let body = '';
  groups.forEach((g, c) => {
    const x0 = Math.round(c * (colW + gap));
    const barMax = Math.floor(colW);
    const rowH = (h - headH) / g.schools.length;
    body += text(x0, 8, g.label, 'strong', { cls: 'mid' });
    body += text(x0 + barMax, 8, `${fmt(g.total)}${unit}`, 'axis', { anchor: 'end', cls: 'mid' });
    body += hline(x0, x0 + barMax, headH - 6, 'axis');
    g.schools.forEach(([name, v], i) => {
      const y = headH + rowH * i;
      body += text(x0, y + rowH / 2 - 3, name, 'axis', { cls: 'mid' });
      body += text(x0 + barMax, y + rowH / 2 - 3, fmt(v), 'axis', { cls: 'mid', anchor: 'end' });
      const bw = Math.round((v / max) * barMax);
      body += `<rect ${mark(`class="seg grow-x m-yellow" x="${x0}" y="${Math.round(y + rowH - 6)}" width="${bw}" height="3" rx="1.5"`, v, `${fmt(v)}${unit}|${g.label} · ${name}`)}/>`;
    });
  });
  return svg(w, h, `${title}: ${groups.map((g) => `${g.label} ${g.total}${unit}`).join(', ')}`, body);
};

/* ---------- 시간대: 오늘 수업이 실제 시각 위에 놓인다 ---------- */
V.timeline = (w, h, { from, to, now, rows, tones, title = '' }) => {
  const m = V.minutes;
  const topH = 18;
  const axisH = 20;
  const labelW = widest(rows.map((r) => r.name), 'label');
  const x = linear(m(from), m(to), labelW + 12, w - 6);
  const rowH = (h - topH - axisH) / rows.length;
  const barH = Math.min(20, Math.round(rowH * 0.7));
  const t = m(now);
  let body = '';
  let labels = '';
  const every = x(m(from) + 120) - x(m(from)) < 36 ? 4 : 2;
  for (let hh = m(from); hh <= m(to); hh += 60) {
    body += vline(x(hh), topH, h - axisH, hh === m(from) ? 'axis' : 'grid');
    if ((hh / 60) % every === 0) body += text(x(hh), h - 5, `${hh / 60}시`, 'axis', { anchor: hh === m(to) ? 'end' : 'middle' });
  }
  rows.forEach((r, i) => {
    const cy = topH + rowH * (i + 0.5);
    const y0 = Math.round(cy - barH / 2);
    const x0 = Math.round(x(m(r.start)));
    const x1 = Math.round(x(m(r.end)));
    const state = t >= m(r.end) ? 'done' : t >= m(r.start) ? 'run' : 'next';
    const word = { done: '끝남', run: '진행 중', next: '예정' }[state];
    const fill = state === 'run' ? tones[r.subject] : 's-next';
    body += text(0, cy, r.name, 'label', { cls: 'mid' });
    body += `<rect ${mark(`class="slot grow-x ${fill}" x="${x0}" y="${y0}" width="${x1 - x0}" height="${barH}" rx="3"`, m(r.end) - m(r.start), `${r.start}–${r.end} · ${r.room}|${r.name} · ${word}`)}/>`;
    const span = textWidth(`${r.start}–${r.end}`, 'inbar') + 12 <= x1 - x0 ? `${r.start}–${r.end}` : r.start;
    const dark = fill === 'm-char';
    if (textWidth(span, 'inbar') + 10 <= x1 - x0) labels += text(x0 + 5, cy, span, 'inbar', { cls: `mid ${dark ? 'on-ink' : 'on-light'}` });
  });
  const nx = Math.round(x(t)) + 0.5;
  body += `<line class="now" x1="${nx}" x2="${nx}" y1="${topH - 4}" y2="${h - axisH}"/>${labels}`;
  const nowLabel = `지금 ${now}`;
  const half = textWidth(nowLabel, 'axis') / 2;
  body += text(Math.min(w - half, Math.max(labelW + 12 + half, nx)), 7, nowLabel, 'axis', { anchor: 'middle', cls: 'mid now-label' });
  return svg(w, h, `${title}: ${rows.map((r) => `${r.name} ${r.start}–${r.end}`).join(', ')}, 지금 ${now}`, body);
};

