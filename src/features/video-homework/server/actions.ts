"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { logAction } from "@/features/audit/server/log";
import { addDays, kstToday } from "@/lib/date-kst";
import { isVideoHomeworkDate, type VideoHomeworkStatus } from "../types";
import { videoHomeworkColumnReady } from "./assignments";
import { isCancelledHomework } from "./cancels";
import { findExtraIssue } from "./extra-issues";
import { keepMarkOnlyRound } from "./keep-round";
import { ledgerRoundWriteError, loadVideoHomeworkTarget, videoHomeworkWriteError, writeVideoHomeworkMark, type MarkWriteResult } from "./mark-write";
import { nativeWriteAllowance } from "@/features/makeups/server/adapters/gates";
import { explainDbError } from "@/lib/supabase/db-error";

type Db = ReturnType<typeof createAdminClient>;
type CheckCell = { classId: string; studentId: string; checkDate: string; homeworkDate: string | null;
  submittedDate?: string | null; status: VideoHomeworkStatus | null };

const STATUSES: readonly (VideoHomeworkStatus | null)[] = ["submitted", "missing", null];
const badSubmittedDate = (value: string | null | undefined) =>
  value != null && (!isVideoHomeworkDate(value) || value > kstToday());

/** 원스크린 '지난 수업 영상 숙제' 검사 — 검사한 수업일 자리에 적는다(같은 숙제의 기록이 이미 있으면 그 줄을 고친다). */
export async function setVideoHomeworkMark(input: {
  classId: string;
  studentId: string;
  checkDate: string;
  homeworkDate: string | null;
  submittedDate?: string | null;
  status: VideoHomeworkStatus | null;
}): Promise<MarkWriteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  if (!isVideoHomeworkDate(input.checkDate) || (input.homeworkDate !== null && !isVideoHomeworkDate(input.homeworkDate)))
    return { ok: false, error: "수업 날짜가 올바르지 않습니다." };
  if (input.checkDate > kstToday()) return { ok: false, error: "미래 수업의 숙제는 검사할 수 없습니다." };
  if (badSubmittedDate(input.submittedDate)) return { ok: false, error: "제출일은 오늘까지의 올바른 날짜로 입력해 주세요." };
  if (input.homeworkDate && input.homeworkDate > input.checkDate)
    return { ok: false, error: "지난 숙제 날짜는 검사일보다 늦을 수 없습니다." };
  if (!STATUSES.includes(input.status)) return { ok: false, error: "유효하지 않은 상태입니다." };
  const denied = await videoHomeworkWriteError(user, input.classId, input.checkDate);
  if (denied) return { ok: false, error: denied };
  return writeCheckedMark(createAdminClient(), { tenantId: user.tenantId, userId: user.id }, input);
}

/**
 * 검사 한 칸을 쓴다 — 대상(반·학생·정책)과 그날 명단을 확인한 뒤. 로그인·열람 전용·날짜 모양·반 권한은 **부르는 쪽**이 먼저 본다
 * (한 칸 저장과 일괄 저장이 같은 확인을 지나게 한 벌로 묶었다).
 */
