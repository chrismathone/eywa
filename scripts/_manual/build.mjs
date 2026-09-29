// 설명서 생성기 2단계 — 조립. 촬영을 통과한 스크린샷 + 면 파일 → 면별 PDF · 메뉴별 PDF · 전체 한 권(표지·목차·처음 시작하기).
// node --env-file=.env.local scripts/_manual/build.mjs [메뉴 | 메뉴/면]   (인자가 없으면 책까지 만든다)
import fs from "node:fs";
import path from "node:path";
import { REPO, MANUAL, OUT, require, readToc, flatFaces, selectFaces, readPage, shotBase, demoSession, moduleEnabled } from "./lib.mjs";
import { esc, faceBlocks, documentHtml, toPdf } from "./render.mjs";

const { chromium } = require("@playwright/test");
const arg = process.argv[2];
const toc = readToc();
const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date());
const stamp = date; // 만든 날짜만 적는다(원장 2026-09-23 — 판 번호는 필요 없음)
const clean = (s) => s.replace(/[\\/:*?"<>|]/g, "·").trim();
const n2 = (i) => String(i + 1).padStart(2, "0");

const { admin, tenantId } = await demoSession("master");
const report = [];
// 기능 이름은 영문 코드가 아니라 학원 설정 '기능' 면에 보이는 한글 이름으로(src/lib/modules.ts).
const MODULE_LABEL = Object.fromEntries([...fs.readFileSync(path.join(REPO, "src/lib/modules.ts"), "utf8").matchAll(/id:\s*"(\w+)",\s*label:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));

/** 면 하나의 재료. 쓸 수 없으면 null + 사유. */
async function material(f) {
  const page = readPage(f);
  if (!page) return { skip: "내용 파일 없음" };
  const base = shotBase(f);
  const on = await moduleEnabled(admin, tenantId, f.module);
  const hasShot = page.shot !== false && fs.existsSync(`${base}.png`) && fs.existsSync(`${base}.json`);
  if (!hasShot && on && page.shot !== false) return { skip: "촬영을 통과한 스크린샷이 없음" };
  const shot = hasShot ? JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) : null;
  const png = hasShot ? fs.readFileSync(`${base}.png`).toString("base64") : null;
  const offNote = hasShot ? null : page.shot === false && on ? page.noShotNote : `이 화면은 ‘${MODULE_LABEL[f.module] ?? "해당"}’ 기능을 켠 학원에서만 보입니다. 학원 설정 › 기능에서 켤 수 있으며, 켠 뒤에 이 설명서를 다시 만들면 화면 예시가 들어갑니다.`;
  const crumb = `${f.group.title} › ${f.menu.title}`;
  return { page, shot, png, offNote, moduleOff: !on, crumb, foot: `${f.group.title} › ${f.menu.title} › ${f.face.title}` };
}

function dirs(f) {
  const g = path.join(OUT, `${f.gi + 1}_${clean(f.group.title)}`);
  const m = path.join(g, `${n2(f.mi)}_${clean(f.menu.title)}`);
  return { g, m, face: path.join(m, `${n2(f.fi)}_${clean(f.face.title)}.pdf`), menu: path.join(g, `${n2(f.mi)}_${clean(f.menu.title)}.pdf`) };
}

const browser = await chromium.launch({ channel: "chrome" });
const targets = selectFaces(arg);
const mats = new Map();

// ── 면별 PDF ──
for (const f of targets) {
  const m = await material(f);
  if (m.skip) { report.push(`✗ ${f.id} — ${m.skip}`); continue; }
  mats.set(f.id, m);
  const d = dirs(f); fs.mkdirSync(d.m, { recursive: true });
  const html = documentHtml([{ id: f.id, foot: m.foot, blocks: faceBlocks({ ...m, title: f.face.title, stamp }) }]);
  const r = await toPdf(browser, html, d.face, { maxPages: 3 });
  if (!r.ok) { report.push(`✗ ${f.id} — PDF 중단: ${r.bad.join(" / ")}`); mats.delete(f.id); continue; }
  const last = r.layout.at(-1).fill;
  report.push(`✓ ${f.id} — ${r.layout.length}쪽 (${r.layout.map((p) => p.fill + "%").join(" · ")})${m.moduleOff ? " · 기능 꺼짐(글만)" : m.offNote ? " · 글만" : ""}${r.layout.length > 1 && last < 15 ? " · ⚠ 마지막 쪽이 거의 빔" : ""}`);
}

// ── 메뉴별 묶음 PDF ──
const menus = new Map();
for (const f of targets) if (mats.has(f.id)) menus.set(`${f.gi}/${f.mi}`, [...(menus.get(`${f.gi}/${f.mi}`) ?? []), f]);
for (const list of menus.values()) {
  if (list.length < 2) continue; // 면이 하나면 면 PDF가 곧 메뉴 PDF
  const sections = list.map((f) => { const m = mats.get(f.id); return { id: f.id, foot: m.foot, newPage: true, blocks: faceBlocks({ ...m, title: f.face.title, stamp }) }; });
  const r = await toPdf(browser, documentHtml(sections), dirs(list[0]).menu);
  report.push(r.ok ? `✓ 메뉴 ${list[0].menu.title} — ${r.layout.length}쪽` : `✗ 메뉴 ${list[0].menu.title} — ${r.bad.join(" / ")}`);
}

// ── 전체 한 권 (인자 없이 돌렸을 때만) ──
if (!arg) {
  const all = flatFaces(toc).filter((f) => mats.has(f.id));
  const sections = [];
  sections.push({ id: "cover", foot: "", blocks: [`<div class="cover"><div class="brand">에이와</div><h1>학원 운영 프로그램<br>사용 설명서</h1><p>처음 오신 원장님이 이 책만 보고 학원을 세팅할 수 있도록, 메뉴와 화면마다 나눠 설명했습니다.</p><p>${esc(stamp)}</p></div>`] });
  // 목차 — 그룹 · 메뉴 · 면. 쪽 번호는 조립 뒤에 채워진다.
  const tocBlocks = [`<h2 data-keep style="padding-top:0;font-size:18pt;color:#121212">목차</h2>`,
    `<div class="toc-f"><span>처음 시작하기</span><span class="dots"></span><span class="pg" data-for="start">–</span></div>`];
  toc.groups.forEach((g, gi) => {
    tocBlocks.push(`<div class="toc-g" data-keep>${gi + 1}. ${esc(g.title)}</div>`);
    g.menus.forEach((m) => {
      const faces = m.faces.map((face) => all.find((f) => f.menu.slug === m.slug && f.face.slug === face.slug)).filter(Boolean);
      if (!faces.length) return;
      // 면이 하나뿐인 메뉴는 '메뉴 제목 + 같은 이름의 면' 두 줄 대신 메뉴 한 줄로.
      if (m.faces.length === 1) {
        const f = faces[0]; const off = mats.get(f.id).moduleOff;
        tocBlocks.push(`<div class="toc-f toc-one${off ? " off-f" : ""}"><span>${esc(m.title)}${off ? " (기능을 켜야 보임)" : ""}</span><span class="dots"></span><span class="pg" data-for="${f.id}">–</span></div>`);
        return;
      }
      tocBlocks.push(`<div><div class="toc-m">${esc(m.title)}</div>${faces.map((f) => `<div class="toc-f${mats.get(f.id).moduleOff ? " off-f" : ""}"><span>${esc(f.face.title)}${mats.get(f.id).moduleOff ? " (기능을 켜야 보임)" : ""}</span><span class="dots"></span><span class="pg" data-for="${f.id}">–</span></div>`).join("")}</div>`);
    });
  });
  sections.push({ id: "toc", foot: "목차", newPage: true, blocks: tocBlocks });
  sections.push({ id: "start", foot: "처음 시작하기", newPage: true, blocks: startBlocks(all) });
  toc.groups.forEach((g, gi) => {
    const faces = all.filter((f) => f.gi === gi);
    faces.forEach((f, k) => {
      const m = mats.get(f.id);
      const blocks = faceBlocks({ ...m, title: f.face.title, stamp });
      if (k === 0) blocks.unshift(`<div class="gtitle" data-keep><div class="k">${gi + 1}부</div><div class="t">${esc(g.title)}</div></div>`);
      sections.push({ id: f.id, foot: m.foot, newPage: true, blocks });
    });
  });
  fs.mkdirSync(OUT, { recursive: true });
  const r = await toPdf(browser, documentHtml(sections), path.join(OUT, process.env.MANUAL_BOOK ?? "에이와-사용설명서.pdf"));
  report.push(r.ok ? `✓ 전체 한 권 — ${r.layout.length}쪽` : `✗ 전체 한 권 — ${r.bad.join(" / ")}`);
}
await browser.close();

// '처음 시작하기' — 단계 목록은 앱의 시작하기 카드(onboarding/steps.ts)가 원본이다. 설명은 00-start.json.
function startBlocks(all) {
  const start = JSON.parse(fs.readFileSync(path.join(MANUAL, "pages/00-start.json"), "utf8"));
  const src = fs.readFileSync(path.join(REPO, "src/features/onboarding/steps.ts"), "utf8");
  const steps = [...src.matchAll(/key:\s*"(\w+)",\s*label:\s*"([^"]+)",\s*hint:\s*"([^"]+)"/g)].map((m) => ({ key: m[1], label: m[2], hint: m[3] }));
  const missing = steps.filter((s) => !start.steps[s.key]).map((s) => s.key);
  if (missing.length) throw new Error(`00-start.json 에 설명이 없는 시작 단계: ${missing.join(", ")} — 앱의 시작하기 카드가 바뀌었습니다.`);
  const blocks = [
    `<div class="top" data-keep><div><div class="crumb">시작</div><h1>처음 시작하기</h1></div><div class="meta">에이와 사용 설명서<br>${esc(stamp)}</div></div>`,
    `<p class="lead">${esc(start.lead)}</p>`,
  ];
  steps.forEach((s, i) => {
    const st = start.steps[s.key];
    const see = (st.see ?? []).map((id) => all.find((f) => f.id === id)).filter(Boolean)
      .map((f) => `${esc(f.menu.title)} › ${esc(f.face.title)} (<span class="pg" data-for="${f.id}">–</span>쪽)`).join(" · ");
    blocks.push(`<div class="step" data-group="step"><span class="num">${i + 1}</span><div><b>${esc(s.label)}</b>${esc(st.body)}${see ? `<div class="see">자세히 → ${see}</div>` : ""}</div></div>`);
  });
  if (start.after) blocks.push(`<div class="tip">${esc(start.after)}</div>`);
  return blocks;
}

for (const line of report) console.log(line);
process.exitCode = report.some((l) => l.startsWith("✗")) ? 1 : 0;
