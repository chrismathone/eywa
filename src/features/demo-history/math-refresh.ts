import postgres from "postgres";
import { flatLessons } from "@/features/onescreen/curriculum";
import { learningGoalError, planLearningGoal, type LearningGoal } from "@/features/math-sheets/lib/learning-plan";
import { learningCoursePath, learningTopics, topicSegments } from "@/features/math-sheets/lib/learning-path";

const FIRST_DEMO_DAY = "2026-04-01";
const FIRST_GOAL_END = "2026-09-30";
const DEMO_TEXTBOOK = "개념원리";
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
type StoredGoal = { id: string; class_id: string; student_id: string; study_grade: string; end_study_grade: string;
  start_block: string; end_block: string; start_date: string; end_date: string; block_count: number;
  milestones: LearningGoal["milestones"]; textbook: string | null; updated_by: string | null; updated_at: string };

/** Keep the original six-month stop and extend the synthetic plan to September 2028. */
export function demoMathLongGoal(first: LearningGoal): LearningGoal | null {
  if (first.track !== "regular" || first.startDate !== FIRST_DEMO_DAY || first.endDate !== FIRST_GOAL_END
    || first.blockCount !== 24 || first.milestones?.length !== 1 || learningGoalError(first)) return null;
  const endGrade = "미적분Ⅱ";
  const lastLesson = flatLessons(endGrade).at(-1);
  if (!lastLesson || !learningCoursePath(first.endStudyGrade ?? first.studyGrade, endGrade).length) return null;
  const remaining = learningTopics({ studyGrade: first.endStudyGrade ?? first.studyGrade,
    startBlock: first.endBlock, endStudyGrade: endGrade, endBlock: lastLesson }).slice(1);
  const semesters = topicSegments(remaining);
  if (semesters.length < 8 && first.studyGrade !== "중3") return null;
  let goal = first;
  for (const semesterCount of first.studyGrade === "중3" ? [2, 5] : [2, 5, 8]) {
    const endpoint = semesters[semesterCount - 1].at(-1)!;
    goal = planLearningGoal({ ...goal, endStudyGrade: endpoint.grade, endBlock: endpoint.lesson }, goal);
    if (learningGoalError(goal)) return null;
  }
  if (first.studyGrade === "중3") {
    const elective = "확률과 통계";
    goal = planLearningGoal({ ...goal, endStudyGrade: elective, endBlock: flatLessons(elective).at(-1)! }, goal);
    if (learningGoalError(goal)) return null;
  }
  return goal;
}

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
      const storedGoals = await tx<StoredGoal[]>`
        select g.id,g.class_id,g.student_id,g.study_grade,g.end_study_grade,g.start_block,g.end_block,
          to_char(g.start_date,'YYYY-MM-DD') start_date,to_char(g.end_date,'YYYY-MM-DD') end_date,
          g.block_count,g.milestones,g.textbook,g.updated_by,g.updated_at::text updated_at
        from math_learning_track_goals g
        join students s on s.id=g.student_id and s.tenant_id=g.tenant_id
        join classes c on c.id=g.class_id and c.tenant_id=g.tenant_id
        where g.tenant_id=${id} and g.track='regular' and c.subject='math'
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
      const byPair = new Map<string, StoredGoal[]>();
      for (const row of storedGoals) {
        const key = `${row.class_id}:${row.student_id}`;
        byPair.set(key, [...(byPair.get(key) ?? []), row]);
      }
      const goals = pairs.flatMap((p) => {
        const existing = byPair.get(`${p.class_id}:${p.student_id}`) ?? [];
        // User-owned goals always win; never replace a newer or unrelated plan.
        if (existing.some(row => row.updated_by !== null) || existing.length > 1) return [];
        const startBlock = demoMathLesson(p.grade, FIRST_DEMO_DAY, offset(p.student_code));
        const endBlock = demoMathLesson(p.grade, FIRST_GOAL_END, offset(p.student_code));
        if (!startBlock || !endBlock) return [];
        const first: LearningGoal = existing.length ? {
          studentId: p.student_id, studyGrade: existing[0].study_grade,
          endStudyGrade: existing[0].milestones?.[0]?.studyGrade ?? existing[0].study_grade,
          startBlock: existing[0].start_block, endBlock: existing[0].milestones?.[0]?.endBlock ?? existing[0].end_block,
          startDate: existing[0].start_date, endDate: existing[0].milestones?.[0]?.endDate ?? existing[0].end_date,
          textbook: existing[0].textbook, track: "regular", blockCount: existing[0].milestones?.[0]?.blockCount,
          milestones: existing[0].milestones?.slice(0, 1),
        } : {
          studentId: p.student_id, studyGrade: p.grade, endStudyGrade: p.grade,
          startBlock, endBlock, startDate: FIRST_DEMO_DAY, endDate: FIRST_GOAL_END,
          textbook: DEMO_TEXTBOOK, track: "regular", blockCount: 24,
          milestones: [{ studyGrade: p.grade, endBlock, endDate: FIRST_GOAL_END, blockCount: 24 }],
        };
        if (existing.length && (existing[0].start_date !== FIRST_DEMO_DAY || existing[0].textbook !== DEMO_TEXTBOOK
          || existing[0].milestones?.[0]?.blockCount !== 24)) return [];
        const goal = demoMathLongGoal(first);
        if (!goal) return [];
        return [{ id: existing[0]?.id ?? null, updated_at: existing[0]?.updated_at ?? null,
          class_id: p.class_id, student_id: p.student_id, study_grade: goal.studyGrade,
          end_study_grade: goal.endStudyGrade ?? goal.studyGrade, start_block: goal.startBlock,
          end_block: goal.endBlock, end_date: goal.endDate, block_count: goal.blockCount,
          milestones: goal.milestones }];
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
        const updates = goals.filter(goal => goal.id);
        if (updates.length) await tx`
          update math_learning_track_goals g set end_study_grade=v.end_study_grade,
            end_block=v.end_block,end_date=v.end_date::date,block_count=v.block_count,milestones=v.milestones
          from jsonb_to_recordset(${tx.json(updates)}::jsonb)
            as v(id uuid,updated_at timestamptz,end_study_grade text,end_block text,end_date text,
              block_count integer,milestones jsonb)
          where g.id=v.id and g.tenant_id=${id} and g.updated_by is null
            and g.updated_at=v.updated_at and g.start_date=${FIRST_DEMO_DAY}::date
            and (g.block_count,g.end_date,g.milestones) is distinct from
              (v.block_count,v.end_date::date,v.milestones)
        `;
        const inserts = goals.filter(goal => !goal.id);
        if (inserts.length) await tx`
          insert into math_learning_track_goals
            (tenant_id,class_id,student_id,track,block_count,study_grade,end_study_grade,
             start_block,end_block,start_date,end_date,textbook,milestones)
          select ${id},v.class_id,v.student_id,'regular',v.block_count,v.study_grade,v.end_study_grade,
            v.start_block,v.end_block,${FIRST_DEMO_DAY}::date,v.end_date::date,${DEMO_TEXTBOOK},v.milestones
          from jsonb_to_recordset(${tx.json(inserts)}::jsonb)
            as v(class_id uuid,student_id uuid,study_grade text,end_study_grade text,
              start_block text,end_block text,end_date text,block_count integer,milestones jsonb)
          where not exists (
            select 1 from math_learning_track_goals old where old.tenant_id=${id}
              and old.class_id=v.class_id and old.student_id=v.student_id
              and old.track='regular'
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
