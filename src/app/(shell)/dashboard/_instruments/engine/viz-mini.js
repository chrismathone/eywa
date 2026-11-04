/* KPI 칸 오른쪽의 작은 그래프. 숫자 자체는 KPI 칸이 보여 주고, 여기는 그 숫자를 이루는 실제 값만 그린다. */
import { V } from './viz-core';
const { px, fmt, linear, mark, svg } = V;

/* 최근 추이: 축 없이 모양만, 마지막 점 강조 */
V.spark = (w, h, { labels, values, unit = '', title = '' }) => {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = linear(0, values.length - 1, 5, w - 5);
  const y = linear(lo, hi === lo ? lo + 1 : hi, h - 6, 6);
  const pts = values.map((v, i) => [x(i), y(v)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p[0])} ${px(p[1])}`).join('');
  let body = V.hline(0, w, h - 1, 'axis');
  body += `<path class="line mini draw" pathLength="1" d="${d}"/>`;
  pts.forEach(([cx, cy], i) => {
    const last = i === pts.length - 1;
    body += `<circle ${mark(`class="pt mini${last ? ' end' : ''}" cx="${px(cx)}" cy="${px(cy)}" r="${last ? 3.5 : 2.5}"`, values[i], `${fmt(values[i])}${unit}|${labels[i]}`)}/>`;
  });
  return svg(w, h, `${title}: ${labels.map((l, i) => `${l} ${values[i]}${unit}`).join(', ')}`, body);
};

/* 기간별 건수: 기준 칸(기본은 가장 최근)만 노랑 */
V.miniColumns = (w, h, { labels, values, unit = '', emphasis = values.length - 1, title = '' }) => {
  const max = Math.max(...values, 1);
  const band = w / values.length;
  const barW = Math.max(3, Math.min(12, Math.floor(band * 0.62)));
  const y = linear(0, max, h - 1, 2);
  let body = '';
  values.forEach((v, i) => {
    const x0 = Math.round(band * (i + 0.5) - barW / 2);
    const bh = h - 1 - Math.round(y(v));
    const cls = i === emphasis ? 'm-yellow' : 'm-char';
    body += `<path ${mark(`class="bar grow-y ${cls}" d="${V.barUp(x0, h - 1, barW, bh, 1.5)}"`, v, `${fmt(v)}${unit}|${labels[i]}`)}/>`;
    body += `<rect class="hit-box" x="${px(band * i)}" y="0" width="${px(band)}" height="${h}" data-viz-tip="${V.esc(`${fmt(v)}${unit}|${labels[i]}`)}"/>`;
  });
  body += V.hline(0, w, h - 1, 'axis');
  return svg(w, h, `${title}: ${labels.map((l, i) => `${l} ${values[i]}${unit}`).join(', ')}`, body);
};

/* 이달 누적 계단: 등록한 날마다 한 칸 오른다. 전일 등록분(마지막 계단)만 노랑. */
V.miniSteps = (w, h, { dates, today, days = 31, unit = '', title = '' }) => {
  const dayOf = (d) => Number(d.split('/')[1]);
  const x = linear(1, days, 1, w - 5);
  const y = linear(0, dates.length, h - 1, 5);
  const steps = dates.map((date, i) => ({ date, x: px(x(dayOf(date))), y: px(y(i + 1)), prev: px(y(i)) }));
  const end = px(x(today));
  const tail = steps[steps.length - 1];
  let d = `M${px(x(1))} ${px(y(0))}`;
  steps.slice(0, -1).forEach((s) => { d += `H${s.x}V${s.y}`; });
  d += `H${tail.x}`;
  let body = `<path class="area" d="${d}V${tail.y}H${end}V${h - 1}H${px(x(1))}Z"/>`;
  body += V.hline(0, w, h - 1, 'axis');
  body += `<path class="line mini draw" pathLength="1" d="${d}"/>`;
  body += `<path class="line mini stroke-yellow step-last" d="M${tail.x} ${tail.prev}V${tail.y}H${end}"/>`;
  body += `<circle ${mark(`class="pt mini end" cx="${end}" cy="${tail.y}" r="3.5"`, dates.length)}/>`;
  steps.forEach((s, i) => {
    const next = i < steps.length - 1 ? steps[i + 1].x : w;
    body += `<rect class="hit-box" x="${s.x}" y="0" width="${px(next - s.x)}" height="${h}" data-viz-tip="${V.esc(`${s.date} 등록 · 누적 ${i + 1}${unit}|${title}`)}"/>`;
  });
  return svg(w, h, `${title}: ${dates.join(', ')}, 합계 ${dates.length}${unit}`, body);
};