async function writeCheckedMark(db: Db, user: { tenantId: string; userId: string }, input: CheckCell): Promise<MarkWriteResult> {
  if (input.status !== null) {
    const target = await loadVideoHomeworkTarget(db, user.tenantId, input.classId, input.studentId);
    if (target.error !== null) return { ok: false, error: target.error };
    if (!target.enabled) return { ok: false, error: "영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요." };
    // 장부에서 취소한 숙제(원장 2026-10-16, cancels.ts) — 다음 수업 원스크린을 열어 둔 채 취소하면 검사 칸이 남아 있다. 거기 찍으면
    // 취소한 숙제가 '검사 기록 칸'으로 되살아난다 — 다시 낸 숙제(보고서 '있음' · 따로 낸 숙제)가 아니면 적지 않는다(되돌리기는 막지 않는다).
    if (input.homeworkDate && await isCancelledHomework(db, user.tenantId, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate }))
      return { ok: false, error: "영상 제출 현황에서 취소한 숙제입니다. 화면을 새로고침해 주세요." };
  }
  const { data: enrollments, error: enrollmentError } = await db
    .from("enrollments")
    .select("start_date,end_date,on_hold,is_transferred")
    .eq("tenant_id", user.tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .or(`start_date.is.null,start_date.lte.${input.checkDate}`)
    .or(`end_date.is.null,end_date.gte.${input.checkDate}`);
  if (enrollmentError) return { ok: false, error: explainDbError(enrollmentError, { scope: "video-homework.actions.writeCheckedMark", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const enrolledOnDate = (enrollments ?? []).some((row) => isEnrollmentActiveOn({
    startDate: row.start_date ?? "", endDate: row.end_date,
    onHold: row.on_hold === true, isTransferred: row.is_transferred === true,
  }, input.checkDate));
  if (!enrolledOnDate) {
    // 보강 학생은 해당 반의 정규 수강이 없어도 출결이나 예약으로 강사 명단에 나타난다.
    const scope = (table: string) => db.from(table).select("id")
      .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId);
    const [attendance, reservation, existing] = await Promise.all([
      scope("attendance_records").eq("session_date", input.checkDate).limit(1),
      scope("makeup_reservations").eq("makeup_date", input.checkDate).eq("status", "reserved").limit(1),
      scope("video_homework_marks").eq("check_date", input.checkDate).limit(1),
    ]);
    if (attendance.error || reservation.error || existing.error)
      return { ok: false, error: attendance.error?.message ?? reservation.error?.message ?? existing.error?.message };
    if (!attendance.data?.length && !reservation.data?.length && !existing.data?.length) {
      const native = await nativeWriteAllowance({ studentId: input.studentId, classId: input.classId, sessionDate: input.checkDate });
      if (native.error) return { ok: false, error: native.error };
      if (!native.allow) return { ok: false, error: "해당 수업 날짜의 학생을 찾을 수 없습니다." };
    }
  }
  return writeVideoHomeworkMark(db, { tenantId: user.tenantId, userId: user.userId, classId: input.classId, studentId: input.studentId,
    slotDate: input.checkDate, slotIsMine: true, homeworkDate: input.homeworkDate, submittedDate: input.submittedDate, status: input.status });
}

const BULK_MAX_CELLS = 300;
const BULK_CONCURRENCY = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 원스크린 일괄 입력의 '지난 영상 숙제 검사'(원장 2026-10-02 *"일괄 입력에 지금 없는거 추가"*) — 여러 칸을 **한 왕복**으로.
 * 한 칸씩 부르면 서버 액션이 줄을 서서(클라는 액션을 차례로 보낸다) 30행에 수 초가 걸리고 그동안 자동저장이 밀린다.
 * 칸마다 지나는 확인은 `setVideoHomeworkMark`와 같다(반 권한 · 대상 · 그날 명단). 통과한 칸만 적고 그 목록을 돌려준다 —
 * 화면은 그 칸만 칠한다(막힌 칸을 '됐다'고 보이지 않게).
 */
export async function setVideoHomeworkMarksBulk(input: {
  checkDate: string;
  status: VideoHomeworkStatus;
  cells: { classId: string; studentId: string; homeworkDate: string | null }[];
}): Promise<{ ok: boolean; error?: string; applied: { classId: string; studentId: string }[]; failed: number }> {
  const none = (error: string) => ({ ok: false, error, applied: [], failed: 0 });
  const user = await getCurrentUser();
  if (!user) return none("로그인이 필요합니다.");
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return none(readonlyError);
  if (!isVideoHomeworkDate(input.checkDate)) return none("수업 날짜가 올바르지 않습니다.");
  if (input.checkDate > kstToday()) return none("미래 수업의 숙제는 검사할 수 없습니다.");
  if (input.status !== "submitted" && input.status !== "missing") return none("유효하지 않은 상태입니다.");
  if (!Array.isArray(input.cells) || input.cells.length > BULK_MAX_CELLS) return none("한 번에 처리할 수 있는 칸 수를 넘었습니다.");
  // 같은 (반 · 학생)은 한 번만 — 그날 검사 칸은 반 × 학생당 하나다. 모양이 틀린 칸은 버린다(세지 않는다).
  const byKey = new Map<string, { classId: string; studentId: string; homeworkDate: string | null }>();
  let failed = 0;
  for (const cell of input.cells) {
    const homeworkDate = cell?.homeworkDate ?? null;
    if (typeof cell?.classId !== "string" || typeof cell?.studentId !== "string" || !UUID_RE.test(cell.classId) || !UUID_RE.test(cell.studentId) ||
      (homeworkDate !== null && (!isVideoHomeworkDate(homeworkDate) || homeworkDate > input.checkDate))) { failed += 1; continue; }
    byKey.set(`${cell.classId}:${cell.studentId}`, { classId: cell.classId, studentId: cell.studentId, homeworkDate });
  }
  const cells = [...byKey.values()];
  if (!cells.length) return { ok: true, applied: [], failed };
  // 반 권한은 반마다 한 번(B4) — 막힌 반의 칸은 통째로 빠진다.
  const classIds = [...new Set(cells.map((cell) => cell.classId))];
  const deniedList = await Promise.all(classIds.map((classId) => videoHomeworkWriteError(user, classId, input.checkDate)));
  const allowed = new Set(classIds.filter((_, i) => !deniedList[i]));
  const db = createAdminClient();
  const applied: { classId: string; studentId: string }[] = [];
  const queue = cells.filter((cell) => { if (allowed.has(cell.classId)) return true; failed += 1; return false; });
  // 칸마다 조회 4~5개 — 한꺼번에 다 띄우지 않고 몇 개씩(연결을 몰아 쓰지 않게).
  for (let i = 0; i < queue.length; i += BULK_CONCURRENCY) {
    const results = await Promise.all(queue.slice(i, i + BULK_CONCURRENCY).map((cell) =>
      writeCheckedMark(db, { tenantId: user.tenantId, userId: user.id }, { ...cell, checkDate: input.checkDate, status: input.status })
        .catch((): MarkWriteResult => ({ ok: false }))
        .then((result) => ({ cell, result }))));
    for (const { cell, result } of results) {
      if (result.ok) applied.push({ classId: cell.classId, studentId: cell.studentId });
      else failed += 1;
    }
  }
  if (applied.length) await logAction({
    action: "lesson_report_video_homework_mark",
    targetType: "video_homework",
    targetLabel: `원스크린 일괄 ${applied.length}건`,
    metadata: { bulk: true, checkDate: input.checkDate, status: input.status, count: applied.length, failed },
  });
  return { ok: true, applied, failed };
}

/**
 * 영상 제출 현황(장부) — **회차 한 칸**을 찍는다. 회차 = `h:숙제일`(숙제가 나간 수업) 또는 `c:검사일`(숙제일 없는 옛 기록).
 * 새 기록의 자리는 서버가 정한다(숙제일 다음 날 — `writeVideoHomeworkMark`) — 화면이 보낸 날짜를 저장 키로 믿지 않는다.
 */
export async function setVideoHomeworkRound(input: {
  classId: string;
  studentId: string;
  roundKey: string;
  submittedDate?: string | null;
  status: VideoHomeworkStatus | null;
}): Promise<MarkWriteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  const [kind, date] = [input.roundKey.slice(0, 2), input.roundKey.slice(2)];
  if ((kind !== "h:" && kind !== "c:") || !isVideoHomeworkDate(date)) return { ok: false, error: "회차를 확인할 수 없습니다." };
  if (date > kstToday()) return { ok: false, error: "아직 나가지 않은 숙제는 기록할 수 없습니다." };
  if (!STATUSES.includes(input.status)) return { ok: false, error: "유효하지 않은 상태입니다." };
  if (badSubmittedDate(input.submittedDate)) return { ok: false, error: "제출일은 오늘까지의 올바른 날짜로 입력해 주세요." };
  const homeworkDate = kind === "h:" ? date : null;
  if (homeworkDate && input.submittedDate && input.submittedDate < homeworkDate)
    return { ok: false, error: "제출일은 숙제가 나간 날보다 빠를 수 없습니다." };
  const db = createAdminClient();
  // 수업보고서 전체 권한이면 모든 칸, 아니면 강사 쓰기 + 자기가 낸 숙제 칸만(강사뷰 '영상 제출 현황', 2026-10-03 — ledgerRoundWriteError).
  const denied = await ledgerRoundWriteError(db, user, { classId: input.classId, studentId: input.studentId, homeworkDate });
  if (denied) return { ok: false, error: denied };
  const target = await loadVideoHomeworkTarget(db, user.tenantId, input.classId, input.studentId);
  if (target.error !== null) return { ok: false, error: target.error };
  if (input.status !== null && !target.enabled)
    return { ok: false, error: "영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요." };
  // 그 회차가 실제로 있나 — 이미 찍힌 기록이거나, 그날 그 반 보고서에 '영상 과제 있음'이 남아 있어야 한다.
  const marks = db.from("video_homework_marks").select("id")
    .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId);
  const recorded = await (homeworkDate ? marks.eq("homework_date", homeworkDate) : marks.eq("check_date", date).is("homework_date", null)).limit(1);
  if (recorded.error) return { ok: false, error: explainDbError(recorded.error, { scope: "video-homework.actions.setVideoHomeworkRound", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if (!recorded.data?.length) {
    const assigned = homeworkDate && (await videoHomeworkColumnReady(db)) ? await db.from("lesson_reports").select("id")
      .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId)
      .eq("report_date", homeworkDate).eq("video_homework", true).limit(1) : null;
    if (assigned?.error) return { ok: false, error: explainDbError(assigned.error, { scope: "video-homework.actions.setVideoHomeworkRound", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    // 보고서 없이 따로 낸 숙제(extra-issues.ts)도 같은 숙제다.
    const extra = homeworkDate && !assigned?.data?.length
      ? await findExtraIssue(db, user.tenantId, { classId: input.classId, studentId: input.studentId, date: homeworkDate }).catch(() => undefined) : null;
    if (extra === undefined) return { ok: false, error: "영상 과제를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    if (!assigned?.data?.length && !extra) return { ok: false, error: "그날 이 학생에게 나간 영상 과제를 찾을 수 없습니다." };
  }
  // 검사 기록만으로 선 숙제 칸을 미확인으로 = 그 날짜를 따로 낸 숙제로 남긴 뒤 지운다 — 그냥 지우면 칸이 통째로 사라진다(keep-round.ts).
  let kept = false;
  // 지울 기록이 이미 없는데 여기까지 왔으면 그날은 숙제(보고서 표시 · 따로 낸 숙제)다 — 칸이 남는다. 다른 창에서 먼저 미확인으로 바꿔 기록이
  // 지워진 칸을 낡은 창에서 다시 미확인으로 저장해도 그 창이 칸을 지우지 않게(적대적 리뷰 2026-10-14).
  let stays = input.status === null && !recorded.data?.length;
  if (input.status === null && homeworkDate && recorded.data?.length) {
    const keep = await keepMarkOnlyRound(db, user.tenantId, user.id, { classId: input.classId, studentId: input.studentId, date: homeworkDate });
    if (keep === "failed") return { ok: false, error: "숙제 칸을 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    kept = keep === "kept";
    stays = kept || keep === "assigned";
  }
  const result = await writeVideoHomeworkMark(db, { tenantId: user.tenantId, userId: user.id, classId: input.classId,
    studentId: input.studentId, slotDate: homeworkDate ? addDays(homeworkDate, 1) : date, homeworkDate,
    submittedDate: input.submittedDate, status: input.status });
  if (result.ok) await logAction({
    action: "lesson_report_video_homework_mark",
    targetType: "video_homework",
    targetLabel: [target.studentName, target.className].filter(Boolean).join(" · ") || null,
    metadata: { classId: input.classId, studentId: input.studentId, homeworkDate, checkDate: homeworkDate ? null : date,
      status: input.status ?? "cleared", submittedDate: input.status === "submitted" ? input.submittedDate ?? null : null,
      ...(kept ? { keptAsIssue: true } : {}) },
  });
  // 칸이 남았음을 화면에 알린다 — 화면은 기록만 지우고 서버 값을 다시 읽기 전이라, 이 표시가 없으면 남은 칸을 지운 채로 그린다
  // (원장 2026-10-14 홍채민 10/2 — 서버는 옮겨 남겼는데 화면에서 칸이 사라졌다).
  return result.ok && stays ? { ...result, kept: true } : result;
}
