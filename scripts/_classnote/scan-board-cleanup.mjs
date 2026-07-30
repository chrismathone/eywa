/**
 * scripts/_classnote/scan-board-cleanup.mjs — eywa 기준 **ClassNote 반(보드) 정리 후보** 스캔. **READ-ONLY**.
 *
 * 아무것도 변경하지 않는다(ClassNote GET · DB select 전용). 목적은 "어떤 보드를 손봐야 하고, 각각 무엇을
 * 먼저 해야 하는가"를 원장이 한눈에 보게 하는 것 — 삭제·해제는 ClassNote UI에서 사람이 한다
 * (원아 배정 해제·교사 해제·반 삭제는 REST가 전부 405/부재 = UI 전용).
 *
 * 🔴 **삭제 판정의 핵심 = 게시물 수.** 학부모는 퇴원 후에도 `추억보기`로 과거 알림장을 보는데(§11) 그건
 * **게시물 원본을 읽는다.** 그래서 게시물이 있는 보드를 지우면 그 추억이 사라진다 →
 * "가족 0명이니 빈 보드"라고 지우면 안 된다. 게시물 수를 반드시 함께 본다.
 * 판정 순서: ① 게시물 0 + 가족 0 + 교사 0 = 잃을 게 없음(삭제 안전) ② 게시물 1+ = 보존 권고
 * ③ 가족 1+ = 원아를 먼저 내려야(퇴원처리) 삭제 자체가 불가(ClassNote: 학생·교사 있으면 삭제 불가).
 *
 * 실행: node --env-file=.env.local scripts/_classnote/scan-board-cleanup.mjs [--json] [--limit=N]
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  launchAdminBrowser,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";
import { normBoard } from "./board-safety.mjs";
import { studentIdentityKeys } from "./identity-keys.mjs";

const JSON_OUT = process.argv.includes("--json");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
const STUDENT_BOARD = /^\((수학|영어)\)(.+)$/;

const POST_PAGE = 100; // 한 번에 받는 최대 건수. 초과분은 ">=100"으로 보고(삭제 판정엔 0인지 아닌지가 핵심)

/**
 * 보드의 게시물 수 — 반환 `{n, atLeast}`(atLeast=true면 "n건 이상"). 실패 시 null.
 *
 * ⚠️⚠️ **응답의 `count`를 쓰면 안 된다.** 이 엔드포인트의 `count`는 **항상 1인 상수**다(2026-07-30 실측:
 * `page_size=1`·`100`·무지정 전부 `count:1`, **존재하지 않는 `cls`에도 `count:1`**). 그걸 믿고 세면
 * **모든 보드가 "게시물 1건"** 으로 보여 삭제 판정이 통째로 거짓이 된다(실제로 69개 보드가 전부 1건으로 나왔다).
 * 진짜 수는 `results.length`다.
 *
 * ⚠️ **커서(`next`)로 페이지를 이어받지 말 것 — `cls` 필터가 풀린다.** 실측: `page_size=2`로 `next`를 따라가면
 * 6건인 보드에서 11페이지·20건이 나오고 id 집합이 `page_size=100` 결과와 **불일치**했다(다른 보드 글이 섞임).
 * 그래서 **단일 요청**만 하고, `next`가 있으면 "100건 이상"으로만 보고한다(0인지 아닌지가 판정의 핵심이므로 충분).
 * `?cls=` 필터 자체는 정상이다(반환 행의 cls가 전부 해당 보드, 없는 보드는 0행).
 */
