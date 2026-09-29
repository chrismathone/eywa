// scripts/_classnote/provision-math-class-teachers.mjs — 수학 **반 보드**에 담당 선생님 연결.
//
// 원장 2026-09-29: 반 보드(provision-math-class-boards.mjs로 만든 것, 이름 = aywa 반 이름)에 그 반 담임을
// ClassNote 선생님으로 연결한다. 연결된 선생님은 그 반 글·학부모 글 알림을 받는다.
//
// 🔴 aywa 직원 ↔ ClassNote 선생님은 **ID 연결이 없다**(docs/classnote-integration.md §3 위생) → 아래 TEACHER_MAP에
//    사람이 확인한 대응만 적는다. 표에 없는 선생님은 건너뛴다(추측 금지). 퇴직(status≠active)도 건너뛴다.
//    2026-09-29 근거: 이름 일치 + 그 선생님 반 학생들의 1인 보드에 실제로 연결된 ClassNote 선생님(다수결)이 같은 사람.
//    이름이 다른 둘 — 김은정(Celine)=셀린(46건) · 이수진=수진T(46건, 문서 §3 "수진T(이수진)").
// 🔴 쓰기 = `POST /api/v1/employments/ {teacher, class_in_charge}`(한 건 추가). 배열 교체형 `/v1_2/teachers/{id}/employments`는
//    그 선생님의 다른 반을 지울 수 있어 쓰지 않는다. 해제 REST 없음(405) — 되돌리기는 ClassNote 화면에서.
// 🔴 매 실행 뒤 **선생님별 연결 수가 정확히 +배정 수**인지 확인(줄었으면 배열 교체가 일어난 것 — 중단).
//
// 실행: CLASSNOTE_TENANT_ID=… node --env-file=.env.local scripts/_classnote/provision-math-class-teachers.mjs [--apply] [--only="반"] [--limit=N]
import postgres from "postgres";
import { fetchBoards, fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { loadAywa } from "./math-class-boards-load.mjs";

// 대응표 = math-class-teachers.mjs(매일 동기화와 공용 — 한 곳만 고친다).
import { TEACHER_MAP } from "./math-class-teachers.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes("--apply");
const ONLY = arg("only");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const tenant = await resolveTenant(sql);
const { classes } = await loadAywa(sql, tenant);
const homeroom = new Map(
  (await sql`select c.id, u.display_name, u.status from classes c left join users u on u.id = c.teacher_id
    where c.id in ${sql(classes.map((c) => c.classId))}`).map((r) => [r.id, r]),
);
await sql.end();

const getEmps = (page, c) =>
  page.evaluate(async (c) => {
    const r = await fetch(`/api/v1_2/centers/${c}/employments`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`employments ${r.status}`);
    return r.json(); // ⚠️ DRF가 아니라 평배열
  }, c);
const countBy = (emps) => {
  const m = new Map();
  for (const e of emps) m.set(e.teacher_id, (m.get(e.teacher_id) ?? 0) + 1);
  return m;
};

const browser = await launchAdminBrowser();
let exitCode = 0;
try {
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);
  const emps = await getEmps(page, centerId);
  const has = new Set(emps.map((e) => `${e.teacher_id}|${e.class_in_charge}`));

  const todo = [];
  const skipped = [];
  for (const c of classes) {
    const b = boards.filter((x) => x.name === c.className);
    const h = homeroom.get(c.classId);
    if (b.length !== 1) { skipped.push(`${c.className}: 반 보드 ${b.length}개`); continue; }
    if (!h?.display_name) { skipped.push(`${c.className}: 담임 없음`); continue; }
    if (h.status !== "active") { skipped.push(`${c.className}: 담임 ${h.display_name} 퇴직`); continue; }
    const tid = TEACHER_MAP[h.display_name];
    if (!tid) { skipped.push(`${c.className}: ${h.display_name} — ClassNote 대응 미확인`); continue; }
    if (has.has(`${tid}|${b[0].id}`)) { skipped.push(`${c.className}: ${h.display_name} 이미 연결`); continue; }
    todo.push({ className: c.className, boardId: b[0].id, teacher: h.display_name, tid });
  }
  let run = todo;
  if (ONLY) run = run.filter((t) => t.className === ONLY);
  run = run.slice(0, LIMIT);
  console.log(`연결 예정 ${todo.length}건 · 이번 실행 ${run.length}건 · 모드=${APPLY ? "🔴 실행" : "드라이런"}`);
  for (const t of run) console.log(`  ${JSON.stringify(t.className)} ← ${t.teacher}(#${t.tid})`);
  console.log(`건너뜀 ${skipped.length}건:`);
  for (const s of skipped) console.log(`  · ${s}`);
  if (!APPLY) console.log("\n드라이런 — ClassNote 변경 없음. 실행하려면 --apply");
  else {
    const before = countBy(emps);
    const added = new Map();
    for (const t of run) {
      const res = await page.evaluate(async ([teacher, cls]) => {
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
        const r = await fetch("/api/v1/employments/", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
          body: JSON.stringify({ teacher, class_in_charge: cls }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 200) };
      }, [t.tid, t.boardId]);
      if (res.status !== 201) throw new Error(`${t.className} ← ${t.teacher}: HTTP ${res.status} ${res.body}`);
      added.set(t.tid, (added.get(t.tid) ?? 0) + 1);
      console.log(`  ✓ ${t.className} ← ${t.teacher}`);
      await page.waitForTimeout(300);
    }
    // 검증: 선생님별 연결 수 = 이전 + 이번 추가(줄었으면 배열 교체 — 중단 신호) · 이번 연결이 실제로 있는지
    const after = await getEmps(page, centerId);
    const now = countBy(after);
    const got = new Set(after.map((e) => `${e.teacher_id}|${e.class_in_charge}`));
    const bad = [];
    for (const [tid, n] of before) if ((now.get(tid) ?? 0) !== n + (added.get(tid) ?? 0)) bad.push(`선생님 #${tid}: ${n} → ${now.get(tid) ?? 0}(기대 ${n + (added.get(tid) ?? 0)})`);
    for (const t of run) if (!got.has(`${t.tid}|${t.boardId}`)) bad.push(`${t.className} ← ${t.teacher} 연결 확인 안 됨`);
    if (bad.length) throw new Error(`검증 실패:\n  ${bad.join("\n  ")}`);
    console.log(`\n✅ 완료 — 연결 ${run.length}건 · 선생님별 연결 수 전원 정확히 증가(다른 반 연결 변화 없음)`);
  }
} catch (e) {
  exitCode = 1;
  console.error(`\n⛔ 중단: ${e?.message ?? e}`);
} finally {
  await browser.close();
}
process.exit(exitCode);
