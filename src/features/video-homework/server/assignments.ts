import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
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
 * 관리 화면용 — (학생, 반)의 **기준일 전 마지막 보고서**(값 유무와 무관 — 원스크린 prevReport와 같은 축)의 영상 과제 값.
 * `반:학생 → true/false` · 마지막 보고서가 null(모름)이거나 창(60일) 안에 보고서가 없으면 키가 없다. 실패는 빈 지도(표시만 빠짐).
 */
export async function getLastLessonAssignments(
  tenantId: string,
  pairs: { classId: string; studentId: string }[],
  beforeDate: string,
  fromDate: string,
): Promise<Record<string, boolean>> {
  if (!pairs.length) return {};
  try {
    const db = createAdminClient();
    if (!(await videoHomeworkColumnReady(db))) return {};
    const wanted = new Set(pairs.map((p) => `${p.classId}:${p.studentId}`));
    const rows = await fetchAllPagedInChunks<ReportRow>(
      [...new Set(pairs.map((p) => p.studentId))],
      (chunk, from, to) => db
        .from("lesson_reports")
        .select("student_id,class_id,report_date,video_homework")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .gte("report_date", fromDate)
        .lt("report_date", beforeDate)
        .not("class_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const latest = new Map<string, ReportRow>();
    for (const r of rows) {
      const key = `${r.class_id}:${r.student_id}`;
      if (!wanted.has(key)) continue;
      const cur = latest.get(key);
      if (!cur || r.report_date > cur.report_date) latest.set(key, r);
    }
    const out: Record<string, boolean> = {};
    for (const [key, r] of latest) if (typeof r.video_homework === "boolean") out[key] = r.video_homework;
    return out;
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "getLastLessonAssignments", message: e instanceof Error ? e.message : String(e) }));
    return {};
  }
}
