/* 축이 있는 차트: 추이(막대·꺾은선 전환) · 세로 누적 막대 · 단계 흐름 · 순위 막대 · 가로 누적 막대.
   각 함수는 (w, h, 데이터)를 받아 그 크기의 SVG 문자열을 돌려준다. 좌표는 모두 같은 scale에서 나온다. */
import { V } from './viz-core';
const { px, fmt, text, hline, vline, linear, ticks, widest, textWidth, mark, svg } = V;

const describe = (title, rows, unit = '', f = fmt) => `${title}: ${rows.map((r) => `${r[0]} ${f(r[1])}${unit}`).join(', ')}`;

/* x축 이름이 겹치면 하나 건너 하나만 보인다. 값은 말풍선과 aria-label에 그대로 남는다. */
const labelStep = (labels, gap) => {
  const need = widest(labels, 'axis') + 4;
  /* 칸이 아주 좁으면 gap이 0 이하다. 음수 간격이면 축을 그리는 반복이 끝나지 않는다. */
  const fit = gap > 0 ? Math.ceil(need / gap) : labels.length;
  const sparse = labels.length > 12 ? Math.ceil(labels.length / 8) : 1;
  return Math.max(1, fit, sparse);
};

function legend(series, tones, y, x0 = 0, line = false) {
  let body = '';
  let x = x0;
  series.forEach((name, i) => {
    body += line
      ? `<rect class="${tones[i]}" x="${px(x)}" y="${y + 4}" width="12" height="3" rx="1.5"/>`
      : `<rect class="${tones[i]}" x="${px(x)}" y="${y}" width="10" height="10" rx="2"/>`;
    body += text(x + (line ? 17 : 15), y + 5, name, 'axis', { cls: 'mid' });
    x += (line ? 17 : 15) + textWidth(name, 'axis') + 14;
  });
  return body;
}

