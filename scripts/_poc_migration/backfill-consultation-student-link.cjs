#!/usr/bin/env node
/**
 * backfill-consultation-student-link.cjs (멱등, dry 기본 / --apply)
 *
 * 등록상담 "배정 완료" 컬럼(수업≥1)이 기존 데이터에서도 뜨게 하는 1회성 백필.
 * 배경: ijw/makeedu 임포트가 상담·학생을 각각 넣어 enrollment_consultations.student_id가 전부 null →
 *   outcome='enrolled'(172건)여도 학생과 링크가 없어 "배정 완료"로 못 올라갔다.
 *
 * 매칭 규칙(안전 최우선 — 동명이인 오링크 방지):
 *   상담(student_id IS NULL, outcome='enrolled') ↔ 활성 학생(status<>'withdrawn')을
 *     ① 이름 정규화(lower+공백제거, students.name_normalized 동일식)
 *     ② 학교 호환(초등학교/중학교/고등학교/초/중/고 접미 제거한 core가 서로 포함)  ← 핵심 판별자
 *     로 매칭하고, **유일 매칭이면서 그 학생이 미종료 수업(end_date null or ≥오늘 KST) ≥1개**일 때만 student_id를 채운다.
 *   학년은 시간이 지나며 바뀌어(초4→초6) 매칭키에서 제외(엄격히 쓰면 대부분 놓침).
 *   모호(2명+)·학교 불일치(동명이인)·학교정보 없음·수업 0개 = 건너뜀(로그로 보고).
 *
 * 되돌리기: student_id가 null이던 것만 채우므로, 이 스크립트가 출력한 id 목록으로
 *   `update enrollment_consultations set student_id=null where id in (...)` 하면 원복.
 */
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");

const CONS_CTE = `cons as (
  select id, tenant_id,
         lower(regexp_replace(prospect_name, '\\s+', '', 'g')) nn,
         regexp_replace(coalesce(prospect_school,''), '(초등학교|중학교|고등학교|초|중|고)$', '') pcore
  from enrollment_consultations
  where student_id is null and outcome = 'enrolled' and prospect_name is not null
)`;

async function main() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD KST
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    // 매칭 결과(유일+학교호환+수업≥1) 계산 — dry/apply 공용.
    const matched = await sql`
      with ${sql.unsafe(CONS_CTE)},
      stu as (
        select s.id, s.tenant_id, s.name_normalized nn,
               regexp_replace(coalesce(s.school,''), '(초등학교|중학교|고등학교|초|중|고)$', '') score,
               (exists (select 1 from enrollments e where e.student_id = s.id
                        and (e.end_date is null or e.end_date >= ${today}::date))) hc
        from students s where s.status <> 'withdrawn'
      ),
      m as (
        select c.id cid,
               count(st.id) cnt,
               count(st.id) filter (where st.hc) hcc,
               (array_agg(st.id order by st.hc desc))[1] sid
        from cons c
        join stu st on st.tenant_id = c.tenant_id and st.nn = c.nn
             and c.pcore <> '' and st.score <> ''
             and (c.pcore like '%' || st.score || '%' or st.score like '%' || c.pcore || '%')
        group by c.id
      )
      select cid, sid from m where cnt = 1 and hcc = 1`;

    console.log(`매칭(유일+학교호환+수업≥1): ${matched.length}건`);
    if (matched.length === 0) {
      console.log("링크할 상담 없음(이미 백필됐거나 매칭 0).");
      return;
    }
    console.log("샘플 id:", matched.slice(0, 5).map((r) => r.cid).join(", "));

    if (!APPLY) {
      console.log("\n[dry-run] --apply 를 붙이면 위 건들의 student_id를 채웁니다.");
      return;
    }

    // 멱등: student_id가 여전히 null인 것만 채운다.
    let n = 0;
    const linkedIds = [];
    for (const { cid, sid } of matched) {
      const res = await sql`
        update enrollment_consultations set student_id = ${sid}
        where id = ${cid} and student_id is null
        returning id`;
      if (res.length) {
        n += 1;
        linkedIds.push(cid);
      }
    }
    console.log(`\n[applied] student_id 채움: ${n}건`);
    console.log("되돌리려면:", `update enrollment_consultations set student_id=null where id in (${linkedIds.map((i) => `'${i}'`).join(",")});`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
