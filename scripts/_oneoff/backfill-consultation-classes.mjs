/**
 * 원생상담 '반' 채우기 — 동기화·앱과 **같은 판정 함수**(scripts/_makeedu/consultation-class.cjs).
 *
 * 기본 = 드라이런(읽기 전용 트랜잭션, DB 쓰기 0). `--apply`일 때만 **아직 판정 안 한 행(class_source 비어 있음)**만 채우고
 * 감사로그 1행을 남긴다. 사람이 고른 행(manual)과 이미 판정된 행(auto)은 건드리지 않는다.
 *   node --env-file=.env.local scripts/_oneoff/backfill-consultation-classes.mjs [--tenant=cs] [--apply]
 *
 * 판정 = 상담일(KST)에 학생이 수강 중인 반 중 상담사가 가르치는 반(담임 ∪ 그날 교시 담당)이 정확히 하나(상담 과목이 설정
 * 과목이면 그 과목 반만). 그 밖(상담사 없음·수강 반 없음·가르치는 반 없음·과목 불일치·둘 이상)은 미매핑으로 남긴다(추측 금지).
 * 미매핑으로 판정된 행도 `class_source='auto'`로 표시한다 — 목록이 다시 판정하지 않게(결과는 같다).
 * 🔴 0318a(칸)가 적용되기 전에는 `--apply`를 거절한다(드라이런은 돈다 — 칸이 없어도 판정은 할 수 있다).
 */
import postgres from "postgres";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadSubjectLabels } = require("../_makeedu/consultation-counselor.cjs");
const { resolveConsultationClass, loadClassCandidates, hasClassColumns, tallyClassReasons } = require("../_makeedu/consultation-class.cjs");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const apply = process.argv.includes("--apply");
const slug = (process.argv.find((a) => a.startsWith("--tenant=")) || "--tenant=cs").slice("--tenant=".length);

/** 판정만(쓰기 없음) — 드라이런은 읽기 전용 트랜잭션 안에서, apply는 쓰기 트랜잭션 안에서 같은 함수를 부른다. */
async function plan(tx) {
  const tenants = await tx`select id from tenants where slug = ${slug}`;
  if (tenants.length !== 1) throw new Error(`지점 '${slug}'을(를) 하나로 찾지 못함`);
  const tenantId = tenants[0].id;
  const columns = await hasClassColumns(tx);
  const labels = await loadSubjectLabels(tx, tenantId);
  const rows = columns
    ? await tx`
        select id, student_id::text, counselor_id::text, subject, class_source,
          to_char(consulted_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as d
        from student_consultations where tenant_id = ${tenantId}`
    : await tx`
        select id, student_id::text, counselor_id::text, subject, null::text as class_source,
          to_char(consulted_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as d
        from student_consultations where tenant_id = ${tenantId}`;
  const roles = new Map((await tx`select id::text, system_role::text as role from users where tenant_id = ${tenantId}`).map((u) => [u.id, u.role]));
  const candidates = await loadClassCandidates(tx, tenantId, rows.map((r) => ({ studentId: r.student_id, date: r.d })));
  // 후보 조회가 실패하면 로더는 null을 준다 — 백필은 멈춘다(그대로 가면 "전부 미매핑"이라는 거짓 판정이 굳는다).
  if (!candidates) throw new Error("반 후보를 읽지 못했습니다 — 조회 실패로 멈춥니다");

  const todo = rows.filter((r) => !r.class_source);
  const judged = todo.map((r) => ({
    id: r.id,
    role: roles.get(r.counselor_id) || "(상담사 없음)",
    ...resolveConsultationClass({
      counselorId: r.counselor_id,
      subject: r.subject,
      labels,
      candidates: candidates.get(`${r.student_id}|${r.d}`) || [],
    }),
  }));
  const byRole = {};
  for (const j of judged) {
    const slot = (byRole[j.role] ??= { 매핑: 0, 미매핑: 0 });
    slot[j.classId ? "매핑" : "미매핑"] += 1;
  }
  return {
    tenantId,
    columns,
    report: {
      tenant: slug,
      mode: apply ? "apply" : "dry-run",
      "0318a 칸": columns ? "있음" : "없음(드라이런만 가능)",
      전체: rows.length,
      "이미 판정됨(건너뜀)": rows.length - todo.length,
      대상: todo.length,
      매핑: judged.filter((j) => j.classId).length,
      미매핑: judged.filter((j) => !j.classId).length,
      이유별: tallyClassReasons(judged),
      상담사역할별: byRole,
    },
    judged,
  };
}

try {
  if (!apply) {
    const { report } = await sql.begin("read only", (tx) => plan(tx));
    console.log(JSON.stringify(report, null, 2));
  } else {
    await sql.begin(async (tx) => {
      const { tenantId, columns, report, judged } = await plan(tx);
      console.log(JSON.stringify(report, null, 2));
      if (!columns) throw new Error("0318a가 아직 적용되지 않았습니다 — 칸이 없어 채울 수 없습니다(드라이런만 가능)");
      let applied = 0;
      for (const j of judged) {
        // 아직 판정 안 한 행만 — 그사이 사람이 고른 값(manual)이나 다른 판정은 보존한다.
        const res = await tx`
          update student_consultations set class_id = ${j.classId}, class_source = 'auto', updated_at = now()
          where id = ${j.id} and tenant_id = ${tenantId} and class_source is null`;
        applied += res.count;
      }
      const metadata = { count: applied, mapped: judged.filter((j) => j.classId).length, reasons: report.이유별 };
      await tx`
        insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenantId}, null, ${"운영 스크립트"}, ${"student_consultation_class_backfill"}, ${"student_consultation"},
                ${`상담 ${applied}건`}, ${tx.json(metadata)})`;
      console.log(JSON.stringify({ applied }));
    });
  }
} finally {
  await sql.end();
}
