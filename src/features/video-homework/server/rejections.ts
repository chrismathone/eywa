import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";

type Db = ReturnType<typeof createAdminClient>;

/**
 * **영상 숙제 반려 표시**(20261013160000 `video_homework_rejections`, 원장 2026-10-13) — 숙제 칸마다 반려한 시각.
 * 그 시각 전에 올라온 영상은 그 칸에 자동으로 붙지 않는다(`rounds.ts` ② — 반려한 칸을 다른 숙제의 영상이 다시 채우지 않게).
 * 🔑 숙제 칸을 짜는 곳(장부 · 올리기 사이트 · 자동 판정)은 전부 이 표시를 함께 넘긴다 — 안 넘기면 화면마다 칸이 달라진다.
 * 🔴 admin 클라이언트는 RLS를 우회한다 — 늘 지점으로 좁힌다([[#104]]). 표가 아직 없으면(SQL 적용 전) '반려 없음'으로 돈다.
 */
export const REJECTIONS_TABLE = "video_homework_rejections";
export type HomeworkRejection = { classId: string; studentId: string; date: string; rejectedAt: string };
type Row = { class_id: string; student_id: string; homework_date: string; rejected_at: string };
const COLUMNS = "class_id,student_id,homework_date,rejected_at";
const toRejection = (row: Row): HomeworkRejection => ({ classId: row.class_id, studentId: row.student_id, date: row.homework_date, rejectedAt: row.rejected_at });

let tableKnownReady = false;
type DbError = { code?: string; message?: string } | null | undefined;
const isMissingTable = (error: DbError) => !!error && (error.code === "PGRST205" || error.code === "42P01"
  || /video_homework_rejections/.test(error.message ?? "") && /(does not exist|schema cache|could not find)/i.test(error.message ?? ""));

/** 표가 있나 — 양성만 캐시한다(표는 생기기만 한다). 표가 없다는 것 말고 다른 오류는 던진다. */
export async function rejectionsReady(db: Db): Promise<boolean> {
  if (tableKnownReady) return true;
  const { error } = await db.from(REJECTIONS_TABLE).select("homework_date").limit(1);
  if (!error) { tableKnownReady = true; return true; }
  if (isMissingTable(error)) return false;
  throw new Error("영상 숙제 반려 표시를 읽지 못했습니다.");
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetRejectionsProbeForTest(): void { tableKnownReady = false; }

/** 기간 안의 반려 표시 — 학생을 주면 그 학생들만(청크 × 페이징), 아니면 지점 전체. */
export async function listRejections(db: Db, tenantId: string, filter: { fromDate: string; toDate: string; studentIds?: readonly string[] }): Promise<HomeworkRejection[]> {
  if (!(await rejectionsReady(db))) return [];
  const end = addDays(filter.toDate, 1);
  const rows = filter.studentIds
    ? await fetchAllPagedInChunks<Row>([...new Set(filter.studentIds)], (chunk, from, to) =>
      db.from(REJECTIONS_TABLE).select(COLUMNS).eq("tenant_id", tenantId).in("student_id", chunk)
        .gte("homework_date", filter.fromDate).lt("homework_date", end)
        .order("student_id").order("class_id").order("homework_date").range(from, to))
    : await fetchAllPaged<Row>((from, to) =>
      db.from(REJECTIONS_TABLE).select(COLUMNS).eq("tenant_id", tenantId)
        .gte("homework_date", filter.fromDate).lt("homework_date", end)
        .order("student_id").order("class_id").order("homework_date").range(from, to));
  return rows.map(toRejection);
}

/** `반:학생` → 숙제일 → 반려 시각 — 칸을 짜는 줄(`rejected`)에 그대로 싣는다. */
export function rejectionsByPair(list: readonly HomeworkRejection[]): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const r of list) {
    const key = `${r.classId}:${r.studentId}`;
    out.set(key, { ...(out.get(key) ?? {}), [r.date]: r.rejectedAt });
  }
  return out;
}
