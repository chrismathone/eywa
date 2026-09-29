// 설명서 생성기 — HTML 조립과 쪽 나누기. 쪽 나누기는 브라우저에 맡기지 않고 블록 단위로 직접 담는다:
// 블록은 절대 쪼개지지 않고, data-keep 블록(제목·도입문)은 다음 블록과 같은 쪽에 붙는다.
import fs from "node:fs";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (v, t) => `${((v / t) * 100).toFixed(3)}%`;

const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin:0; }
body { font-family: Pretendard, "Malgun Gothic", sans-serif; color:#121212; font-size:10pt; line-height:1.55; word-break:keep-all; }
.sheet { width:210mm; height:297mm; padding:13mm 14mm 0; position:relative; overflow:hidden; break-after:page; }
.sheet:last-child { break-after:auto; }
.body { height:262mm; }
.foot { position:absolute; left:14mm; right:14mm; bottom:9mm; display:flex; justify-content:space-between; font-size:7.5pt; color:#777; }
#src { position:absolute; left:-9999px; top:0; width:182mm; }
.blk { display:flow-root; }
.top { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #153e75; padding-bottom:6px; margin-bottom:10px; }
.crumb { color:#153e75; font-weight:700; font-size:8.5pt; }
h1 { font-size:21pt; margin:0; letter-spacing:-.02em; line-height:1.2; }
.meta { font-size:7.5pt; color:#555; text-align:right; }
.lead { font-size:10.5pt; margin:0 0 10px; }
.off { background:#fff8e6; border:1px solid #f1d38a; border-radius:6px; padding:7px 11px; font-size:9.5pt; margin:0 0 10px; }
.shot { position:relative; margin:10px 10px 0 10px; border:1px solid #cfd4dc; border-radius:6px; }
.shot img { display:block; width:100%; border-radius:6px; }
.hl { position:absolute; outline:2px solid #e8590c; outline-offset:1px; border-radius:4px; }
.badge { position:absolute; transform:translate(-50%,-50%); width:19px; height:19px; border-radius:50%; background:#e8590c; color:#fff; font-size:9pt; font-weight:800; display:grid; place-items:center; box-shadow:0 0 0 2px #fff; }
.cap { font-size:8pt; color:#555; margin:4px 0 0; }
h2 { font-size:12.5pt; margin:0; padding:14px 0 6px; color:#153e75; }
.co { display:grid; grid-template-columns:28px 104px 1fr; gap:0 6px; border-top:1px solid #e3e3e3; padding:5px 0; }
.dot { display:inline-grid; place-items:center; width:19px; height:19px; border-radius:50%; background:#e8590c; color:#fff; font-weight:800; font-size:8.5pt; margin-left:4px; }
.step { display:grid; grid-template-columns:28px 1fr; border:1px solid #e3e3e3; border-radius:6px; padding:6px 10px; margin-bottom:5px; }
.step b { display:block; }
.num { width:20px; height:20px; border-radius:5px; background:#153e75; color:#fff; font-weight:800; display:grid; place-items:center; font-size:9pt; margin-top:1px; }
.see { color:#153e75; font-size:8.5pt; font-weight:700; }
.qa { padding-bottom:6px; }
.tip { background:#f5f7fb; border:1px solid #dbe3f0; border-radius:6px; padding:7px 11px; margin-top:6px; font-size:9pt; }
.cover { height:262mm; display:flex; flex-direction:column; justify-content:center; }
.cover .brand { color:#153e75; font-weight:800; font-size:14pt; letter-spacing:.04em; }
.cover h1 { font-size:34pt; margin:6px 0 10px; }
.cover p { font-size:11pt; color:#333; margin:0 0 4px; }
.gtitle { border-left:0; background:#153e75; color:#fff; border-radius:8px; padding:14px 16px; margin:0 0 12px; }
.gtitle .k { font-size:9pt; opacity:.8; } .gtitle .t { font-size:20pt; font-weight:800; }
.toc-g { font-weight:800; color:#153e75; font-size:11.5pt; padding:10px 0 3px; }
.toc-m { font-weight:700; padding:3px 0 1px 8px; }
.toc-f { display:flex; gap:6px; padding:1px 0 1px 24px; font-size:9.5pt; }
.toc-f .dots { flex:1; border-bottom:1px dotted #bbb; margin-bottom:4px; }
.toc-f .pg { width:26px; text-align:right; font-variant-numeric:tabular-nums; }
.toc-f.off-f { color:#777; }
.toc-f.toc-one { padding-left:8px; font-weight:700; font-size:10pt; padding-top:3px; }
`;

/**
 * 번호 배지 자리 고르기 — 배지가 설명할 칸의 글자를 덮지 않게 칸 **바깥**에 두되,
 * 다른 번호 칸·이미 놓은 배지와 겹치지 않는 자리를 후보 중에서 고른다(좌상 → 왼쪽 가운데 → 우상 → 좌하 → 오른쪽 가운데).
 */
function placeBadges(shot) {
  const r = (9.5 / 680) * shot.w + 1; // 배지 반지름(스크린샷 px) — 그림은 A4 폭 약 680px로 줄어든다
  const boxes = shot.boxes;
  const hit = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const placed = [];
  return boxes.map((b, i) => {
    const cands = [
      [b.x - r, b.y - r], [b.x - r - 1, b.y + b.h / 2], [b.x + b.w + r, b.y - r],
      [b.x - r, b.y + b.h + r], [b.x + b.w + r + 1, b.y + b.h / 2], [b.x + r, b.y - r],
    ];
    let best = null;
    cands.forEach(([cx, cy], k) => {
      const c = { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r };
      let cost = k * 2;
      if (c.x1 < 0 || c.y1 < 0 || c.x2 > shot.w || c.y2 > shot.h) cost += 400;
      boxes.forEach((o, j) => { if (j !== i) cost += hit(c, { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + o.h }) / (r * r) * 60; });
      cost += hit(c, { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }) / (r * r) * 40;
      placed.forEach((p) => { cost += hit(c, p) / (r * r) * 300; });
      for (const t of shot.texts ?? []) cost += hit(c, { x1: t.x, y1: t.y, x2: t.x + t.w, y2: t.y + t.h }) / (r * r) * 25;
      if (!best || cost < best.cost) best = { cost, c, cx, cy };
    });
    placed.push(best.c);
    return { n: b.n, cx: Math.min(Math.max(best.cx, r), shot.w - r), cy: Math.min(Math.max(best.cy, r), shot.h - r) };
  });
}

/** 면 하나 → 블록 배열. shot 이 없으면 글만(기능이 꺼진 면). */
export function faceBlocks({ crumb, title, page, shot, png, stamp, offNote }) {
  const spots = shot ? placeBadges(shot) : [];
  const marks = shot ? shot.boxes.map((b, i) => `
    <div class="hl" style="left:${pct(b.x, shot.w)};top:${pct(b.y, shot.h)};width:${pct(b.w, shot.w)};height:${pct(b.h, shot.h)}"></div>
    <div class="badge" style="left:${pct(spots[i].cx, shot.w)};top:${pct(spots[i].cy, shot.h)}">${b.n}</div>`).join("") : "";
  const blocks = [
    `<div class="top" data-keep><div><div class="crumb">${esc(crumb)}</div><h1>${esc(title)}</h1></div><div class="meta">에이와 사용 설명서<br>${esc(stamp)}</div></div>`,
    `<p class="lead" data-keep>${esc(page.lead)}</p>`,
  ];
  if (offNote) blocks.push(`<div class="off" data-keep>${esc(offNote)}</div>`);
  if (shot) blocks.push(`<div><div class="shot"><img src="data:image/png;base64,${png}">${marks}</div><p class="cap">예시 화면(데모 지점) · 주황 번호는 아래 설명 번호와 같습니다.</p></div>`);
  if (page.callouts?.length) {
    blocks.push(`<h2 data-keep>화면 각 부분</h2>`);
    for (const c of page.callouts) blocks.push(`<div class="co" data-group="co">${shot ? `<span class="dot">${c.n}</span>` : `<span class="dot" style="background:#8a8f98">${c.n}</span>`}<b>${esc(c.label)}</b><span>${esc(c.body)}</span></div>`);
  }
  if (page.setup?.length) {
    blocks.push(`<h2 data-keep>처음 세팅 순서</h2>`);
    page.setup.forEach((st, i) => blocks.push(`<div class="step" data-group="step"><span class="num">${i + 1}</span><div><b>${esc(st.title)}</b>${esc(st.body)}</div></div>`));
  }
  if (page.faq?.length) {
    blocks.push(`<h2 data-keep>자주 막히는 점</h2>`);
    for (const q of page.faq) blocks.push(`<div class="qa" data-group="qa"><b>Q. ${esc(q.q)}</b><div>${esc(q.a)}</div></div>`);
  }
  // 마지막 '함께 보면 좋은 화면' 상자가 홀로 다음 쪽에 떨어지지 않게 바로 앞 블록과 붙인다.
  if (page.related?.length) blocks[blocks.length - 1] = blocks[blocks.length - 1].replace(/^<(\w+)/, "<$1 data-keep");
  if (page.related?.length) blocks.push(`<div class="tip"><b>함께 보면 좋은 화면</b> ${page.related.map(esc).join(" · ")}<br>화면에서 <b>F1</b> 키를 누르면 화면 위에 각 부분 설명이 번호와 함께 겹쳐 보입니다.</div>`);
  return blocks;
}

/**
 * sections: [{ id, foot, blocks, newPage }] → 완성 HTML. 쪽 나누기·쪽 번호·목차 쪽 번호 채우기는 브라우저 안 스크립트가 한다.
 * 목차의 쪽 번호 자리 = <span class="pg" data-for="섹션id">.
 */
export function documentHtml(sections) {
  const src = sections.map((s) => s.blocks.map((b, i) =>
    `<div class="blk" data-sec="${esc(s.id)}" data-foot="${esc(s.foot)}"${i === 0 && s.newPage ? " data-newpage" : ""}>${b}</div>`).join("")).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>에이와 학원 운영 프로그램 사용 설명서</title><style>${CSS}</style></head><body>
<div id="src">${src}</div>
<script>
function layout() {
  const MM = 96 / 25.4, room = 262 * MM;
  const els = [...document.querySelectorAll("#src > .blk")];
  const h = els.map((e) => e.getBoundingClientRect().height);
  const keep = els.map((e) => !!e.firstElementChild?.hasAttribute("data-keep"));
  const group = els.map((e) => e.firstElementChild?.getAttribute("data-group") ?? null);
  const pages = [[]]; let used = 0;
  for (let i = 0; i < els.length; i++) {
    let j = i, need = h[i];
    while (keep[j] && j + 1 < els.length && !els[j + 1].hasAttribute("data-newpage")) { j++; need += h[j]; }
    let br = used > 0 && (els[i].hasAttribute("data-newpage") || used + need > room);
    // 목록 끝의 한 줄만 다음 쪽으로 떨어지지 않게.
    const g = group[j];
    if (!br && g && group[j + 1] === g && group[j + 2] !== g && group[j - 1] === g && used + need + h[j + 1] > room) br = true;
    if (br) { pages.push([]); used = 0; }
    for (let k = i; k <= j; k++) { pages.at(-1).push(els[k]); used += h[k]; }
    i = j;
  }
  const total = pages.length;
  const start = {};
  pages.forEach((list, n) => {
    const sheet = document.createElement("section"); sheet.className = "sheet";
    const body = document.createElement("div"); body.className = "body";
    list.forEach((e) => { body.appendChild(e); if (!(e.dataset.sec in start)) start[e.dataset.sec] = n + 1; });
    const foot = document.createElement("div"); foot.className = "foot";
    foot.innerHTML = "<span></span><span></span>";
    foot.children[0].textContent = list[0]?.dataset.foot ?? "";
    foot.children[1].textContent = (n + 1) + " / " + total;
    sheet.append(body, foot); document.body.appendChild(sheet);
  });
  document.getElementById("src").remove();
  for (const s of document.querySelectorAll(".pg[data-for]")) s.textContent = start[s.dataset.for] ?? "–";
  window.__total = els.length;
  window.__layout = [...document.querySelectorAll(".sheet .body")].map((b) => ({
    overflow: b.lastElementChild.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom + 0.5,
    overflowBy: Math.round(b.lastElementChild.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom),
    fill: Math.round(((b.lastElementChild.getBoundingClientRect().bottom - b.getBoundingClientRect().top) / b.clientHeight) * 100),
    blocks: b.children.length,
  }));
  window.__start = start;
}
Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => document.fonts.ready).then(layout);
</script></body></html>`;
}

/** HTML → PDF. 넘친 쪽·빠진 블록이 있으면 PDF를 만들지 않고 이유를 돌려준다. maxPages 는 면 하나일 때 3. */
export async function toPdf(browser, html, file, { maxPages = Infinity, htmlFile } = {}) {
  if (htmlFile) fs.writeFileSync(htmlFile, html);
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction(() => window.__layout, null, { timeout: 60_000 });
    const layout = await page.evaluate(() => window.__layout);
    const total = await page.evaluate(() => window.__total);
    const bad = [];
    layout.forEach((p, i) => { if (p.overflow) bad.push(`${i + 1}쪽이 ${p.overflowBy}px 넘침(블록 하나가 한 쪽보다 큼)`); });
    const placed = layout.reduce((a, p) => a + p.blocks, 0);
    if (placed !== total) bad.push(`블록 ${total}개 중 ${placed}개만 쪽에 들어감`);
    if (layout.length > maxPages) bad.push(`${layout.length}쪽 — ${maxPages}쪽을 넘음`);
    if (bad.length) return { ok: false, bad, layout };
    await page.pdf({ path: file, format: "A4", printBackground: true, preferCSSPageSize: true });
    return { ok: true, layout, start: await page.evaluate(() => window.__start) };
  } finally {
    await page.close();
  }
}
