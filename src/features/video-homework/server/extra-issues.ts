import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";

type Db = ReturnType<typeof createAdminClient>;

/**
 * **보고서 없이 따로 낸 영상 숙제**(20261013140000 `video_homework_extra_issues`) — 원장 2026-10-13
 * *"숙제 없음을 우클릭해서 숙제 출제"* · *"해당날짜에. 기한은 7일. 따로 보고서 안감"*.
 *
 * 🔑 영상 숙제 = 보고서의 '영상 과제 있음' ∪ 이 표. 숙제를 읽는 곳은 전부 둘을 합친다 — 장부·자동 판정(`getAssignedVideoHomework`) ·
 *    내가 낸 숙제(`own-homework.ts`) · 칸 저장(`setVideoHomeworkRound`) · 영상 손 배정(`video-assignment.ts`) · 올리기 사이트(`site-homework.ts`).
 *    새로 읽는 곳을 만들면 여기도 함께 읽을 것(안 그러면 같은 숙제가 화면마다 있다 없다 한다).
 * 🔴 admin 클라이언트는 RLS를 우회한다 — 늘 지점으로 좁힌다([[#104]]).
 * 🔴 표가 아직 없으면(SQL 적용 전, [[#95]]) '따로 낸 숙제 없음'으로 돈다. 그 밖의 조회 실패는 던진다(없는 것으로 읽지 않는다).
 */
const TABLE = "video_homework_extra_issues";
/**
 * `kept` = 검사 기록 칸에서 **옮겨 남긴 숙제**(20261013220000 · keep-round.ts) — 선생님이 낸 숙제가 아니라, 보고서 표시 없이 검사 기록으로만
 * 서 있던 칸을 미확인·반려 뒤에도 남기려고 둔 줄이다. 칸·손 배정·올리기 사이트에는 숙제로 서지만 장부 ②는 뒷순위로만 영상을 주고,
 * 자동 판정·미제출 알림·운영실 집계·'따로 낸 숙제' 표시에서는 뺀다(정식 숙제로 치면 더 오래된 빈 칸이 다른 칸의 영상을
 * 가져가 그 칸이 미수행이 되고 알림이 나간다 — 적대적 리뷰 2026-10-13). 강사뷰 · 관리자 강사 필터에서는 검사 기록 칸처럼 **그날 보고서를
 * 쓴 선생님**의 칸으로 선다(원장 2026-10-14 *"필터하면 2회, 필터 안하면 3회"* — 장부에 서는 칸은 누구의 칸이든 잡혀야 한다, own-homework.ts).
 * 🔴 kept의 `teacher_id`로 칸 주인을 정하지 말 것 — 그날 보고서가 없으면 지금 담임·누른 사람이 적혀 누르는 순간 주인이 바뀐다.
 */
export type ExtraIssue = { classId: string; studentId: string; date: string; teacherId: string | null; kept: boolean };
type Row = { class_id: string; student_id: string; homework_date: string; teacher_id: string | null; kept?: boolean | null };
/** 🔴 `kept`(20261013220000)는 운영 DB에 적용한 뒤에 이 코드를 배포했다([[#95]]) — 열이 없는 DB에서는 이 표 조회가 실패한다. */
const COLUMNS = "class_id,student_id,homework_date,teacher_id,kept";
const toIssue = (row: Row): ExtraIssue => ({ classId: row.class_id, studentId: row.student_id, date: row.homework_date, teacherId: row.teacher_id, kept: row.kept === true });

let tableKnownReady = false;
type DbError = { code?: string; message?: string } | null | undefined;
const isMissingTable = (error: DbError) => !!error && (error.code === "PGRST205" || error.code === "42P01"
  || /video_homework_extra_issues/.test(error.message ?? "") && /(does not exist|schema cache|could not find)/i.test(error.message ?? ""));
const FAILED = "따로 낸 영상 숙제를 읽지 못했습니다.";

/** 표가 있나 — 양성만 캐시한다(표는 생기기만 한다). */
export async function extraIssuesReady(db: Db): Promise<boolean> {
  if (tableKnownReady) return true;
  const { error } = await db.from(TABLE).select("homework_date").limit(1);
  if (!error) { tableKnownReady = true; return true; }
  if (isMissingTable(error)) return false;
  throw new Error(FAILED);
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetExtraIssuesProbeForTest(): void { tableKnownReady = false; }

/** 기간 안의 따로 낸 숙제 전부(지점 단위 · 선생님으로 좁힐 수 있다). */
export async function listExtraIssues(db: Db, tenantId: string, filter: { fromDate: string; toDate: string; teacherId?: string }): Promise<ExtraIssue[]> {
  if (!(await extraIssuesReady(db))) return [];
  const rows = await fetchAllPaged<Row>((from, to) => {
    const query = db.from(TABLE).select(COLUMNS).eq("tenant_id", tenantId)
      .gte("homework_date", filter.fromDate).lt("homework_date", addDays(filter.toDate, 1));
    if (filter.teacherId) query.eq("teacher_id", filter.teacherId);
    return query.order("homework_date", { ascending: true }).order("class_id", { ascending: true }).order("student_id", { ascending: true }).range(from, to);
  });
  return rows.map(toIssue);
}

/** 학생·반 몇 개의 따로 낸 숙제(올리기 사이트·배정 창) — 기간을 안 주면 전 기간. 학생 몇 명 치라 한 번에 읽는다. */
export async function listExtraIssuesFor(db: Db, tenantId: string, filter: {
  studentIds: readonly string[]; classIds: readonly string[]; fromDate?: string; toDate?: string; limit?: number;
}): Promise<ExtraIssue[]> {
  if (!filter.studentIds.length || !filter.classIds.length || !(await extraIssuesReady(db))) return [];
  const query = db.from(TABLE).select(COLUMNS).eq("tenant_id", tenantId)
    .in("student_id", [...filter.studentIds]).in("class_id", [...filter.classIds]);
  if (filter.fromDate) query.gte("homework_date", filter.fromDate);
  if (filter.toDate) query.lt("homework_date", addDays(filter.toDate, 1));
  const { data, error } = await query.order("homework_date", { ascending: false }).limit(filter.limit ?? 500);
  if (error) throw new Error(FAILED);
  return ((data ?? []) as Row[]).map(toIssue);
}

/** 그 반 × 학생 × 날짜에 따로 낸 숙제가 있나 — 선생님을 주면 그 선생님의 숙제일 때만 참. */
export async function findExtraIssue(db: Db, tenantId: string, key: { classId: string; studentId: string; date: string }): Promise<ExtraIssue | null> {
  if (!(await extraIssuesReady(db))) return null;
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq("tenant_id", tenantId)
    .eq("class_id", key.classId).eq("student_id", key.studentId).eq("homework_date", key.date).limit(1);
  if (error) throw new Error(FAILED);
  const row = ((data ?? []) as Row[])[0];
  return row ? toIssue(row) : null;
}
