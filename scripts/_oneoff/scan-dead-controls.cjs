/**
 * **죽은 컨트롤** 정적 스캐너 — 화면에 보이는데 결과에 영향이 없는 UI를 찾는다(읽기 전용).
 *
 * 계기(2026-07-23): 작성률 '월간'에서 과목 칩이 두 벌로 보였는데, 단순 중복이 아니라 **헤더 칩이
 * 월간 분기에선 아무 데도 안 쓰이는 죽은 컨트롤**이었다(눌러도 표가 안 바뀜). 원장 "이러한 이상한
 * 죽은 컨트롤 찾아봐 검수" → 같은 유형을 전수로 훑기 위한 도구.
 *
 * 검사 축(8):
 *   ① 부모·자식이 각자 같은 종류의 필터를 렌더(위 버그의 정확한 모양)
 *   ② optional 핸들러 prop인데 아무도 안 넘김 → 옵셔널 체이닝으로 조용한 무동작
 *   ③ 빈 핸들러 onX={() => {}}
 *   ④ 항상 비활성 disabled={true}
 *   ⑤ 본문 컴포넌트를 갈아끼우는 분기 + 한쪽에서만 쓰이는 파생값
 *   ⑥ 학원설정 필드인데 소비처 0(write-only orphan — CLAUDE.md가 못박은 패턴)
 *   ⑦ 서버 페이지네이션 목록에 화면(클라) 정렬 — "보이는 30건만" 정렬되는 거짓 정렬
 *   ⑧ 눌릴 것처럼 보이는데(cursor-pointer) 핸들러가 없는 요소
 *
 * ⚠️ **후보만** 낸다. 각 건은 코드를 열어 확인해야 한다(오탐 다수 — 예: 객체 리터럴로 넘기는 핸들러,
 *    워커·스크립트가 소비하는 설정, 부모 hover가 받는 핸들 등은 정적으로는 죽어 보인다).
 *
 * 사용: node scripts/_oneoff/scan-dead-controls.cjs [srcRoot]
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = (process.argv[2] || path.join(__dirname, "..", "..", "src")).replace(/\\/g, "/");
const BS = String.fromCharCode(92); // 셸 이스케이프 회피
const word = (n) => new RegExp(BS + "b" + n + BS + "b", "g");

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (!/node_modules|\.next/.test(p)) walk(p);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(ROOT);
const src = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const tsx = files.filter((f) => f.endsWith(".tsx"));
const all = [...src.values()].join("\n");
const rel = (f) => f.replace(ROOT + "/", "");
const section = (t) => console.log(`\n${t}`);
let found = 0;
const hit = (line) => {
  found++;
  console.log(`   ${line}`);
};

// ── ① 부모·자식 필터 중복 ──────────────────────────────────────────────
const hasFilter = (s) => /aria-pressed|useState\("all"\)|\{ value: "all"/.test(s);
const byComp = new Map();
for (const [f, s] of src) for (const m of s.matchAll(/export function ([A-Z]\w+)/g)) byComp.set(m[1], f);
section("[①] 부모·자식이 각자 필터를 가진 쌍");
{
  const seen = new Set();
  for (const f of tsx) {
    const s = src.get(f);
    if (!hasFilter(s)) continue;
    for (const m of s.matchAll(/<([A-Z]\w+)[\s/>]/g)) {
      const child = byComp.get(m[1]);
      if (!child || child === f) continue;
      if (!hasFilter(src.get(child))) continue;
      const key = `${f}→${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hit(`${rel(f)}  └ <${m[1]}> ${rel(child)}`);
    }
  }
}

// ── ② 아무도 안 넘기는 optional 핸들러 ─────────────────────────────────
section("[②] optional 핸들러 prop인데 전달처 없음");
for (const [f, s] of src) {
  for (const m of s.matchAll(/^\s*(on[A-Z]\w*)\?:/gm)) {
    const n = m[1];
    // `onX={` (JSX) 또는 `onX: ` (객체 리터럴 전달) 둘 다 전달로 인정.
    // ⚠️ 선언부는 `onX?:`(물음표)라 이 정규식에 애초에 안 걸린다 — 선언 수를 빼지 말 것.
    //    빼면 전달처가 1곳뿐인 **정상** prop이 전부 오탐으로 뜬다(첫 판에서 실제로 그랬다).
    const passes = (all.match(new RegExp(n + "(=\\{|:\\s)", "g")) || []).length;
    if (passes === 0) hit(`${n}  ${rel(f)}`);
  }
}

// ── ③④ 빈 핸들러 / 항상 비활성 ────────────────────────────────────────
section("[③] 빈 핸들러 onX={() => {}}");
for (const [f, s] of src) for (const h of s.match(/on[A-Z]\w*=\{\(\)\s*=>\s*\{\s*\}\}/g) || []) hit(`${rel(f)}  ${h}`);
section("[④] 항상 비활성 disabled={true}");
for (const [f, s] of src) for (const h of s.match(/disabled=\{true\}/g) || []) hit(`${rel(f)}  ${h}`);

// ── ⑤ 본문 분기 + 얇게 쓰이는 파생값 ──────────────────────────────────
section("[⑤] 본문 컴포넌트 분기 + 한쪽에서만 쓰이는 파생값");
for (const f of tsx) {
  const s = src.get(f);
  if (!/\?\s*\(?\s*<[A-Z]\w+/.test(s)) continue;
  const states = [...s.matchAll(/const \[(\w+), set\w+\] = useState/g)]
    .map((m) => m[1])
    .filter((n) => /^(sel|filter|subject|status|tab|mode|sort|kind|scope)/i.test(n));
  if (!states.length) continue;
  const thin = [...s.matchAll(/const (\w+) = [^\n]*?\.filter\(/g)]
    .map((m) => m[1])
    .filter((d) => (s.match(word(d)) || []).length <= 3);
  if (thin.length) hit(`${rel(f)}  상태:${states.join(",")} 파생:${thin.join(",")}`);
}

// ── ⑥ 학원설정 orphan ─────────────────────────────────────────────────
section("[⑥] 학원설정 필드인데 소비처 0 (owner 폴더·테스트 제외)");
{
  const tf = ROOT + "/features/owner/settings-types.ts";
  if (fs.existsSync(tf)) {
    const t = fs.readFileSync(tf, "utf8");
    const consumers = files.filter((f) => !/\/owner\/|\.test\./.test(f));
    for (const [, name, body] of t.matchAll(/const (\w+)Schema = z\.object\(\{([^]*?)\n\}\)/g)) {
      for (const m of body.matchAll(/^\s{2}(\w+):/gm)) {
        const field = m[1];
        const used = consumers.some((f) => new RegExp("[.]" + field + BS + "b").test(src.get(f)));
        if (!used) hit(`${name}.${field}  ⚠️ 폼에 입력이 **보이는지** 확인(숨김이면 정상)`);
      }
    }
  }
}

// ── ⑦ 서버 페이지네이션 + 클라 정렬 ───────────────────────────────────
section("[⑦] 서버 페이지네이션 목록에 화면(클라) 정렬");
for (const f of tsx) {
  const s = src.get(f);
  if (/sortRows\(/.test(s) && /totalPages|pageSize|PAGE_SIZE/.test(s)) hit(rel(f));
}

// ── ⑧ 눌릴 것처럼 보이는데 핸들러 없음 ────────────────────────────────
section("[⑧] cursor-pointer인데 핸들러 없음");
for (const f of tsx) {
  const s = src.get(f);
  for (const m of s.matchAll(/<(div|span|p|li|td|tr|section|article)\s([^]*?)>/g)) {
    if (!/cursor-pointer/.test(m[2])) continue;
    if (/onClick|onPointerDown|onMouseDown|href=|role="button"/.test(m[2])) continue;
    const around = s.slice(Math.max(0, m.index - 200), m.index + m[0].length + 300);
    if (/<label|<input|<button/.test(around)) continue;
    hit(`${rel(f)}:${s.slice(0, m.index).split("\n").length}  <${m[1]}>`);
  }
}

console.log(`\n스캔 파일 ${files.length}개 · 후보 ${found}건 (전부 수동 확인 대상)`);
