/**
 * READ-ONLY: 26.06 결석 목록 + 그 (학생·반)의 26.07 상황 — **회차 이월(0134a) 판단용**.
 *
 * 왜 스크립트인가: 목록 파일만 남기면 그 시점 스냅샷으로 굳는다. 7월이 진행 중이라
 * "6월 결석이 7월에 보강됐는지"는 **월말에 다시 돌려야** 보인다. 그래서 재실행 가능하게 둔다.
 *
 * 읽는 법:
 *   · 7월 실측 > 7월 계획  → 보강이 들어왔을 가능성(이월 후보)
 *   · 7월 term id          → carryover_in 주입 대상 행
 *   ⚠️ 컷오버라 6월엔 term 행이 없다(0건) → 7월 행에 직접 주입 + 사유 필수(0134a).
 *
 * 사용: node scripts/_oneoff/list-june-absences.cjs
 * 출력: out/june-absences.txt  (out/ 은 gitignore — 학생 이름이 들어가 커밋하지 않는다)
 */
const fs = require("node:fs");
const path = require("node:path");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // 인재원
const JUN = "2026-06";
const JUL = "2026-07";

function loadDatabaseUrl() {
  const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(".env.local에 DATABASE_URL 없음");
  return m[1].trim().replace(/^"|"$/g, "");
}
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (d) => DOW[new Date(Date.parse(`${iso(d)}T00:00:00Z`)).getUTCDay()];

async function main() {
  const sql = require("postgres")(loadDatabaseUrl(), { ssl: "require", max: 1 });
  const out = [];
  try {
    // ── 6월 결석
    const abs = await sql`
      SELECT ar.session_date, ar.student_id, ar.class_id,
             s.name AS student, c.class_name, c.subject, u.display_name AS teacher
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id
      LEFT JOIN classes c ON c.id = ar.class_id
      LEFT JOIN users u ON u.id = c.teacher_id
      WHERE ar.tenant_id = ${TENANT}
        AND ar.status = 'absent'
        AND ar.session_date >= ${JUN + "-01"} AND ar.session_date <= ${JUN + "-30"}
      ORDER BY u.display_name, c.class_name, s.name, ar.session_date`;

    // ── 7월 term(주입 대상) + 7월 실측
    const keys = [...new Set(abs.map((a) => `${a.student_id}|${a.class_id}`))];
    const terms = await sql`
      SELECT t.id, t.class_id, t.planned_sessions, t.confirmed_sessions, t.carryover_in, i.student_id
      FROM invoice_session_terms t
      JOIN invoices i ON i.id = t.invoice_id
      WHERE i.period = ${JUL} AND t.tenant_id = ${TENANT}`;
    const termBy = new Map(terms.map((t) => [`${t.student_id}|${t.class_id}`, t]));
    const julAtt = await sql`
      SELECT ar.student_id, ar.class_id, count(*) FILTER (WHERE ar.status <> 'absent')::int AS done
      FROM attendance_records ar
      WHERE ar.tenant_id = ${TENANT}
        AND ar.session_date >= ${JUL + "-01"} AND ar.session_date <= ${JUL + "-31"}
      GROUP BY 1,2`;
    const julBy = new Map(julAtt.map((r) => [`${r.student_id}|${r.class_id}`, r.done]));

    // ⚠️ 출석 입력 자체가 중간에 끊겼을 수 있다 — 목록을 "6월 전체"로 오해하면 이월을 과소 반영한다.
    const cov = await sql`
      SELECT min(session_date)::text mn, max(session_date)::text mx,
             count(*)::int n, count(DISTINCT session_date)::int days
      FROM attendance_records WHERE tenant_id = ${TENANT}
        AND session_date >= ${JUN + "-01"} AND session_date <= ${JUN + "-30"}`;
    const covJul = await sql`
      SELECT min(session_date)::text mn, max(session_date)::text mx, count(*)::int n
      FROM attendance_records WHERE tenant_id = ${TENANT} AND session_date >= ${JUL + "-01"}`;

    out.push(`# 26.06 결석 목록 — 회차 이월(0134a) 판단용`);
    out.push(`# 생성 시점 기준 스냅샷. 7월이 끝난 뒤 다시 돌리면 '7월 실측'이 채워져 보강 여부가 보인다.`);
    out.push(`# 재실행: node scripts/_oneoff/list-june-absences.cjs`);
    out.push("");
    out.push(`⚠️ 출석 입력 범위(이 목록의 신뢰 구간)`);
    out.push(`   6월: ${cov[0].mn} ~ ${cov[0].mx} · ${cov[0].days}일치 · ${cov[0].n}건`);
    out.push(`   7월: ${covJul[0].mn ?? "-"} ~ ${covJul[0].mx ?? "-"} · ${covJul[0].n}건`);
    out.push(`   → 입력된 날짜의 결석만 잡힌다. 6월 전체가 아니면 **이 목록은 부분집합**이고,`);
    out.push(`     빠진 구간의 결석은 aywa로 복구 불가(구 시트·종이 기록 대조 필요).`);
    out.push("");
    out.push(`총 ${abs.length}건 · 대상 (학생×반) ${keys.length}조합`);
    out.push("");
    let lastT = null;
    for (const a of abs) {
      const k = `${a.student_id}|${a.class_id}`;
      const t = termBy.get(k);
      const done = julBy.get(k) ?? 0;
      const planned = t?.planned_sessions ?? null;
      const hint =
        planned !== null && done > planned ? "  ★보강 가능성(7월 실측>계획)" : planned === null ? "  (7월 term 없음)" : "";
      if (a.teacher !== lastT) {
        out.push(`── 강사: ${a.teacher ?? "(없음)"}`);
        lastT = a.teacher;
      }
      out.push(
        `  ${iso(a.session_date)}(${dow(a.session_date)}) ${a.student} · ${a.class_name ?? "(반없음)"}` +
          `\n      7월: 계획 ${planned ?? "-"} / 실측 ${done} / 이월받음 ${t?.carryover_in ?? "-"}${hint}` +
          `\n      7월 term id: ${t?.id ?? "(없음 — 주입 불가, 계획 갱신 필요)"}`,
      );
    }
    out.push("");
    out.push(`# 주입 방법(결정 후): 해당 term id에 carryover_in = 회차, 사유 필수(컷오버라 6월 원본 행 없음).`);

    const dir = path.join(__dirname, "..", "..", "out");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "june-absences.txt");
    fs.writeFileSync(file, out.join("\n"), "utf8");
    console.log(`WROTE ${file}  (${abs.length}건)`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
