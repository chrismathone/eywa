import postgres from "postgres";
import { flatLessons } from "@/features/onescreen/curriculum";

const FIRST_DEMO_DAY = "2026-04-01";
const GENERATED_MONTHLY_TARGET = "월간 단원 복습 및 유형별 문제 80% 이상 정답";

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Stable progression: rerunning tomorrow never rewrites yesterday to a different unit. */
export function demoMathLesson(grade: string, date: string, offset = 0): string | null {
  const lessons = flatLessons(grade);
  if (!lessons.length) return null;
  const index = Math.max(0, Math.min(lessons.length - 1,
    Math.floor((dayNumber(date) - dayNumber(FIRST_DEMO_DAY)) / 4) + offset));
  return lessons[index] ?? null;
}

function monthBounds(today: string): { start: string; end: string } {
  const [year, month] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 6, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

type Pair = { class_id: string; student_id: string; grade: string; student_code: string };
type Report = { id: string; grade: string; student_code: string; report_day: string };
type MonthlyGoal = { id: string; grade: string; student_code: string; month_start: string; month_end: string };

/** Fill only the demo tenant's math learning rails and synthetic report units. */
export async function refreshDemoMath(asOf = new Date(), apply = false, verifyRollback = false) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(asOf);
  const { start, end } = monthBounds(today);
  try {
    return await db.begin(async (tx) => {
      const [tenant] = await tx`select id from tenants where slug='demo' for update`;
      if (!tenant) throw new Error("demo tenant missing");
      const id = String(tenant.id);
      const [roster] = await tx`
        select
          (select count(*)::int from students where tenant_id=${id}) students,
          (select count(*)::int from students where tenant_id=${id} and student_code like 'DMO-%' and notes like 'demo-roster:%') tagged_students,
          (select count(*)::int from classes where tenant_id=${id}) classes,
          (select count(*)::int from classes where tenant_id=${id} and notes like 'demo-roster:%') tagged_classes
      `;
      if (!roster || roster.students !== roster.tagged_students || roster.classes !== roster.tagged_classes) {
        throw new Error("demo contains untagged roster data; refusing refresh");
      }
      const pairs = await tx<Pair[]>`
        select distinct e.class_id,e.student_id,s.grade,s.student_code
        from enrollments e
        join classes c on c.id=e.class_id and c.tenant_id=e.tenant_id
        join students s on s.id=e.student_id and s.tenant_id=e.tenant_id
        where e.tenant_id=${id} and c.subject='math'
          and c.notes like 'demo-roster:%' and s.notes like 'demo-roster:%'
          and e.start_date<=${today}::date and (e.end_date is null or e.end_date>=${start}::date)
      `;
      const reports = await tx<Report[]>`
        select r.id,s.grade,s.student_code,to_char(r.report_date,'YYYY-MM-DD') report_day
        from lesson_reports r
        join students s on s.id=r.student_id and s.tenant_id=r.tenant_id
        join classes c on c.id=r.class_id and c.tenant_id=r.tenant_id
        where r.tenant_id=${id} and r.source='demo_history' and c.subject='math'
          and s.notes like 'demo-roster:%' and c.notes like 'demo-roster:%'
      `;
      const monthly = await tx<MonthlyGoal[]>`
        select g.id,s.grade,s.student_code,
          to_char(g.period_start,'YYYY-MM-DD') month_start,
          to_char((g.period_start + interval '1 month - 1 day')::date,'YYYY-MM-DD') month_end
        from math_month_goals g
        join students s on s.id=g.student_id and s.tenant_id=g.tenant_id
        join classes c on c.id=g.class_id and c.tenant_id=g.tenant_id
        where g.tenant_id=${id} and c.subject='math'
          and g.target_progress=${GENERATED_MONTHLY_TARGET}
          and s.notes like 'demo-roster:%' and c.notes like 'demo-roster:%'
      `;
      const offset = (code: string) => [...code].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
      const progress = reports.flatMap((r) => {
        const lesson = demoMathLesson(r.grade, r.report_day, offset(r.student_code));
        return lesson ? [{ id: r.id, progress: lesson }] : [];
      });
      const targets = monthly.flatMap((g) => {
        const lesson = demoMathLesson(g.grade, g.month_end, offset(g.student_code));
        return lesson ? [{ id: g.id, target: lesson }] : [];
      });
      const goals = pairs.flatMap((p) => {
        const startBlock = demoMathLesson(p.grade, start, offset(p.student_code));
        const endBlock = demoMathLesson(p.grade, end, offset(p.student_code));
        return startBlock && endBlock ? [{ class_id: p.class_id, student_id: p.student_id,
          grade: p.grade, start_block: startBlock, end_block: endBlock }] : [];
      });
      if (apply) {
        if (progress.length) await tx`
          update lesson_reports r set progress=v.progress
          from jsonb_to_recordset(${tx.json(progress)}::jsonb) as v(id uuid,progress text)
          where r.id=v.id and r.tenant_id=${id} and r.source='demo_history'
            and r.progress like '개념 정리와 유형별 문제 풀이 · %'
            and r.progress is distinct from v.progress
        `;
        if (targets.length) await tx`
          update math_month_goals g set target_progress=v.target
          from jsonb_to_recordset(${tx.json(targets)}::jsonb) as v(id uuid,target text)
          where g.id=v.id and g.tenant_id=${id} and g.target_progress=${GENERATED_MONTHLY_TARGET}
        `;
        if (goals.length) await tx`
          insert into math_learning_track_goals
            (tenant_id,class_id,student_id,track,block_count,study_grade,end_study_grade,
             start_block,end_block,start_date,end_date,textbook,milestones)
          select ${id},v.class_id,v.student_id,'regular',24,v.grade,v.grade,
            v.start_block,v.end_block,${start}::date,${end}::date,'개념원리',
            jsonb_build_array(jsonb_build_object('studyGrade',v.grade,'endBlock',v.end_block,
              'endDate',${end}::text,'blockCount',24))
          from jsonb_to_recordset(${tx.json(goals)}::jsonb)
            as v(class_id uuid,student_id uuid,grade text,start_block text,end_block text)
          where not exists (
            select 1 from math_learning_track_goals old where old.tenant_id=${id}
              and old.class_id=v.class_id and old.student_id=v.student_id
              and old.track='regular' and old.start_date=${start}::date
          )
          on conflict do nothing
        `;
      }
      const result = { mode: apply ? "applied" : "dry-run", today, start, end,
        students: new Set(pairs.map((p) => p.student_id)).size,
        classStudents: goals.length, reports: progress.length, monthlyTargets: targets.length };
      if (verifyRollback) throw Object.assign(new Error("VERIFIED_ROLLBACK"), { result });
      return result;
    });
  } catch (error) {
    if (error instanceof Error && "result" in error && error.message === "VERIFIED_ROLLBACK") {
      return { ...(error.result as { today: string; start: string; end: string; students: number; classStudents: number; reports: number; monthlyTargets: number }), mode: "verified-and-rolled-back" };
    }
    throw error;
  } finally {
    await db.end();
  }
}
