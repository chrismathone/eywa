// 상담 평점 — 협의·교정용 표본 만들기(로컬 전용). 이름·번호를 가린 카드 텍스트와 id 대응표를 ~/eywa-data/consult-rating/ 에만 쓴다.
// node scripts/_oneoff/consult-rating/sample.mjs <개수> <시드> <이름>   (예: 24 1 codex1)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const DIR = join(homedir(), "eywa-data", "consult-rating");
const [n = "24", seed = "1", tag = "sample"] = process.argv.slice(2);
const rows = readFileSync(join(DIR, "cs-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
// 시드 난수(mulberry32)
let s = Number(seed) * 2654435761 >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const norm = (x) => x.replace(/\s+/g, "");
const dupCount = new Map(); const dupStudents = new Map();
for (const r of rows) { const k = norm(r.summary); dupCount.set(k, (dupCount.get(k) || 0) + 1); (dupStudents.get(k) || dupStudents.set(k, new Set()).get(k)).add(r.student_id); }
const kind = (r) => r.has_transcript ? "audio" : dupStudents.get(norm(r.summary)).size > 1 ? "copied" : /✅ 상담 내역/.test(r.summary) ? "form" : r.from_makeedu ? "makeedu" : /^\[[^\]]+\]/.test(r.summary.trim()) ? "bracket" : r.summary.trim().length < 60 ? "short" : "free";
const want = { audio: 1, copied: 3, form: 6, makeedu: 4, bracket: 4, short: 3, free: 3 };
const scale = Number(n) / 24;
const picked = [];
for (const [k, c] of Object.entries(want)) {
  const pool = rows.filter((r) => kind(r) === k).sort((a, b) => a.id.localeCompare(b.id));
  const cnt = Math.max(1, Math.round(c * scale));
  const used = new Set(); const seenText = new Set();
  let guard = 0;
  while (used.size < Math.min(cnt, pool.length) && guard++ < 5000) {
    const i = Math.floor(rnd() * pool.length);
    const key = norm(pool[i].summary);
    if (k === "copied" && seenText.has(key)) continue; // 같은 복사 묶음에서 둘을 뽑지 않는다
    seenText.add(key); used.add(i);
  }
  for (const i of used) picked.push(pool[i]);
}
picked.sort((a, b) => a.id.localeCompare(b.id));
const base = (name) => name.replace(/[A-Za-z]+$/, "");
const allNames = [...new Set(rows.map((r) => base(r.student)).filter((x) => /^[가-힣]{3}$/.test(x)))];
function mask(text, r) {
  let t = text;
  const nm = base(r.student);
  const names = [...new Set([nm, nm.length >= 3 ? nm.slice(1) : null].filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const x of names) t = t.split(x).join("○○");
  for (const x of allNames) if (t.includes(x)) t = t.split(x).join("△△");
  if (r.counselor) for (const x of [r.counselor, r.counselor.replace(/\(.*\)/, "")]) if (x.length >= 2) t = t.split(x).join("상담자");
  t = t.replace(/\[등록자:[^\]]*\]/g, "[등록자: 상담자]").replace(/\(\s*(Ellen|Anna|Jenny|Hannah|Jennifer|Yoojin)\s*\)/gi, "").replace(/0\d{1,2}-?\d{3,4}-?\d{4}/g, "<번호>");
  return t;
}
const cards = []; const map = {};
picked.forEach((r, i) => {
  const id = `s${i + 1}`; map[id] = r.id;
  const k = kind(r);
  const body = k === "audio" ? `[녹음 상담 — 직접 쓴 기록 없음. 녹음 요약(AI)]\n${mask(r.ai_summary || "", r)}` : mask(r.summary, r).slice(0, 1400);
  cards.push([
    `### ${id}`,
    `과목: ${r.subject ?? "—"} · 대상: ${r.audience === "parent" ? "학부모" : "미표기"} · 학년: ${r.student_status && r.grade ? r.grade : r.grade ?? "—"} · 출처: ${r.from_makeedu ? "메이크에듀 이관" : "에이와 입력"} · 글자 수: ${r.summary.trim().length}`
      + (k === "copied" ? ` · 같은 글이 ${dupCount.get(norm(r.summary))}건(서로 다른 학생 ${dupStudents.get(norm(r.summary)).size}명)에 입력됨` : ""),
    "```", body.trim(), "```",
  ].join("\n"));
});
// 하네스 입력 모양(가린 글) — Codex 블라인드 채점 브리프(codex-brief.ts)가 `consultationCard`로 카드를 만든다.
const PLACEHOLDER = "(녹음 분석 중)";
const masked = picked.map((r, i) => {
  const rec = r.has_transcript && r.summary.trim() === PLACEHOLDER;
  return { id: `s${i + 1}`, input: { id: r.id, summary: rec ? r.summary : mask(r.summary, r), subject: r.subject, audience: r.audience, grade: r.grade, followUpAction: r.follow_up_action ? mask(r.follow_up_action, r) : null,
    copyStudents: r.summary.trim() === PLACEHOLDER ? 1 : (norm(r.summary).length >= 12 ? dupStudents.get(norm(r.summary)).size : 1), transcript: rec ? mask(r.transcription ?? "", r) : null } };
});
mkdirSync(join(DIR, "samples"), { recursive: true });
writeFileSync(join(DIR, "samples", `${tag}.masked.json`), JSON.stringify(masked, null, 1));
writeFileSync(join(DIR, "samples", `${tag}.cards.md`), cards.join("\n\n") + "\n");
writeFileSync(join(DIR, "samples", `${tag}.map.json`), JSON.stringify(map, null, 1));
const rem = picked.filter((r) => base(r.student).length >= 2 && mask(r.summary, r).includes(base(r.student)));
console.log(`표본 ${picked.length}건 · 종류`, JSON.stringify(picked.reduce((a, r) => (a[kind(r)] = (a[kind(r)] || 0) + 1, a), {})), "· 가림 실패 의심", rem.length);
