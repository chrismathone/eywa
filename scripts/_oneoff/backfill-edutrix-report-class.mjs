/**
 * scripts/_oneoff/backfill-edutrix-report-class.mjs — **edutrix 이관 수업보고서에 반(class_id)을 되살린다.**
 *
 * 배경(2026-09-07): eywa의 `lesson_reports` 17,806건이 edutrix 이관분인데 **전건 `class_id`가 비어 있다**
 * (이관이 학생·날짜·강사명만 가져왔다). 반이 없으면 그 보고서는 "누가 이 반을 가르쳤나"를 못 말해서
 * ① 월별 출석부 반 머리행의 담당자 라벨이 2026-07 이전엔 통째로 비고 ② `teacher-as-of`의 '그 달 보고서
 * 작성자' 추정 갈래가 근거 0이 되고 ③ MCS 지난 달 진도표가 빈다.
 *
 * 🔴 **원본에서 다시 읽는 길은 없다** — edutrix Supabase 프로젝트는 삭제됐다(2026-09-07 실측:
 *    `xihggqwpyekbszizxyoh.supabase.co`가 공개 DNS 8.8.8.8에서 NXDOMAIN). 원본 `reports.classes(name)`가
 *    있었지만 이제 못 읽는다. 그래서 **eywa 안의 사실(출결)로 역추적**하는 이 방법만 남았다.
 *
 * 규칙(보수적 — 애매하면 안 적는다):
 *   ① (학생, 보고서 날짜)로 그날의 **출결 행**을 찾는다. 출결은 반을 반드시 들고 있다.
 *   ② 후보를 **수학 반으로 좁힌다** — edutrix 보고서는 수학 리포팅이었다(실측: 단일 매칭 6,378건 중
 *      6,371건이 수학 반, 영어 7건은 그날 영어 출결만 있던 잡음이라 붙이면 틀린다).
 *   ③ **후보가 정확히 하나일 때만** 적는다. 둘 이상(같은 날 수학 반 2개)이면 **건너뛴다** — 추측하지 않는다.
 *   ④ **보강 반(`is_makeup_pool`)은 후보에서 뺀다** — 그 반은 시수 귀속용 그릇이지 실제 수업 반이 아니다.
 *   ⑤ `class_id`가 이미 있는 행은 **한 건도 안 건드린다**(사람이 고쳐 둔 값 보호).
 *   ⑥ 🔴 **그 (학생, 날짜, 반)에 이미 보고서가 있으면 건너뛴다** — `unit_key`가 **생성 컬럼**
 *      (`COALESCE(class_id::text, subject)`)이고 `(tenant, student, report_date, unit_key)`가 유니크다.
 *      반이 비어 있는 동안엔 unit_key가 null이라 같은 날 몇 건이든 공존했는데, 반을 채우는 순간
 *      그 값이 반 id가 되어 **같은 칸끼리 부딪힌다**. 2026-09-07 실측: 드라이런은 통과했는데 --apply가
 *      500행 뒤 23505로 멈췄다([[#120]]이 경고한 "제약이 걸린 쓰기는 실제로 실행해 봐야 안다").
 *      부딪히는 짝은 둘 — 우리 후보끼리(같은 날 같은 학생 이관 보고서 2건) / 이미 있는 eywa 보고서.
 *
 * ⚠️ **되살릴 수 없는 구간이 있다** — 출결이 2026-02-02부터라 그 이전(2025-11~2026-01, 4,446건)은 대조할
 *    사실이 아예 없다. 원장 결정(2026-09-07) *"살릴 수 있는 부분부터"* · *"살릴 수 없는 부분은 그냥 'ㅡ'로
 *    전부 미입력 상태로 냅둬"* → 못 채운 행은 **null 그대로** 둔다(지어내지 않는다).
 *
 * ⚠️ 이 백필은 표시만 바꾸는 게 아니다 — 함께 움직이는 소비처:
 *    · 월별 출석부 담당자 라벨(getMonthlyClassWorkers) — **의도한 효과**
 *    · MCS 지난 달 진도표·작성률 — 빈 달이 실제 기록으로 찬다(사실에 가까워지는 방향)
 *    · 수강 삭제 가드(`enrollments/deletable.ts`) — 보고서가 달린 수강은 더 못 지운다(안전 강화)
 *    · 🔴 **시수·급여·청구는 안 닿는다**(그 축은 `attendance_records`가 정한다).
 *
 * 사용:
 *   node --env-file=.env.local scripts/_oneoff/backfill-edutrix-report-class.mjs                    # 드라이런(전체)
 *   node --env-file=.env.local scripts/_oneoff/backfill-edutrix-report-class.mjs --verbose          # + 반별 표
 *   node --env-file=.env.local scripts/_oneoff/backfill-edutrix-report-class.mjs --from=2026-04-01  # 기간 한정
 *   node --env-file=.env.local scripts/_oneoff/backfill-edutrix-report-class.mjs --apply            # 실제 반영
 * env: DATABASE_URL.
 *
 * ⚠️ `--from`은 **드라이런의 모든 표에도 걸린다** — 그래야 드라이런이 곧 반영 예고다(한쪽만 걸면 거짓말).
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
/** 월별 표를 보고 "여기부터만" 정할 수 있게 — 없으면 전체. */
const FROM = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? null;
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // injaewon (프로덕션 실데이터)
const SOURCE = "edutrix_import";
/** edutrix 보고서는 수학 리포팅이었다 — 후보 반을 이 과목으로 좁힌다(위 규칙 ②). */
const REPORT_SUBJECT = "math";