async function countBoardPosts(page, centerId, boardId) {
  const r = await page.evaluate(
    async ([cid, bid, size]) => {
      const res = await fetch(`/api/v1_2/centers/${cid}/reports/?cls=${bid}&page_size=${size}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return null;
      const j = await res.json();
      return { n: (j?.results ?? []).length, more: !!j?.next };
    },
    [centerId, boardId, POST_PAGE],
  );
  return r ? { n: r.n, atLeast: r.more } : null;
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchAdminBrowser();
const page = await browser.newPage();
try {
  const tenant = await resolveTenant(sql);
  const students = await sql`
    select s.id, s.name, s.classnote_name, s.status, to_char(s.withdrawn_at,'YYYY-MM-DD') as withdrawn_at
    from students s where s.tenant_id = ${tenant}`;
  const activeRows = await sql`
    select distinct e.student_id, c.subject
    from enrollments e join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where e.tenant_id = ${tenant} and e.end_date is null`;
  const activeBySid = new Map();
  for (const r of activeRows) activeBySid.set(r.student_id, [...(activeBySid.get(r.student_id) ?? []), r.subject ?? "?"]);

  await loginClassnote(page);
  await page.goto(`${CLASSNOTE_BASE}/service/report`, { waitUntil: "domcontentloaded" });
  await dismissHonorificDialog(page);
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);

  // 교사 연결 전건(1요청) — 반 삭제 가능 조건(학생·교사 없음)의 '교사' 쪽.
  const empRaw = await page.evaluate(async (cid) => {
    const r = await fetch(`/api/v1_2/centers/${cid}/employments`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : (j.results ?? null);
  }, centerId);
  if (!empRaw) {
    console.error("🔴 교사 연결(employments) 조회 실패 — 삭제 가능 판정을 할 수 없어 중단합니다");
    process.exitCode = 1;
    throw new Error("employments 조회 실패");
  }
  const teachersByBoard = new Map();
  for (const e of empRaw) {
    const bid = e?.belong_to_class ?? e?.class_id ?? e?.cls;
    if (bid == null) continue;
    teachersByBoard.set(bid, (teachersByBoard.get(bid) ?? 0) + 1);
  }

  // eywa 학생 이름 키 색인 — ⚠️ 카디널리티(같은 보드명에 학생 2명+)면 손대지 말 것
  const studentKeys = students.map((s) => ({ s, keys: studentIdentityKeys(s.name, s.classnote_name) }));

  const studentBoards = boards.filter((b) => STUDENT_BOARD.test(b.name));
  const rows = [];
  for (const b of studentBoards) {
    const m = STUDENT_BOARD.exec(b.name);
    const subjectLabel = m[1];
    // ⚠️ 보드명은 **우리가 만든 이름**이라 `childIdentityKeys`(학부모가 지은 원아 표시명용 — 라틴/괄호를
    // 벗겨낸다)를 적용하면 안 된다. 그걸 쓰면 `(수학)박서준C`가 접미사를 벗겨 박서준·박서준C 둘 다에 걸려
    // 정상 보드가 통째로 '동명이인'이 된다(실측: 정상 380 → 329로 과소). 보드 base 이름은 **정확 일치**로
    // 학생 키에 조회한다(scan-offboard-candidates 블록 2와 같은 기준 — 두 스캔이 다른 숫자를 말하면 안 된다).
    const base = normBoard(m[2]);
    const hits = studentKeys.filter((x) => x.keys.has(base)).map((x) => x.s);
    const wanted = subjectLabel === "수학" ? ["math", "subject_1"] : ["english"];
    const stillTaking = hits.some((s) => (activeBySid.get(s.id) ?? []).some((x) => wanted.includes(x)));
    const anyAlive = hits.some((s) => s.status !== "withdrawn");
    let state;
    if (!hits.length) state = "미매칭";
    else if (hits.length > 1) state = "동명이인";
    else if (stillTaking) state = "정상(수강중)";
    else if (anyAlive) state = "과목이탈(재원)";
    else state = "퇴원";
    rows.push({ board: b, state, students: hits, teachers: teachersByBoard.get(b.id) ?? 0 });
  }

  // 정리 검토 대상만 게시물 수를 조회한다(정상 보드는 건드릴 일이 없어 요청도 안 한다).
  let targets = rows.filter((r) => r.state === "퇴원" || r.state === "과목이탈(재원)" || r.state === "미매칭");
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  let postFail = 0;
  for (const t of targets) {
    try {
      const pc = await countBoardPosts(page, centerId, t.board.id);
      t.posts = pc ? pc.n : null;
      t.postsAtLeast = pc?.atLeast ?? false;
      if (t.posts == null) postFail++;
    } catch {
      t.posts = null;
      postFail++;
    }
  }

  // ── 분류 ───────────────────────────────────────────────────────────────────
  const fam = (t) => t.board.children;
  const cat = { A: [], B: [], C: [], D: [], E: [] };
  for (const t of targets) {
    if (t.state === "미매칭") cat.E.push(t);
    else if (fam(t) == null || t.posts == null) cat.E.push(t); // 인원·게시물 미확인 = 판정 불가
    else if (fam(t) >= 1) cat.C.push(t);
    else if (t.teachers >= 1) cat.D.push(t);
    else if (t.posts === 0) cat.A.push(t);
    else cat.B.push(t);
  }
  const line = (t) =>
    `   · ${t.board.name} (id ${t.board.id}) — ${t.state}` +
    (t.students[0]?.withdrawn_at ? ` 퇴원 ${t.students[0].withdrawn_at}` : "") +
    ` · 가족 ${fam(t) ?? "?"} · 교사 ${t.teachers} · 게시물 ${t.posts == null ? "?" : t.posts + (t.postsAtLeast ? "+" : "")}`;

  if (!JSON_OUT) {
    console.log(`\n════ ClassNote 반 정리 후보 (READ-ONLY · eywa 기준) ════`);
    console.log(`전체 보드 ${boards.length} · 학생모드 ${studentBoards.length} · 정상(수강중) ${rows.filter((r) => r.state === "정상(수강중)").length}`);
    console.log(`정리 검토 대상 ${targets.length} = 퇴원 ${targets.filter((t) => t.state === "퇴원").length} · 과목이탈 ${targets.filter((t) => t.state === "과목이탈(재원)").length} · 미매칭 ${targets.filter((t) => t.state === "미매칭").length}`);
    if (postFail) console.log(`⚠️ 게시물 수 조회 실패 ${postFail}건 — 그 보드는 판정 보류(E)로 뺐습니다`);

    console.log(`\n[A] 지금 삭제해도 잃는 게 없음 — 가족 0 · 교사 0 · **게시물 0** : ${cat.A.length}개`);
    cat.A.forEach((t) => console.log(line(t)));

    console.log(`\n[B] 🔴 삭제하면 게시물이 사라짐(추억보기 원본) — 가족 0 · 교사 0 · 게시물 1+ : ${cat.B.length}개`);
    console.log(`    → 보존 권고. 보드가 남아도 원아가 없으면 오발송 위험은 0이다(발송 게이트가 빈 보드를 차단).`);
    console.log(`    → 게시물 합계 ${cat.B.reduce((a, t) => a + (t.posts ?? 0), 0)}건`);
    cat.B.slice(0, 20).forEach((t) => console.log(line(t)));
    if (cat.B.length > 20) console.log(`   … 외 ${cat.B.length - 20}개`);

    console.log(`\n[C] 원아를 먼저 내려야 함(가족 1+ → ClassNote는 학생 있으면 반 삭제 불가) : ${cat.C.length}개`);
    console.log(`    → 이게 퇴원처리(Phase 1/2) 대상이다. 원아를 내리면 [A]/[B]로 내려온다.`);
    cat.C.forEach((t) => console.log(line(t)));

    console.log(`\n[D] 교사 연결만 남음(가족 0 · 교사 1+) — UI에서 교사 해제 후 삭제 : ${cat.D.length}개`);
    console.log(`    ⚠️ 교사 해제는 REST 405 = ClassNote UI 전용. 퇴직 강사 연결 정리(§3 위생)와 함께 하면 효율적.`);
    cat.D.slice(0, 20).forEach((t) => console.log(line(t)));
    if (cat.D.length > 20) console.log(`   … 외 ${cat.D.length - 20}개`);

    console.log(`\n[E] 손대지 말 것(eywa 미매칭 = 테스트·퇴사강사 보드 / 인원·게시물 미확인) : ${cat.E.length}개`);
    cat.E.forEach((t) => console.log(line(t)));

    console.log(`\n⚠️ 동명이인 보드 ${rows.filter((r) => r.state === "동명이인").length}개는 대상에서 제외했다(어느 학생인지 확정 불가).`);
    console.log("이 스캔은 아무것도 변경하지 않았습니다(ClassNote GET · DB select 전용).");
  } else {
    console.log(
      JSON.stringify(
        {
          totals: { boards: boards.length, studentBoards: studentBoards.length, targets: targets.length },
          categories: Object.fromEntries(
            Object.entries(cat).map(([k, v]) => [
              k,
              v.map((t) => ({ id: t.board.id, name: t.board.name, state: t.state, families: fam(t), teachers: t.teachers, posts: t.posts })),
            ]),
          ),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