/* ---------- 추이: 1~2개 계열, 막대 또는 꺾은선 ---------- */
V.trend = (w, h, { labels, series, kind = 'bar', unit = '', format = fmt, valueLabels = 'end', zero = kind === 'bar', emphasis = -1, title = '' }) => {
  const hasLegend = series.length > 1;
  const top = (hasLegend ? 22 : 0) + (valueLabels === 'all' ? 20 : 12);
  const bottom = 24;
  const all = series.flatMap((s) => s.values).filter((v) => v !== null);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.2 || Math.max(1, Math.abs(hi) * 0.05);
  const yt = zero ? ticks(0, hi, 3) : ticks(lo - pad, hi + pad, 3);
  const left = widest(yt.map(format), 'axis') + 10;
  const lastSeries = series[series.length - 1];
  const lastValue = lastSeries.values[lastSeries.values.length - 1];
  /* 세 계열 이상의 꺾은선은 점마다 숫자를 달면 겹치므로 선 끝에 이름과 값을 붙인다. */
  const direct = kind === 'line' && series.length >= 3;
  /* 끝 칸이 비는 계열(오늘 기록이 없는 과목)은 마지막 값에 이름을 붙인다. */
  const tailOf = (s) => { for (let i = s.values.length - 1; i >= 0; i -= 1) if (s.values[i] !== null) return [i, s.values[i]]; return [s.values.length - 1, lo]; };
  const endText = (s) => `${s.name} ${format(tailOf(s)[1])}`;
  const endLabel = !direct && kind === 'line' && valueLabels === 'end' && lastValue !== null;
  const right = direct ? w - widest(series.map(endText), 'strong') - 18 : endLabel ? w - Math.ceil(textWidth(format(lastValue), 'value')) - 14 : w;
  const y = linear(yt[0], yt[yt.length - 1], h - bottom, top);
  const base = Math.round(h - bottom);
  const n = labels.length;
  const band = (right - left) / n;
  const cx = (i) => left + band * (i + 0.5);
  let body = hasLegend ? legend(series.map((s) => s.name), series.map((s) => s.tone), 2, left, kind === 'line') : '';
  yt.forEach((t) => {
    body += hline(left, w, y(t), t === yt[0] ? 'axis' : 'grid');
    body += text(left - 6, y(t), format(t), 'axis', { anchor: 'end', cls: 'mid' });
  });
  if (kind === 'bar') {
    const count = series.length;
    const barW = Math.max(4, Math.min(count > 1 ? 16 : 28, Math.floor((band * 0.66 - (count - 1) * 2) / count)));
    /* 값 글자가 옆 막대 글자와 겹치지 않도록 막대 간격을 글자 폭에 맞춘다. */
    const labelW = valueLabels === 'all' ? widest(all.map(format), 'strong') : 0;
    const wanted = count > 1 ? Math.max(2, labelW + 4 - barW) : 2;
    const gap = barW * count + wanted * (count - 1) <= band * 0.92 ? wanted : 2;
    const groupW = barW * count + gap * (count - 1);
    series.forEach((s, k) => s.values.forEach((v, i) => {
      if (v === null) return;
      const x0 = Math.round(cx(i) - groupW / 2) + k * (barW + gap);
      const bh = base - Math.round(y(v));
      body += `<path ${mark(`class="bar grow-y ${i === emphasis ? 'm-yellow' : s.tone}" d="${V.barUp(x0, base, barW, bh)}"`, v)}/>`;
      const label = format(v);
      /* 막대가 하나인 칸은 칸 폭까지 쓸 수 있다. 금액처럼 막대보다 긴 글자도 옆 칸과 안 겹친다. */
      const room = count > 1 ? barW + gap : band;
      const showAll = valueLabels === 'all' && textWidth(label, 'strong') + 2 <= room;
      if (showAll) body += text(x0 + barW / 2, base - bh - 6, label, 'strong', { anchor: 'middle' });
    }));
  } else {
    series.forEach((s) => {
      const pts = s.values.map((v, i) => (v === null ? null : [cx(i), y(v), v])).filter(Boolean);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p[0])} ${px(p[1])}`).join('');
      if (series.length === 1) body += `<path class="area" d="${d}L${px(pts[pts.length - 1][0])} ${base}L${px(pts[0][0])} ${base}Z"/>`;
      body += `<path class="line draw ${s.stroke || ''}" pathLength="1" d="${d}"/>`;
      pts.forEach(([x, yy, v], i) => {
        body += `<circle ${mark(`class="pt ${s.stroke || ''}${i === pts.length - 1 ? ' end' : ''}" cx="${px(x)}" cy="${px(yy)}" r="4"`, v)}/>`;
        if (!direct && valueLabels === 'all' && widest(s.values.filter((q) => q !== null).map(format), 'strong') + 6 <= band) {
          const crowded = series.some((o, n) => o !== s && o.values[i] !== null && yy - y(o.values[i]) < 24 && (y(o.values[i]) < yy || (y(o.values[i]) === yy && n < series.indexOf(s))));
          body += text(x, crowded ? yy + 18 : yy - 10, format(v), 'strong', { anchor: 'middle' });
        }
      });
      const tail = pts[pts.length - 1];
      if (endLabel && s === lastSeries) body += text(tail[0] + 10, tail[1], format(tail[2]), 'value', { cls: 'mid' });
    });
    if (direct) {
      /* 끝값이 가까우면 글자만 벌리고 가는 선으로 점과 잇는다. 점 위치는 값 그대로다. */
      const ends = series.map((s) => { const [i, v] = tailOf(s); return { label: endText(s), x: cx(i), y: y(v) }; }).sort((a, b) => a.y - b.y);
      ends.forEach((e, i) => { e.ly = i ? Math.max(e.y, ends[i - 1].ly + 17) : e.y; });
      const over = ends[ends.length - 1].ly - (base + 6);
      if (over > 0) ends.forEach((e) => { e.ly -= over; });
      ends.forEach((e) => {
        body += `<line class="connector" x1="${px(e.x + 5)}" y1="${px(e.y)}" x2="${px(e.x + 13)}" y2="${px(e.ly)}"/>`;
        body += text(e.x + 16, e.ly, e.label, 'strong', { cls: 'mid' });
      });
    }
  }
  const step = labelStep(labels, band);
  let limit = Infinity;
  for (let i = n - 1; i >= 0; i -= step) {
    const half = textWidth(labels[i], 'axis') / 2;
    const x = Math.min(w - half, cx(i));
    if (x + half + 4 > limit) continue;
    body += text(x, h - 6, labels[i], 'axis', { anchor: 'middle' });
    limit = x - half;
  }
  labels.forEach((l, i) => {
    const valueOf = (s) => (s.values[i] === null ? '—' : `${format(s.values[i])}${format === fmt ? unit : ''}`);
    const rows = series.length > 1 ? ` data-viz-tip-rows="${V.esc(JSON.stringify(series.map((s) => ({ name: s.name, value: valueOf(s), tone: s.tone }))))}"` : '';
    body += `<g class="hit" tabindex="0" data-viz-tip="${V.esc(series.length > 1 ? l : `${valueOf(series[0])}|${l}`)}"${rows} data-label="${V.esc(l)}"><rect class="hit-area" x="${px(left + band * i)}" y="0" width="${px(band)}" height="${h}"/>`
      + `${vline(cx(i), top, base, 'cross')}</g>`;
  });
  const label = `${title}: ${labels.map((l, i) => `${l} ${series.map((s) => (s.values[i] === null ? '기록 없음' : format(s.values[i]))).join(' / ')}`).join(', ')}`;
  return svg(w, h, label, body);
};

/* ---------- 세로 누적 막대(학년별 영어·동시·수학) ---------- */
V.stackColumns = (w, h, { rows, series, tones, unit = '', groups = null, title = '' }) => {
  const legendH = 20;
  const top = legendH + 18;
  const bottom = groups ? 42 : 22;
  const totals = rows.map((r) => r[1].reduce((a, b) => a + b, 0));
  const yt = ticks(0, Math.max(...totals), 2);
  const left = widest(yt.map(fmt), 'axis') + 8;
  const y = linear(0, yt[yt.length - 1], h - bottom, top);
  const base = Math.round(y(0));
  const band = (w - left) / rows.length;
  const barW = Math.max(6, Math.min(20, Math.floor(band * 0.62)));
  let body = legend(series, tones, 2, left);
  yt.forEach((t) => {
    if (t) body += hline(left, w, y(t));
    body += text(left - 6, y(t), fmt(t), 'axis', { anchor: 'end', cls: 'mid' });
  });
  const showTotals = widest(totals.map(fmt), 'strong') + 2 <= band;
  const step = labelStep(rows.map((r) => r[0]), band);
  rows.forEach(([name, parts], i) => {
    const cx = left + band * (i + 0.5);
    const x0 = Math.round(cx - barW / 2);
    let run = 0;
    parts.forEach((v, k) => {
      if (!v) return;
      const y1 = Math.round(y(run));
      run += v;
      const y0 = Math.round(y(run));
      body += `<rect ${mark(`class="seg grow-y ${tones[k]}" x="${x0}" y="${y0}" width="${barW}" height="${y1 - y0}"`, v, `${fmt(v)}${unit}|${name} · ${series[k]}`)}/>`;
    });
    if (showTotals) body += text(cx, Math.round(y(totals[i])) - 5, fmt(totals[i]), 'strong', { anchor: 'middle' });
    if (i % step === 0) body += text(cx, base + 15, name, 'axis', { anchor: 'middle' });
  });
  body += hline(left, w, base - 0.5, 'axis');
  if (groups) {
    let start = 0;
    groups.forEach(([name, count, total]) => {
      const gx0 = left + band * start + 3;
      const gx1 = left + band * (start + count) - 3;
      const gy = h - 15;
      body += `<path class="bracket" d="M${px(gx0)} ${gy - 4}V${gy}H${px(gx1)}V${gy - 4}"/>`;
      body += text((gx0 + gx1) / 2, h - 2, `${name} ${fmt(total)}`, 'axis', { anchor: 'middle', cls: 'strong-axis' });
      start += count;
    });
  }
  return svg(w, h, describe(title, rows.map((r, i) => [r[0], totals[i]]), unit), body);
};

/* ---------- 단계 흐름: 같은 기준선, 막대 길이 = 건수, 오른쪽은 앞 단계 대비 비율 ---------- */
V.funnel = (w, h, { steps, unit = '', title = '' }) => {
  const n = steps.length;
  const labelW = widest(steps.map((s) => s[0]), 'label');
  const valW = widest(steps.map((s) => fmt(s[1])), 'value');
  const rateW = Math.ceil(textWidth('100%', 'axis'));
  const x0 = labelW + 10;
  const x = linear(0, steps[0][1], x0, w - rateW - 14 - valW - 8);
  const rowH = h / n;
  const barH = Math.min(20, Math.round(rowH * 0.56));
  const toneOf = (i) => (i === n - 1 ? 'm-yellow' : i < n / 2 ? 'm-char' : 'm-mid');
  const rows = steps.map(([, v], i) => ({ y: Math.round(rowH * (i + 0.5) - barH / 2), x1: Math.round(x(v)) }));
  let body = '';
  rows.forEach((r, i) => {
    if (i === n - 1) return;
    body += `<path class="drop" d="M${x0} ${r.y + barH}H${r.x1}L${rows[i + 1].x1} ${rows[i + 1].y}H${x0}Z"/>`;
  });
  steps.forEach(([name, v], i) => {
    const r = rows[i];
    const cy = r.y + barH / 2;
    body += text(0, cy, name, 'label', { cls: 'mid' });
    body += `<path ${mark(`class="bar grow-x ${toneOf(i)}" d="${V.barRight(x0, r.y, r.x1 - x0, barH)}"`, v, `${fmt(v)}${unit}|${name}`)}/>`;
    body += text(r.x1 + 7, cy, fmt(v), 'value', { cls: 'mid' });
    if (i) body += text(w, cy, `${Math.round((v / steps[i - 1][1]) * 100)}%`, 'axis', { anchor: 'end', cls: 'mid' });
  });
  body += vline(x0 - 1, 0, h, 'axis');
  return svg(w, h, describe(title, steps, unit), body);
};

/* ---------- 순위 막대 ---------- */
V.rank = (w, h, { rows, unit = '', max = null, format = fmt, tones = null, title = '' }) => {
  const labelOf = (v) => `${format(v)}${format === fmt ? unit : ''}`;
  const labelW = widest(rows.map((r) => r[0]), 'label');
  const valW = widest(rows.map((r) => labelOf(r[1])), 'strong');
  const x0 = labelW + 10;
  const x = linear(0, max ?? Math.max(...rows.map((r) => r[1])), x0, w - valW - 8);
  const rowH = h / rows.length;
  const barH = Math.max(6, Math.min(14, Math.round(rowH * 0.5)));
  let body = vline(x0 - 1, 0, h, 'axis');
  rows.forEach(([name, v], i) => {
    const cy = rowH * (i + 0.5);
    const y0 = Math.round(cy - barH / 2);
    const x1 = Math.round(x(v));
    body += text(0, cy, name, 'label', { cls: 'mid' });
    body += `<path ${mark(`class="bar grow-x ${tones ? tones[i] : 'm-yellow'}" d="${V.barRight(x0, y0, x1 - x0, barH)}"`, v, `${labelOf(v)}|${name}`)}/>`;
    body += text(x1 + 7, cy, labelOf(v), 'strong', { cls: 'mid' });
  });
  return svg(w, h, describe(title, rows, unit, format), body);
};

/* ---------- 가로 누적 막대(행마다 구성). endText를 주면 끝 글자를 바꾼다. ---------- */
V.stackRows = (w, h, { rows, series, tones, unit = '', legendCount = series.length, endText = null, track = null, title = '' }) => {
  const legendH = 22;
  const labelW = widest(rows.map((r) => r[0]), 'label');
  const totals = rows.map((r) => r[1].reduce((a, b) => a + b, 0));
  const ends = rows.map((r, i) => (endText ? endText(r, i) : `${fmt(totals[i])}${unit}`));
  const valW = widest(ends, 'strong');
  const x0 = labelW + 10;
  const span = track ?? Math.max(...totals);
  const x = linear(0, span, x0, w - valW - 8);
  const rowH = (h - legendH) / rows.length;
  const barH = Math.min(14, Math.round(rowH * 0.56));
  let body = legend(series.slice(0, legendCount), tones, 3);
  rows.forEach(([name, parts], i) => {
    const cy = legendH + rowH * (i + 0.5);
    const y0 = Math.round(cy - barH / 2);
    const e = V.edges(parts, totals[i], x0, x(totals[i]) - x0);
    body += text(0, cy, name, 'label', { cls: 'mid' });
    parts.forEach((v, k) => {
      if (!v) return;
      body += `<rect ${mark(`class="seg grow-x ${tones[k]}" x="${e[k]}" y="${y0}" width="${e[k + 1] - e[k]}" height="${barH}"`, v, `${fmt(v)}${unit}|${name} · ${series[k]}`)}/>`;
    });
    body += text(track ? w : e[e.length - 1] + 7, cy, ends[i], 'strong', { cls: 'mid', anchor: track ? 'end' : 'start' });
  });
  body += vline(x0 - 1, legendH, h, 'axis');
  return svg(w, h, describe(title, rows.map((r, i) => [r[0], totals[i]]), unit), body);
};