function fail(msg) {
  console.error(msg);
  process.exitCode = 2;
}

async function main() {
  if (!process.env.DATABASE_URL) return fail("DATABASE_URL 없음 — `node --env-file=.env.local …`로 실행할 것.");
  if (FROM && !/^\d{4}-\d{2}-\d{2}$/.test(FROM)) return fail("--from=YYYY-MM-DD 형식이어야 합니다.");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    console.log(APPLY ? "=== 반영(--apply) ===" : "=== 드라이런 — 한 줄도 쓰지 않습니다 ===");
    if (FROM) console.log(`기간: ${FROM} 이후만`);

    // 후보 계산 한 곳(드라이런과 반영이 **같은 식**을 쓴다 — 갈리면 드라이런이 거짓말이 된다).
    const candidates = await sql`
      with target as (
        select id, student_id, report_date, teacher_name
        from lesson_reports
        where tenant_id = ${TENANT} and source = ${SOURCE} and class_id is null
          and (${FROM}::date is null or report_date >= ${FROM}::date)
      ),
      hit as (
        select t.id, t.student_id, t.report_date::text as report_date, t.teacher_name,
               (array_agg(distinct a.class_id))[1] as class_id,
               count(distinct a.class_id)::int as n
        from target t
        join attendance_records a
          on a.tenant_id = ${TENANT} and a.student_id = t.student_id
         and a.session_date = t.report_date and a.class_id is not null
        join classes c
          on c.id = a.class_id and c.subject = ${REPORT_SUBJECT}
         and coalesce(c.is_makeup_pool, false) = false
        group by t.id, t.student_id, t.report_date, t.teacher_name
      )
      select * from hit where n = 1 order by id`;

    /**
     * 규칙 ⑥ — 이미 찬 칸을 비켜 간다. 두 겹:
     *   ① DB에 이미 있는 (학생, 날짜, 반) 보고서 — 이관분이든 eywa 것이든.
     *   ② 후보끼리 같은 칸을 노리는 경우 — 먼저 온 것(id 순)만 남긴다.
     * 🔴 여기서 안 거르면 --apply가 23505로 죽는다(드라이런만 보고 믿으면 안 되는 자리).
     */
    const taken = new Set(
      (
        await sql`select student_id, report_date::text as report_date, class_id
                  from lesson_reports
                  where tenant_id = ${TENANT} and class_id is not null`
      ).map((r) => `${r.student_id}|${r.report_date}|${r.class_id}`),
    );
    const fillable = [];
    const collided = [];
    for (const c of candidates) {
      const key = `${c.student_id}|${c.report_date}|${c.class_id}`;
      if (taken.has(key)) {
        collided.push(c);
        continue;
      }
      taken.add(key);
      fillable.push(c);
    }

    const total = (
      await sql`select count(*)::int as n from lesson_reports
                where tenant_id=${TENANT} and source=${SOURCE} and class_id is null
                  and (${FROM}::date is null or report_date >= ${FROM}::date)`
    )[0].n;
    console.log(`\n대상(반 없는 edutrix 보고서): ${total}건`);
    console.log(`채울 수 있음: ${fillable.length}건 (${((fillable.length / total) * 100).toFixed(1)}%)`);
    console.log(`남는 행: ${total - fillable.length}건 — 원장 결정대로 null 그대로 둔다`);
    console.log(`  (그중 ${collided.length}건 = 그 날 그 반에 보고서가 이미 있음 — 규칙 ⑥)`);

    // 🔴 이 표는 규칙 ①~④만 센다 — 규칙 ⑥(이미 찬 칸)은 SQL 밖에서 갈리므로 (채움) 줄에서 빼 준다.
    //    안 그러면 같은 화면이 서로 다른 수를 말한다(드라이런이 스스로와 어긋나면 안 된다).
    console.log("\n-- 못 채우는 이유 --");
    const reasons = await sql`
      with target as (
        select id, student_id, report_date from lesson_reports
        where tenant_id = ${TENANT} and source = ${SOURCE} and class_id is null
          and (${FROM}::date is null or report_date >= ${FROM}::date)
      ),
      hit as (
        select t.id, count(distinct c.id)::int as n
        from target t
        left join attendance_records a
          on a.tenant_id = ${TENANT} and a.student_id = t.student_id
         and a.session_date = t.report_date and a.class_id is not null
        left join classes c
          on c.id = a.class_id and c.subject = ${REPORT_SUBJECT}
         and coalesce(c.is_makeup_pool, false) = false
        -- 세는 건 필터를 통과한 반이다 - a.class_id를 세면 그날 영어 출결만 있는 날이 '채움'이 된다.
        group by t.id
      )
      select case when n = 0 then '그날 대조할 수학 출결이 없음'
                  when n = 1 then '(채움)'
                  else '같은 날 수학 반이 둘 이상 — 추측 안 함' end as reason,
             count(*)::int as n
      from hit group by 1 order by 2 desc`;
    console.table(
      reasons.map((r) =>
        r.reason === "(채움)"
          ? { reason: "(채움)", n: r.n - collided.length }
          : r,
      ).concat(collided.length ? [{ reason: "그 날 그 반에 보고서가 이미 있음(규칙 ⑥)", n: collided.length }] : []),
    );

    console.log("\n-- 월별 --");
    const byMonth = new Map();
    for (const r of fillable) {
      const ym = String(r.report_date).slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
    }
    const monthRows = await sql`
      select left(report_date::text,7) as ym, count(*)::int as target
      from lesson_reports where tenant_id=${TENANT} and source=${SOURCE} and class_id is null
        and (${FROM}::date is null or report_date >= ${FROM}::date)
      group by 1 order by 1`;
    console.table(
      monthRows.map((r) => ({ 달: r.ym, 대상: r.target, 채움: byMonth.get(r.ym) ?? 0, 남김: r.target - (byMonth.get(r.ym) ?? 0) })),
    );

    // 정합성 — 추론이 옳다면 (반, 달)마다 작성자가 한 명이어야 한다(eywa 자체 보고서에서 확인된 성질).
    const perClassMonth = new Map();
    for (const r of fillable) {
      if (!r.teacher_name) continue;
      const key = `${r.class_id}|${String(r.report_date).slice(0, 7)}`;
      if (!perClassMonth.has(key)) perClassMonth.set(key, new Set());
      perClassMonth.get(key).add(r.teacher_name);
    }
    const spread = new Map();
    for (const s of perClassMonth.values()) spread.set(s.size, (spread.get(s.size) ?? 0) + 1);
    console.log("\n-- 정합성: (반, 달)마다 보고서 작성자 수 --");
    console.log("   (추론이 옳다면 대부분 1명이어야 한다 — eywa 자체 보고서가 그렇다)");
    console.table([...spread].sort((a, b) => a[0] - b[0]).map(([writers, n]) => ({ 작성자수: writers, "반·달": n })));

    if (VERBOSE) {
      console.log("\n-- 되살아나는 담당(현재 담임과 다른 상위 15) --");
      const ids = [...new Set(fillable.map((c) => c.class_id))];
      const clsRows = await sql`select id, class_name, teacher_id from classes where id in ${sql(ids)}`;
      const names = new Map(clsRows.map((c) => [c.id, c]));
      const users = new Map(
        (await sql`select id, display_name from users where tenant_id=${TENANT}`).map((u) => [u.id, u.display_name]),
      );
      const agg = new Map();
      for (const r of fillable) {
        if (!r.teacher_name) continue;
        const cls = names.get(r.class_id);
        const now = cls?.teacher_id ? users.get(cls.teacher_id) : null;
        if (now === r.teacher_name) continue;
        const key = `${cls?.class_name ?? r.class_id}|${now ?? "(없음)"}|${r.teacher_name}`;
        agg.set(key, (agg.get(key) ?? 0) + 1);
      }
      console.table(
        [...agg]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([k, n]) => {
            const parts = k.split("|");
            return { 반: parts[0], 현재담임: parts[1], 그때작성자: parts[2], 건수: n };
          }),
      );
    }

    if (!APPLY) {
      console.log("\n드라이런 끝 — 반영하려면 --apply. (프로덕션 실데이터라 표를 먼저 볼 것)");
      return;
    }

    /**
     * 🔴 **행 단위로 쓴다**(청크 트랜잭션 아님) — 한 건이 제약에 걸려도 나머지 수천 건이 함께 죽지 않게.
     * 문장 하나가 곧 트랜잭션이라 중간에 멈춰도 이미 쓴 행은 정상이고, `class_id is null` 조건 덕에
     * 다시 돌리면 남은 것부터 이어 채운다(멱등).
     */
    let done = 0;
    let failed = 0;
    for (const r of fillable) {
      try {
        // 🔴 `class_id is null` 조건을 **쓰는 순간에도** 건다 — 그 사이 누가 채웠으면 안 덮는다.
        await sql`update lesson_reports set class_id = ${r.class_id}
                  where id = ${r.id} and tenant_id = ${TENANT} and class_id is null`;
        done++;
        if (done % 1000 === 0) console.log(`  ... ${done}/${fillable.length}`);
      } catch (e) {
        failed++;
        if (failed <= 5) console.log(`  건너뜀 ${r.id}: ${e?.code ?? ""} ${e?.detail ?? e?.message ?? ""}`);
      }
    }
    console.log(`\n반영 완료: ${done}건${failed ? ` · 건너뜀 ${failed}건(제약 충돌)` : ""}`);
  } finally {
    await sql.end();
  }
}

await main();
