/**
 * 추천 질문용 추세 신호 — 이 지점 비서 DB(`assistant.*` 보기 · 지점 증표로 묶음)에서 싼 집계 몇 개를 센다. AI는 부르지 않는다.
 * 세는 뜻은 앱·온톨로지와 같다(onto_students.counted · onto_attendance 유효 출결 · 운영 중인 반 · 미수 공식 — catalog 설명).
 * 신호 하나가 실패해도(검사 거절 · 8초 · 비용 상한) 나머지는 낸다. 질문 글 만들기는 `../suggestions.ts`(순수) · DB 열기·캐시는 `suggestions-service.ts`.
 * 이 파일은 `server-only`를 두지 않는다 — 운영 읽기 전용 dry-run(tsx)이 같은 SQL을 그대로 돌려 본다.
 */
import type { SuggestionSignals } from "../suggestions";
import type { AssistantDb, Row } from "./agent";
import { checkAssistantSql } from "./sql-gate";

/** 신호별 SQL — 조회 거래의 시간대가 한국이라 `current_date`가 한국 날짜다(executor inTenant). 재원생 = onto_students.counted and status 'enrolled'. */
export const SIGNAL_SQL = {
  absence: `with a as (
  select distinct a.student_id, a.class_id, a.session_date
    from onto_attendance a
    join onto_students s on s.id = a.student_id and s.counted and s.status = 'enrolled'
   where a.status = 'absent' and a.session_date > current_date - 28 and a.session_date <= current_date
)
select count(*) filter (where session_date > current_date - 14)::int as recent,
       count(*) filter (where session_date <= current_date - 14)::int as before,
       (select count(*)::int from (select student_id from a where session_date > current_date - 14 group by student_id having count(*) >= 3) x) as students
  from a`,
  classDrop: `with a as (
  select a.class_id, a.student_id, a.status, a.session_date > current_date - 28 as recent
    from onto_attendance a
    join onto_students s on s.id = a.student_id and s.counted
   where a.session_date > current_date - 56 and a.session_date <= current_date
), r as (
  select class_id,
         count(*) filter (where recent)::int as n1,
         count(*) filter (where recent and status in ('present', 'late'))::int as p1,
         count(*) filter (where not recent)::int as n0,
         count(*) filter (where not recent and status in ('present', 'late'))::int as p0
    from a
   group by class_id
  having count(distinct student_id) filter (where recent) >= 3 and count(distinct student_id) filter (where not recent) >= 3
)
select c.class_name, r.n0, r.p0, r.n1, r.p1
  from r
  join classes c on c.id = r.class_id
 where c.is_active and not coalesce(c.is_makeup_pool, false) and (c.closed_at is null or c.closed_at >= current_date)
   and r.n0 >= 20 and r.n1 >= 20
 order by r.p1::numeric / r.n1 - r.p0::numeric / r.n0, c.class_name
 limit 1`,
  withdrawals: `select count(*) filter (where exit_kind = 'real' and withdrawn_on >= date_trunc('month', current_date)::date and withdrawn_on <= current_date)::int as this_month,
       count(*) filter (where exit_kind = 'real' and withdrawn_on >= (date_trunc('month', current_date) - interval '6 months')::date and withdrawn_on < date_trunc('month', current_date)::date)::int as prev6,
       count(*) filter (where exit_kind = 'scheduled')::int as scheduled
  from onto_students
 where counted`,
  unpaid: `select count(*)::int as count,
       coalesce(sum(greatest(0, coalesce(i.amount_total, 0) - coalesce(i.amount_discount, 0) - coalesce(i.amount_paid, 0))), 0)::bigint as won,
       count(*) filter (where i.period < to_char(current_date - interval '2 months', 'YYYY-MM'))::int as old
  from invoices i
  join onto_students s on s.id = i.student_id and s.counted
 where i.status in ('unpaid', 'partial')
   and greatest(0, coalesce(i.amount_total, 0) - coalesce(i.amount_discount, 0) - coalesce(i.amount_paid, 0)) > 0
   and i.period <= to_char(current_date, 'YYYY-MM')`,
  consult: `select
  (select count(*)::int
     from onto_students s
    where s.counted and s.status = 'enrolled'
      and exists (select 1 from onto_enrollments e where e.student_id = s.id and e.on_roster_today and not coalesce(e.makeup_pool_class, false))
      and exists (select 1 from students st where st.id = s.id and (st.enrolled_at is null or st.enrolled_at <= current_date - 90))
      and not exists (select 1 from student_consultations c where c.student_id = s.id and c.consulted_at > now() - interval '90 days')) as no_recent,
  (select count(*)::int
     from student_consultations c
     join onto_students s on s.id = c.student_id and s.counted and s.status = 'enrolled'
    where c.follow_up_date < current_date and c.follow_up_date >= current_date - 60 and not coalesce(c.follow_up_done, false)) as overdue`,
  conversion: `select count(*)::int as consulted, count(*) filter (where outcome = 'enrolled')::int as enrolled
  from enrollment_consultations
 where consulted_at > now() - interval '37 days' and consulted_at <= now() - interval '7 days'`,
  exams: `select count(distinct school_key)::int as schools, min(from_date)::text as earliest
  from school_exam_periods
 where from_date >= current_date and from_date <= current_date + 21`,
} as const;

