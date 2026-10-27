/**
 * 수학 '내신'(exam_slot = school) 성적을 2026년 2학기 '중간고사'(midterm)로 옮기고, 수학 내신 저장을 DB가 막는다(0363a).
 * 원장 2026-10-14 *"현재 수학 입력되어있는건 26년도 2학기 중간으로 전체 분류"* — 2026-09-23(0289a)에 중간·기말을 '내신'
 * 한 칸으로 합쳤던 것을 되돌리는 쪽.
 *
 *   node --env-file=.env.local scripts/_oneoff/math-school-to-midterm.mjs [--tenant=cs] [--apply]
 *
 * 🔴 기본은 미리 돌려 보기 — 트랜잭션 안에서 옮기고 되돌린다(제약 추가는 미리 돌려 보기에서 하지 않는다: 운영 DB에서
 *    ALTER를 리허설하지 않는다. 대신 '남은 수학 내신 0건'을 확인한다 = 제약이 통과할 조건).
 * 🔴 순서 = 새 앱 배포 확인 → `--apply`. 배포 전에 옮기면 옛 화면이 내신 행을 다시 만든다.
 * 멈추는 경우(덮어쓰지 않는다): 2026년 2학기가 아닌 수학 내신 행이 있을 때 · 같은 학생에게 2학기 중간고사 행이 이미 있을 때
 *    (그 학생 목록을 보여 준다 — 어느 점수를 남길지는 사람이 정한다).
 * 바꾸는 것은 시험 칸과 시험 이름뿐이다(점수·만점·시험일·시험없음 표식·상담 연결은 그대로).
 */
import postgres from "postgres";
import { readMigration } from "../../src/lib/db/migrations-corpus.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
const APPLY = process.argv.includes("--apply");
const slug = (process.argv.find((a) => a.startsWith("--tenant=")) || "--tenant=cs").slice("--tenant=".length);
// 감사로그의 행위자 = 지시한 원장.
const ACTOR = { id: "94007db7-12d3-4b5d-97f2-39071446536b", name: "원일" };
const GUARD_SQL = readMigration("0363a_student_grades_math_no_school.sql");
const DRY = new Error("DRY_RUN");
const stop = (msg) => { throw new Error(msg); };

try {
  await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5s'`;
    const tenants = await tx`select id from tenants where slug = ${slug}`;
    if (tenants.length !== 1) stop(`지점 '${slug}'을(를) 하나로 찾지 못함`);
    const tenantId = tenants[0].id;
    const rows = await tx`select id, school_year, term, exam_month from student_grades
      where tenant_id = ${tenantId} and subject = 'math' and exam_slot = 'school' for update`;
    console.log(`[${slug}] 수학 내신 행: ${rows.length}건`);
    // 원장 지시가 '2026년 2학기 중간'이다 — 다른 학기 행이 섞여 있으면 멈춘다(그 행은 사람이 정한다).
    const other = rows.filter((r) => r.school_year !== 2026 || r.term !== 2 || r.exam_month !== 0);
    if (other.length) stop(`2026년 2학기가 아닌 행 ${other.length}건 — 멈춤`);
    const clash = await tx`select st.name, s.score as school_score, m.score as midterm_score
      from student_grades s
      join student_grades m on m.tenant_id = s.tenant_id and m.student_id = s.student_id and m.subject = 'math'
        and m.exam_slot = 'midterm' and m.school_year = s.school_year and m.term = s.term and m.exam_month = 0
      join students st on st.id = s.student_id
      where s.tenant_id = ${tenantId} and s.subject = 'math' and s.exam_slot = 'school'`;
    if (clash.length) {
      console.table(clash.map((c) => ({ 학생: c.name, 내신: c.school_score, 중간고사: c.midterm_score })));
      stop(`이미 2학기 중간고사 행이 있는 학생 ${clash.length}명 — 멈춤(위 목록)`);
    }
    const done = await tx`update student_grades set exam_slot = 'midterm', exam_name = '중간고사'
      where tenant_id = ${tenantId} and subject = 'math' and exam_slot = 'school' returning id`;
    if (done.length !== rows.length) stop(`옮긴 행 ${done.length}건 ≠ 잠근 행 ${rows.length}건 — 멈춤`);
    if (done.length) {
      await tx`insert into audit_logs(tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenantId}, ${ACTOR.id}, ${ACTOR.name}, 'exam_scores', 'grades', ${`수학 내신 → 2026년 2학기 중간고사 ${done.length}건`},
          ${tx.json({ reclassified: { from: "school", to: "midterm" }, subject: "math", schoolYear: 2026, term: 2, count: done.length,
            reason: "원장 2026-10-14 — 수학 시험 칸을 중간·기말로 되돌림, 기존 내신은 2학기 중간으로" })})`;
    }
    // 제약(0363a)은 지점을 가리지 않는다 — 어느 지점이든 수학 내신이 남아 있으면 여기서 멈춘다.
    const [left] = await tx`select count(*)::int n from student_grades where subject = 'math' and exam_slot = 'school'`;
    if (left.n) stop(`남은 수학 내신 ${left.n}건(다른 지점 포함) — 제약을 걸 수 없어 멈춤`);
    console.log(`옮김 ${done.length}건 · 남은 수학 내신 0건 · 감사로그 ${done.length ? 1 : 0}건`);
    if (!APPLY) throw DRY;
    await tx.unsafe(GUARD_SQL);
    const [guard] = await tx`select count(*)::int n from pg_constraint where conname = 'student_grades_math_no_school_chk'`;
    if (guard.n !== 1) stop("수학 내신 막기 제약이 걸리지 않음 — 멈춤");
    console.log("수학 내신 막기 제약(0363a) 걸림");
  });
  console.log("적용했습니다.");
} catch (e) {
  if (e === DRY) console.log("미리 돌려 보기 끝 — 전부 되돌렸습니다(적용하려면 --apply).");
  else { console.error("실패:", String(e?.message ?? e).replace(/postgres(?:ql)?:\/\/\S+/gi, "***").slice(0, 500)); process.exitCode = 1; }
} finally { await sql.end({ timeout: 5 }); }
