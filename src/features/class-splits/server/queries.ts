import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isSplitDay, type ClassSplit, type SplitPeriodKind } from "../rules";
import { splitActiveOn, splitOverlapsRange } from "../period";

/**
 * 수업 나누기(0351a) 조회. 🔴 **fail-soft** — 표가 없거나(SQL 미적용, [[#95]]) 조회가 실패하면 빈 목록이다.
 * 시간표는 hot path라 이 기능 때문에 화면이 죽으면 안 된다.
 */
export function isMissingSplitTable(e: { code?: string; message?: string } | null | undefined): boolean {
  return (
    e?.code === "PGRST205" ||
    e?.code === "42P01" ||
    (/class_splits/.test(e?.message ?? "") && /not find|does not exist|schema cache/i.test(e?.message ?? ""))
  );
}

const SELECT =
  "id, student_id, source_class_id, target_class_id, day_of_week, start_time, end_time, valid_from, valid_to, period_kind, note";

type Row = {
  id: string;
  student_id: string;
  source_class_id: string;
  target_class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_to: string | null;
  period_kind: string;
  note: string | null;
};

export function toSplit(r: Row): ClassSplit | null {
  if (!isSplitDay(r.day_of_week)) return null;
  const kind: SplitPeriodKind = r.period_kind === "day" || r.period_kind === "month" ? r.period_kind : "forever";
  return {
    id: r.id,
    studentId: r.student_id,
    sourceClassId: r.source_class_id,
    targetClassId: r.target_class_id,
    dayOfWeek: r.day_of_week,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
    validFrom: String(r.valid_from).slice(0, 10),
    validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
    periodKind: kind,
    note: r.note ?? null,
  };
}

function soft(where: string, error: { code?: string; message?: string } | null): ClassSplit[] {
  if (error && !isMissingSplitTable(error)) console.error(`[class-splits] ${where} 조회 실패`, error.message);
  return [];
}

/**
 * 반 목록이 **보내거나 받는** 나눔 중 [from, to]와 겹치는 것. 시간표(주)·출석부(하루)가 쓴다.
 * 🔴 B3 — 반이 수십 개라 `.in()`은 청크. 한 반의 나눔이 1000건을 넘을 일이 없어 청크마다 페이지네이션은 안 한다.
 */
export async function getSplitsTouchingClasses(
  classIds: readonly string[],
  from: string,
  to: string,
): Promise<ClassSplit[]> {
  const ids = [...new Set(classIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const supabase = await createClient();
  try {
    // 보내는 쪽·받는 쪽은 서로 독립 조회(B4).
    const [out, inc] = await Promise.all([
      fetchInChunks<Row>(ids, (chunk) =>
        supabase.from("class_splits").select(SELECT).in("source_class_id", chunk).lte("valid_from", to),
      ),
      fetchInChunks<Row>(ids, (chunk) =>
        supabase.from("class_splits").select(SELECT).in("target_class_id", chunk).lte("valid_from", to),
      ),
    ]);
    const byId = new Map<string, ClassSplit>();
    for (const r of [...out, ...inc]) {
      const s = toSplit(r);
      if (s && splitOverlapsRange(s, from, to)) byId.set(s.id, s);
    }
    return [...byId.values()];
  } catch (e) {
    return soft("반", e as { code?: string; message?: string });
  }
}

/** 한 학생의 나눔 전부(겹침 확인·학생 상세). */
export async function getSplitsOfStudent(studentId: string): Promise<ClassSplit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("class_splits").select(SELECT).eq("student_id", studentId);
  if (error) return soft("학생", error);
  return ((data ?? []) as Row[]).map(toSplit).filter((s): s is ClassSplit => s !== null);
}

export type SplitClassName = { name: string; teacherName: string | null };

/**
 * **한 날짜**에 살아 있는 나눔(반 목록이 보내거나 받는 것) + 상대 반 이름·담임 — 출석부 표면(일별·월별·오늘 출결·
 * 원스크린·ECS 오늘)이 공용으로 쓴다. 요청당 1회 캐시(같은 페이지 여러 조각이 같은 날짜를 묻는다).
 * 🔴 fail-soft — 표 미적용·조회 실패면 빈 결과다(출석부가 이 기능 때문에 죽으면 안 된다, [[#95]]).
 */
export const getSplitsOnDate = cache(async function getSplitsOnDate(
  date: string,
  classIds: readonly string[],
): Promise<{ splits: ClassSplit[]; classNames: Map<string, SplitClassName> }> {
  const splits = (await getSplitsTouchingClasses(classIds, date, date)).filter((s) => splitActiveOn(s, date));
  if (splits.length === 0) return { splits, classNames: new Map() };
  const ids = [...new Set(splits.flatMap((s) => [s.sourceClassId, s.targetClassId]))];
  const supabase = await createClient();
  type Cls = { id: string; class_name: string; teacher?: { display_name?: string } | { display_name?: string }[] | null };
  const rows = await fetchInChunks<Cls>(ids, (c) =>
    supabase.from("classes").select("id, class_name, teacher:teacher_id ( display_name )").in("id", c),
  ).catch(() => [] as Cls[]);
  const classNames = new Map<string, SplitClassName>(
    rows.map((r) => {
      const t = Array.isArray(r.teacher) ? r.teacher[0] : r.teacher;
      return [r.id, { name: r.class_name, teacherName: t?.display_name ?? null }];
    }),
  );
  return { splits, classNames };
});

/**
 * 쓰기 게이트용 — 그날 이 학생이 **나눔으로 이 반에 오는가**(강사 계정이 수강행 없이 출결을 찍을 근거).
 * 🔴 판정은 서버가 표를 직접 본다(클라 플래그가 아니라, #77). 조회 실패는 false(모르면 안 연다).
 */
export async function hasSplitInto(classId: string, studentId: string, date: string): Promise<boolean> {
  const splits = await getSplitsTouchingClasses([classId], date, date).catch(() => [] as ClassSplit[]);
  return splits.some((s) => s.targetClassId === classId && s.studentId === studentId && splitActiveOn(s, date));
}

/** 일괄 게이트용 — 그날 나눔으로 들어오는 (학생, 반) 키 집합(`학생::반`). */
export async function splitIntoKeys(classIds: readonly string[], date: string): Promise<Set<string>> {
  const splits = await getSplitsTouchingClasses(classIds, date, date).catch(() => [] as ClassSplit[]);
  return new Set(splits.filter((s) => splitActiveOn(s, date)).map((s) => `${s.studentId}::${s.targetClassId}`));
}