export type SignalName = keyof typeof SIGNAL_SQL;

const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
};

/** 조회 한 줄 → 신호(없으면 undefined). */
export function signalFromRow(name: SignalName, row: Row | undefined): SuggestionSignals[SignalName] | undefined {
  if (!row) return undefined;
  switch (name) {
    case "absence":
      return { recent: num(row.recent), before: num(row.before), students: num(row.students) };
    case "classDrop":
      return typeof row.class_name === "string" && row.class_name.trim()
        ? { className: row.class_name.trim(), n0: num(row.n0), p0: num(row.p0), n1: num(row.n1), p1: num(row.p1) }
        : undefined;
    case "withdrawals":
      return { thisMonth: num(row.this_month), prev6: num(row.prev6), scheduled: num(row.scheduled) };
    case "unpaid":
      return { count: num(row.count), won: num(row.won), old: num(row.old) };
    case "consult":
      return { noRecent: num(row.no_recent), overdue: num(row.overdue) };
    case "conversion":
      return { consulted: num(row.consulted), enrolled: num(row.enrolled) };
    case "exams":
      return { schools: num(row.schools), earliest: typeof row.earliest === "string" ? row.earliest : null };
  }
}

/**
 * 열린 비서 DB로 신호를 모두 센다 — 실패한 신호 이름은 `failed`.
 * 묻는 사람의 권한 범위 밖 보기를 읽는 신호는 세지 않고 건너뛴다(실패가 아니다 — s2_0096 · 범위 밖 숫자가 추천 질문으로 새지 않게).
 */
export async function countSignals(db: Pick<AssistantDb, "views" | "run" | "denied">): Promise<{ signals: SuggestionSignals; failed: SignalName[] }> {
  const views = await db.views();
  const denied = (await db.denied?.()) ?? new Map<string, string>();
  const known = denied.size ? new Set([...views, ...denied.keys()]) : views;
  const signals: SuggestionSignals = {};
  const failed: SignalName[] = [];
  for (const name of Object.keys(SIGNAL_SQL) as SignalName[]) {
    try {
      const gate = await checkAssistantSql(SIGNAL_SQL[name], known);
      if (!gate.ok) throw new Error(gate.reason);
      if (gate.tables.some((t) => !views.has(t))) continue;
      const r = await db.run(gate.sql);
      const value = signalFromRow(name, r.rows[0]);
      if (value) (signals as Record<SignalName, unknown>)[name] = value;
    } catch {
      failed.push(name);
    }
  }
  return { signals, failed };
}
