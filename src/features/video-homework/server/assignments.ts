import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { assignmentKey, type VideoHomeworkAssignments } from "../assignment";

/**
 * `lesson_reports.video_homework`(0308a) 적용 여부 probe — mentSourceColumnReady(ment-source-db.ts)와 같은 결.
 *
 * 🔴 #95: aywa는 SQL을 원장이 손으로 돌려 push와 적용 사이 간격이 있다. 이 컬럼을 원스크린 로스터(전원 핫패스)
 *    select에 넣으면 그 간격 동안 **강사 전원 화면이 400으로 죽는다** — 그래서 로스터엔 넣지 않고, 여기서만
 *    따로 읽고 없으면 조용히 '모름'으로 둔다. 캐시는 양성만(컬럼은 생기기만 한다).
 */
let columnKnownReady = false;

function isMissingColumn(message: string | undefined): boolean {
  return !!message && /video_homework/.test(message) && /(does not exist|column|schema cache)/i.test(message);
}

type Db = ReturnType<typeof createAdminClient>;

export async function videoHomeworkColumnReady(db: Db = createAdminClient()): Promise<boolean> {
  if (columnKnownReady) return true;
  const { error } = await db.from("lesson_reports").select("video_homework").limit(1);
  if (!error) {
    columnKnownReady = true;
    return true;
  }
  if (!isMissingColumn(error.message)) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkColumnReady", reason: "probe_failed_transient", message: error.message }));
  }
  return false;
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetVideoHomeworkProbeForTest(): void {
  columnKnownReady = false;
}

type ReportRow = { student_id: string; class_id: string | null; report_date: string; video_homework: boolean | null };

/**
 * 원스크린용 — 학생들의 **정해진 날짜들**(각 행의 직전 수업일 + 오늘)의 영상 과제 값만 → `학생|날짜|반 → true/false`.
 * 🔴 실패·컬럼 미적용은 **null**(= 모른다)로 돌려준다 — 빈 지도(= 값 없음)와 구별해야 화면이 그 세션 동안 값을 **보내지 않는다**
 *    (못 읽은 채로 저장하면 저장돼 있던 '있음'을 '없음'으로 덮는다). 검사 칸은 둘 다 예전처럼 뜬다.
 */
export async function getVideoHomeworkAssignments(
  tenantId: string,
  studentIds: string[],
  dates: string[],
): Promise<VideoHomeworkAssignments | null> {
  const days = [...new Set(dates.filter(Boolean))];
  if (!studentIds.length || !days.length) return {};
  try {
    const db = createAdminClient();
    if (!(await videoHomeworkColumnReady(db))) return null;
    const rows = await fetchAllPagedInChunks<ReportRow>(
      [...new Set(studentIds)],
      (chunk, from, to) => db
        .from("lesson_reports")
        .select("student_id,class_id,report_date,video_homework")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .in("report_date", days)
        .not("video_homework", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const out: Record<string, boolean> = {};
    for (const r of rows) {
      if (!r.class_id || typeof r.video_homework !== "boolean") continue;
      out[assignmentKey(r.student_id, r.report_date, r.class_id)] = r.video_homework;
    }
    return out;
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "getVideoHomeworkAssignments", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/**
 * 원스크린용 — 그날 이 학생들의 보고서 중 **다른 선생님이 처음 쓴 줄**(작성 계정 0172a ≠ 나)을 `학생|날짜|반` 키로.
 * 영상 과제 토글을 잠그는 **화면 겹**이다([`report-owner.ts`] — 저장 관문과 DB 트리거(0336a)가 같은 판정을 한 번씩 더 한다).
 * 실패는 빈 목록(잠그지 않음) — 실제로 막는 건 서버다. 작성 계정은 이미 있는 칸이라 #95 위험이 없다.
 */
export async function getOthersReportKeys(
  tenantId: string,
  studentIds: string[],
  date: string,
  ownerId: string,
): Promise<string[]> {
  if (!studentIds.length || !date) return [];
  try {
    const db = createAdminClient();
    const rows = await fetchAllPagedInChunks<{ student_id: string; class_id: string | null; report_date: string }>(
      [...new Set(studentIds)],
      (chunk, from, to) => db
        .from("lesson_reports")
        .select("student_id,class_id,report_date")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .eq("report_date", date)
        .not("class_id", "is", null)
        .not("created_by", "is", null)
        .neq("created_by", ownerId)
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.flatMap((r) => (r.class_id ? [assignmentKey(r.student_id, r.report_date, r.class_id)] : []));
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "getOthersReportKeys", message: e instanceof Error ? e.message : String(e) }));
    return [];
  }
}

/**
 * 영상 제출 현황용 — 기간 안에 **영상 과제가 나간 수업**(`video_homework = true`, 반이 있는 보고서만)을 (반, 학생, 날짜)로.
 * 이 목록이 곧 회차다(원장 2026-10-01 *"숙제 나간 날만 횟수가 늘어나는걸로"*) — 없음(false)·모름(null)인 수업은 회차가 아니다.
 * 컬럼 미적용·probe 실패는 **null**(= 모른다) — 화면이 "기록만 보인다"고 알린다. 조회 자체의 오류는 그대로 던진다
 * (숙제가 없는 것처럼 조용히 비우면 미확인이 통째로 사라진다).
 */
export async function getAssignedVideoHomework(
  tenantId: string,
  fromDate: string,
  toDate: string,
): Promise<{ classId: string; studentId: string; date: string }[] | null> {
  const db = createAdminClient();
  if (!(await videoHomeworkColumnReady(db))) return null;
  const rows = await fetchAllPaged<ReportRow>((from, to) => db
    .from("lesson_reports")
    .select("student_id,class_id,report_date,video_homework")
    .eq("tenant_id", tenantId)
    .eq("video_homework", true)
    .not("class_id", "is", null)
    .gte("report_date", fromDate)
    .lte("report_date", toDate)
    .order("id", { ascending: true })
    .range(from, to));
  return rows.flatMap((r) => (r.class_id ? [{ classId: r.class_id, studentId: r.student_id, date: r.report_date }] : []));
}
