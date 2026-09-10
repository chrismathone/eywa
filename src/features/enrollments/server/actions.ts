"use server";

import { revalidatePath } from "next/cache";
// 🔴 DB 오류 한글 매핑은 **이 파일 밖**에 산다 — `"use server"` 파일은 async 함수만 export할 수
//    있어서, 동기 헬퍼를 여기서 내보내면 프로덕션 빌드가 깨진다(2026-08-29 실측).
import { isOverlapConflict, toKoreanDbError } from "../db-errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { accessLevelTenant, canManageTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { notifyClassAssignment } from "@/features/notifications/server/notify";
import { logAction } from "@/features/audit/server/log";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { enrollmentAssignBlockReason } from "../eligibility";
import { enrollmentDeleteBlockReason, type EnrollmentRecordCounts } from "../deletable";
import {
  applyDateEdit,
  dateEditConfirmMessage,
  dateEditConfirmTitle,
  dateEditConfirmToken,
  enrollmentDateEditError,
  newlyExcludedAttendanceRanges,
  transferPairRisk,
  type AttendanceShrink,
  type DateEditRisk,
  type EnrollmentDateField,
  type EnrollmentWindow,
  type ExcludedRange,
} from "../date-edit";

export type CreateEnrollmentState =
  | { error?: string; enrollmentId?: string }
  | undefined;

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const VALID_DAYS = new Set<string>(DAY_ORDER);
const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

/**
 * 겹친 **기존 수강을 실제로 찾아** "언제부터·무슨 요일"까지 알려준다.
 * 막연한 "겹칩니다"로는 원장이 무엇을 고쳐야 할지 알 수 없다(제보 2026-07-28).
 *
 * 조회는 (학생, 반) 한 쌍 + 겹침 조건까지 DB에서 좁힌 뒤 3건만 — 전건 fetch·JS 집계 아님(B2).
 * 겹침 조건은 GiST와 동일한 반열림: `end_date is null or end_date > 새 시작` + `start_date < 새 종료`.
 *
 * @param excludeId 날짜 수정처럼 **자기 자신**이 후보에 섞이면 안 되는 경우의 제외 대상.
 */
async function describeOverlapConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  classId: string,
  startDate: string,
  endDate: string | null,
  excludeId?: string,
): Promise<string> {
  let query = supabase
    .from("enrollments")
    .select("start_date, end_date, attendance_days")
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .or(`end_date.is.null,end_date.gt.${startDate}`);
  if (endDate) query = query.lt("start_date", endDate);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.order("start_date", { ascending: true }).limit(3);

  const hit = (data ?? [])[0];
  if (!hit) return "이미 이 반에 기간이 겹치는 수강이 있어 중복 배정할 수 없습니다.";

  const period = hit.end_date ? `${hit.start_date} ~ ${hit.end_date}` : `${hit.start_date}부터`;
  const days: string[] = hit.attendance_days ?? [];
  const daysLabel = days.length > 0 ? ` · ${days.map((d) => DAY_LABEL[d] ?? d).join("·")}만 등원` : "";
  return (
    `이미 이 반에 배정되어 있습니다 (${period}${daysLabel}). 같은 반에 기간이 겹치는 배정은 만들 수 없습니다 — ` +
    `기존 수강을 학생 상세 '수업' 탭에서 수정하거나, 겹치지 않는 시작일을 선택해 주세요.`
  );
}

/**
 * 분리등원 요일 정규화 — 선택 요일을 수업 운영 요일 교집합으로 좁히고 요일순 정렬한다.
 * 비어있거나 수업의 전 요일을 다 고르면 [] 반환(= 전 요일 등원, 분리등원 아님 — GiST 충돌·표시 일관).
 */
async function normalizeAttendanceDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  picked: string[],
): Promise<string[]> {
  if (picked.length === 0) return [];
  const { data: scheds } = await supabase
    .from("class_schedules")
    .select("day_of_week")
    .eq("class_id", classId);
  const classDays = new Set<string>((scheds ?? []).map((s) => s.day_of_week as string));
  if (classDays.size === 0) return []; // 스케줄 없는 반 — 요일 제약 의미 없음
  const within = picked.filter((d) => classDays.has(d));
  // 전 요일을 다 골랐으면 제약 없음(=[]).
  if (within.length === 0 || within.length >= classDays.size) return [];
  return DAY_ORDER.filter((d) => within.includes(d));
}

/**
 * 학생을 반에 배정.
 * - GiST EXCLUDE 제약으로 학생의 다른 enrollment와 시간 겹침은 자동 차단됨.
 * - UI 단에서 미리 detectStudentScheduleConflicts로 경고할 수 있음.
 */
export async function createEnrollment(
  _prev: CreateEnrollmentState,
  formData: FormData,
): Promise<CreateEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // "반 배정"은 반 상세(classes) + 학생 상세(students) 양쪽에서 호출 — 둘 중 하나라도 **full**이면 허용
  // (counselor는 classes=none이나 students=full로 학생 상세에서 배정. 회계/뷰어=양쪽 readonly/none → 차단).
  // 🔴 canWriteTenant는 scoped(강사)도 통과한다 — 강사=학생 기록 열람 전용(원장 2026-08-18) 체제에서
  //    수강 종료는 full 전용인데 수강 시작이 강사 가능이던 비대칭을 닫는다(적대 리뷰 F2).
  if (
    !(await canManageTenant(user.systemRole, "classes")) &&
    !(await canManageTenant(user.systemRole, "students"))
  ) {
    return { error: "반 배정 권한이 없습니다 — 강사 계정은 열람 전용입니다" };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  const classId = String(formData.get("classId") ?? "").trim();
  const startDate =
    String(formData.get("startDate") ?? "").trim() || kstToday();
  const endDate = String(formData.get("endDate") ?? "").trim() || null;
  // 분리등원: 콤마구분 요일(예 "mon,thu"). 비거나 수업의 전 요일이면 [] = 전 요일 등원.
  const pickedDays = String(formData.get("attendanceDays") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => VALID_DAYS.has(d));

  if (!studentId) return { error: "학생을 선택해주세요" };
  if (!classId) return { error: "반을 선택해주세요" };

  const supabase = await createClient();

  // 반이 본 테넌트 것인지 검증(RLS로 스코프 — 타 테넌트 반 id면 null). enrollments RLS가 class_id의
  // 테넌트를 검증하지 않아 조작된 foreign class로 유령 수강이 생기는 것을 막는다(적대리뷰).
  // 학생 상태도 함께 읽는다 — 서로 의존하지 않는 조회라 병렬(B4).
  const [{ data: klass }, { data: stu }] = await Promise.all([
    supabase.from("classes").select("id").eq("id", classId).maybeSingle(),
    supabase.from("students").select("status").eq("id", studentId).maybeSingle(),
  ]);
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  if (!stu) return { error: "학생을 찾을 수 없습니다" };

  // 🔴 **재원 학생만 배정한다**(원장 2026-08-20 "휴원 해결"). 종전엔 학생 상태를 아예 안 봐서, 휴원
  //    학생에게 반을 배정하면 새 수강의 on_hold가 기본값 false로 들어가 **학생은 휴원인데 그 수업만 활성**이
  //    됐다(로스터는 전부 수강의 on_hold로 거르고 학생 상태는 안 본다 → 학생목록엔 휴원인 아이가
  //    출석부엔 그대로 떴다). 화면(학생 상세 '수업' 탭)도 같은 이유를 보여주지만, **게이트는 여기다**(#77).
  const blocked = enrollmentAssignBlockReason(stu.status as string | null);
  if (blocked) return { error: blocked };

  // 수업의 운영 요일 — 선택값을 그 안으로 좁히고, "전 요일 선택"이면 []로 정규화(분리등원 아님).
  const attendanceDays = await normalizeAttendanceDays(supabase, classId, pickedDays);

  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      tenant_id: user.tenantId,
      student_id: studentId,
      class_id: classId,
      start_date: startDate,
      end_date: endDate,
      attendance_days: attendanceDays,
    })
    .select("id")
    .single();

  if (error || !data) {
    // 같은 학생·같은 반 기간 겹침(GiST) — 어느 수강과 겹쳤는지까지 알려준다.
    if (isOverlapConflict(error)) {
      return { error: await describeOverlapConflict(supabase, studentId, classId, startDate, endDate) };
    }
    return { error: toKoreanDbError(error, "수강 배정에 실패했습니다. 잠시 후 다시 시도해 주세요.") };
  }

  // 담당 강사(반 담임)에게 인앱 알림 — best-effort(실패해도 배정은 성공).
  await notifyClassAssignment({
    tenantId: user.tenantId,
    actorId: user.id,
    assignments: [{ classId, studentId }],
    type: "enrollment_assigned",
  });

  // 수강을 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18 "모든 행동에 기록" — CLAUDE.md 결정).
  await logAction({
    action: "enrollment_assign",
    targetType: "student",
    metadata: { studentId, classId, startDate, days: attendanceDays },
  });

  revalidatePath("/timetable");
  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/classes/${classId}`);
  return { enrollmentId: data.id };
}

// (제거 2026-08-18, 적대 리뷰 M2) 단건 moveEnrollment는 UI 호출처 0곳인 죽은 코드였고, RPC 0027h 규약
// (옛 수강 end = 새 수강 start)과 달리 end=오늘 고정이라 미래 시작일로 부르면 이동 전 기간 무적(無籍)이
// 된다. 실이동은 전부 moveEnrollmentsBatch(RPC)를 쓴다 — 단건이 필요해지면 batch에 1건을 넘길 것.

export type BatchMoveInput = {
  enrollmentId: string;
  newClassId: string;
  startDate?: string;
  /** 목적지 등원 요일(분리등원) — 요일 존 드롭=[그 요일], 공통 존=[](전 요일). 비면 전 요일 등원. */
  attendanceDays?: string[];
};
export type BatchMoveResult = {
  enrollmentId: string;
  ok: boolean;
  error?: string;
};
export type MoveEnrollmentsBatchState = {
  error?: string;
  results?: BatchMoveResult[];
};

/**
 * 편집 모드 '저장' — 보류 이동들을 한 번에 커밋. 압축은 클라(compressMoves)에서 끝낸 결과를 받는다.
 * move_enrollments_batch RPC(SECURITY INVOKER + per-move 서브트랜잭션)로 RLS 유지 + 원자성 확보.
 * 1건이 GiST 시간겹침 등으로 실패해도 나머지는 커밋되고, 실패 목록을 results로 돌려준다.
 */
export async function moveEnrollmentsBatch(
  moves: BatchMoveInput[],
  /** 적용일(YYYY-MM-DD) — 미래 주 편집 시 그 주 월요일. 미지정/오늘이면 즉시 이동. (Phase B 주간 이동) */
  effectiveDate?: string,
): Promise<MoveEnrollmentsBatchState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 시간표 '편집'(드래그 반 이동)이 실제로 쓰는 자리 — 화면에서 버튼만 감추면 우회가 남는다(#77).
  if (!(await canManageTenant(user.systemRole, "classes"))) {
    return { error: "반 이동은 관리자만 할 수 있습니다" };
  }
  if (!Array.isArray(moves) || moves.length === 0) return { results: [] };

  const eff =
    effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? effectiveDate : null;
  // ⚠️ 과거 적용일 거부 — RPC는 이 값을 **옛 수강의 end_date와 새 수강의 start_date에 그대로** 쓰므로,
  // 과거 날짜를 넣으면 이미 지난 출결·청구 구간을 소급 조작한다. 클라 `min={dateFloor}`는 UI일 뿐
  // 게이트가 아니다(#77 — 화면에서만 잠근 것은 잠근 게 아니다). 2026-07-17 적대 감사 F6.
  if (eff && eff < kstToday()) return { error: "적용일은 오늘 이후여야 합니다" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("move_enrollments_batch", {
    p_moves: moves.map((m) => ({
      enrollmentId: m.enrollmentId,
      newClassId: m.newClassId,
      startDate: m.startDate ?? null,
      // 유효 요일코드만(mon..sun) 요일순 — 목적지 반 스케줄 밖 요일은 표시가 알아서 걸러지므로 서버 정규화는 최소.
      attendanceDays: DAY_ORDER.filter((d) => (m.attendanceDays ?? []).includes(d)),
    })),
    p_effective_date: eff,
  });

  if (error) return { error: toKoreanDbError(error, "반 이동을 저장하지 못했습니다") };

  const results = (data ?? []) as BatchMoveResult[];

  // 목적지 반 담임에게 전입 알림 — 성공한 이동만. 학생 id는 이동한 (구)enrollment 행에서 조회
  // (RPC 결과엔 enrollmentId만 있고 studentId·newClassId는 입력 moves에 있음). best-effort.
  const okIds = new Set(results.filter((r) => r.ok).map((r) => r.enrollmentId));
  const okMoves = moves.filter((m) => okIds.has(m.enrollmentId));
  if (okMoves.length > 0) {
    const { data: enrRows } = await supabase
      .from("enrollments")
      .select("id, student_id")
      .in(
        "id",
        okMoves.map((m) => m.enrollmentId),
      );
    const studentByEnrollment = new Map((enrRows ?? []).map((e) => [e.id, e.student_id as string]));
    const assignments = okMoves
      .map((m) => ({ classId: m.newClassId, studentId: studentByEnrollment.get(m.enrollmentId) }))
      .filter((a): a is { classId: string; studentId: string } => !!a.studentId && !!a.classId);
    await notifyClassAssignment({
      tenantId: user.tenantId,
      actorId: user.id,
      assignments,
      type: "enrollment_transferred_in",
    });

    await logAction({
      action: "enrollment_move_batch",
      targetType: "student",
      metadata: {
        count: okMoves.length,
        effectiveDate: eff,
        // studentIds — 감사로그 이름 검색의 선해석(metadata->studentIds cs 매치)이 이 행을 찾으려면 필수(적대 리뷰 L3).
        studentIds: [...new Set(okMoves.map((m) => studentByEnrollment.get(m.enrollmentId)).filter(Boolean))],
        moves: okMoves.map((m) => ({
          enrollmentId: m.enrollmentId,
          newClassId: m.newClassId,
          studentId: studentByEnrollment.get(m.enrollmentId) ?? null,
        })),
      },
    });
  }

  revalidatePath("/timetable");
  return { results };
}

export type AttendanceEdit = { enrollmentId: string; days: string[] };

/**
 * 같은 반 등원 요일 편집(2일↔1일) 일괄 반영 — 반 이동이 아니라 **기존 enrollment의 attendance_days만 갱신**.
 * (반 이동처럼 종료+신규 생성/전입 플래그를 붙이면 초록 전입색·'반 이동' 사유가 잘못 붙는다.)
 * RLS(tenant_isolation)로 본 테넌트 enrollment만 갱신. days=[]는 전 요일 등원(분리 해제).
 * ⚠️ 셀 단위 편집이라 그 셀이 덮는 요일만 담긴다 — 한 반이 여러 셀에 걸치면 편집은 그 셀 요일 기준(v1 한계).
 */
export async function updateEnrollmentsAttendanceBatch(
  edits: AttendanceEdit[],
): Promise<{ error?: string; count?: number }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 시간표 '편집'의 요일 존 드래그가 쓰는 자리 — 임의 enrollment의 등원 요일을 바꾸므로 관리자만
  // (canWriteTenant는 scoped 강사도 통과, 강사=학생 기록 열람 전용 — 적대 리뷰 F2와 같은 축).
  if (!(await canManageTenant(user.systemRole, "classes"))) return { error: "등원 요일 편집은 관리자만 할 수 있습니다" };
  if (!Array.isArray(edits) || edits.length === 0) return { count: 0 };

  const supabase = await createClient();
  // 적용된 편집을 모아 두고 — 중간 실패로 빠져나가도 **이미 반영된 것까지는** 감사로그에 남긴다(적대 리뷰 M3).
  // 기록값은 클라 원본이 아니라 실제 저장된 정규화 요일(L2) + 학생 id(이름 검색 선해석용, L3).
  const applied: Array<{ enrollmentId: string; days: string[]; studentId: string | null }> = [];
  const writeDaysLog = () =>
    applied.length === 0
      ? Promise.resolve()
      : logAction({
          action: "enrollment_days_update",
          targetType: "student",
          metadata: {
            count: applied.length,
            studentIds: [...new Set(applied.map((a) => a.studentId).filter(Boolean))],
            edits: applied.map((a) => ({ enrollmentId: a.enrollmentId, days: a.days })),
          },
        });
  for (const e of edits) {
    const enrollmentId = String(e?.enrollmentId ?? "").trim();
    if (!enrollmentId) continue;
    const days = DAY_ORDER.filter((d) => (e.days ?? []).includes(d)); // 유효 요일코드만·요일순
    const { data: row, error } = await supabase
      .from("enrollments")
      .update({ attendance_days: days })
      .eq("id", enrollmentId)
      .select("student_id")
      .maybeSingle();
    if (error) {
      await writeDaysLog();
      return { error: toKoreanDbError(error, "등원 요일을 저장하지 못했습니다"), count: applied.length };
    }
    // row=null이면 매치 0행(남의 테넌트·삭제된 수강) = 아무것도 안 바뀜 — 기록·카운트에서 제외.
    if (row) applied.push({ enrollmentId, days, studentId: (row.student_id as string | null) ?? null });
  }
  await writeDaysLog();
  revalidatePath("/timetable");
  return { count: applied.length };
}

/**
 * 새 기간 밖으로 밀려나는 출결을 **센다**(행은 안 받는다, B2 — `count:"exact"` + `limit(1)`).
 * `limit(1)`로 받는 한 행은 문구에 적을 **가장 최근 날짜** 하나뿐이다.
 *
 * ⚠️ 조회가 실패하면 `null`을 돌려 **확인을 건너뛴다**(저장은 막지 않는다). 못 셌다는 이유로
 *    정정을 봉쇄하면 정작 고치러 온 사람이 손을 묶인다 — 이 확인은 안전벨트지 자물쇠가 아니다
 *    (판정 실패 시 fail-open은 삭제 가드와 반대 방향인데, 그쪽은 **되돌릴 수 없는** 삭제고
 *     이쪽은 날짜를 다시 고치면 그만이라 위험의 크기가 다르다).
 */
async function countAttendanceOutside(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { studentId: string; classId: string; ranges: ExcludedRange[] },
): Promise<AttendanceShrink | null> {
  if (args.ranges.length === 0) return null;

  // 구간은 한 번의 편집에서 0~1개다(date-edit.ts 주석) — 그래도 전부 세고 합친다. 서로 독립이라 병렬(B4).
  const results = await Promise.all(
    args.ranges.map(async (r) => {
      let q = supabase
        .from("attendance_records")
        .select("session_date", { count: "exact" })
        .eq("student_id", args.studentId)
        .eq("class_id", args.classId)
        .gte("session_date", r.from);
      if (r.to !== null) q = q.lte("session_date", r.to);
      const { data, count, error } = await q
        .order("session_date", { ascending: false })
        .limit(1);
      if (error) {
        console.error("[enrollments] 기간 밖 출결 확인 실패:", error.message);
        return null;
      }
      const last = (data ?? [])[0]?.session_date as string | undefined;
      return { count: count ?? 0, lastDate: last ?? null };
    }),
  );

  // 한 구간이라도 못 셌으면 숫자가 거짓이 된다 — 통째로 포기하고 확인을 건너뛴다.
  if (results.some((r) => r === null)) return null;
  const rows = results as { count: number; lastDate: string | null }[];
  const count = rows.reduce((acc, r) => acc + r.count, 0);
  const lastDate = rows.reduce<string | null>(
    (acc, r) => (r.lastDate && (!acc || r.lastDate > acc) ? r.lastDate : acc),
    null,
  );
  // count>0인데 날짜가 없을 수는 없지만(같은 쿼리의 결과다), 그때는 확인을 건너뛴다 —
  // 문구에 "마지막 —"이라고 적느니 안 묻는 게 낫다.
  return count > 0 && lastDate ? { count, lastDate } : null;
}

/**
 * 확인이 필요할 때 화면에 돌려주는 재료 — 저장은 **아직 일어나지 않았다**.
 * ⚠️ `value`를 함께 돌려주는 건 React 19가 제출 때마다 폼을 리셋해([[#83]]) 사용자가 고른 날짜가
 *    입력칸에서 사라지기 때문이다. 화면은 이 값을 들고 확인 버튼을 그린다.
 */
export type EnrollmentDateConfirm = {
  token: string;
  /** 걸린 위험에 맞춘 제목 — 화면이 고정 문구를 쓰면 위험 조합에 따라 거짓이 된다. */
  title: string;
  message: string;
  field: EnrollmentDateField;
  value: string | null;
};

export type UpdateEnrollmentDatesState =
  | { ok?: boolean; error?: string; confirm?: EnrollmentDateConfirm }
  | undefined;

/**
 * 수강 시작/종료일 직접 수정 (관리자 정정). owner(원장) 콘솔 권한 이상만(master).
 * enrollments는 시간 구간(temporal) 테이블이라 날짜 변경이 타임머신·시간표에 그대로 반영된다.
 * GiST EXCLUDE(enrollments_no_overlap = 같은 학생+같은 반 기간 겹침)에 걸리면 친절 메시지로 거부.
 *
 * 🔴 **조용히 깨지는 것이 있으면 한 번 더 묻는다**(2026-09-10) — ① 이미 찍힌 출결이 새 기간 밖으로
 *    밀려나거나 ② 반이동 짝의 기준일이 움직이는 경우. 막지 않는 이유와 "왜 확인인가"는
 *    [`date-edit.ts`](../date-edit.ts) 머리 주석이 단일 소스다. 확인의 게이트는 **여기**다([[#77]]):
 *    매번 다시 계산해 클라가 돌려준 서명과 정확히 같을 때만 통과시킨다.
 */
export async function updateEnrollmentDates(
  _prev: UpdateEnrollmentDatesState,
  formData: FormData,
): Promise<UpdateEnrollmentDatesState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // owner(원장) 콘솔 권한 이상만 — 날짜 정정은 수강 이력을 다시 쓰는 민감 작업이라 최상위로 제한.
  if ((await accessLevelTenant(user.systemRole, "owner")) !== "full") {
    return { error: "날짜 수정 권한이 없습니다 (원장 전용)" };
  }

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim(); // "start" | "end"
  const raw = String(formData.get("value") ?? "").trim();
  // 화면이 확인창에서 돌려보낸 서명. 없으면 빈 문자열이라 아래 비교에서 자연히 걸린다.
  const confirmed = String(formData.get("confirm") ?? "").trim();

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };
  if (field !== "start" && field !== "end") return { error: "잘못된 필드입니다" };

  const value = raw || null;

  const supabase = await createClient();
  const { data: current, error: fetchErr } = await supabase
    .from("enrollments")
    .select("start_date, end_date, student_id, class_id, is_transferred, is_transferred_in")
    .eq("id", enrollmentId)
    .single();
  if (fetchErr || !current) return { error: "수강 정보를 찾을 수 없습니다" };

  // 형식·시작≤종료 검증은 순수 함수 한 곳에서(Vitest로 잠금) — 문구는 종전 그대로다.
  const prevWindow: EnrollmentWindow & { isTransferredIn: boolean } = {
    startDate: current.start_date as string,
    endDate: (current.end_date as string | null) ?? null,
    isTransferred: (current.is_transferred as boolean | null) ?? false,
    isTransferredIn: (current.is_transferred_in as boolean | null) ?? false,
  };
  const invalid = enrollmentDateEditError(field, value, prevWindow);
  if (invalid) return { error: invalid };

  const nextWindow = applyDateEdit(prevWindow, field, value);
  const nextStart = nextWindow.startDate;
  const nextEnd = nextWindow.endDate;

  // ── 저장하면 조용히 깨지는 것들을 모아 한 번에 묻는다(둘 다면 문장이 둘). ─────────────────
  // ① 이번 편집이 **새로** 기간 밖으로 밀어내는 출결. 넓히는 편집은 구간이 비어 조회조차 안 한다(왕복 0).
  const shrink = await countAttendanceOutside(supabase, {
    studentId: current.student_id as string,
    classId: current.class_id as string,
    ranges: newlyExcludedAttendanceRanges(prevWindow, nextWindow),
  });
  const risks: DateEditRisk[] = [];
  if (shrink) risks.push({ kind: "attendanceOutside", shrink });
  // ② 아직 오지 않은 반이동 짝의 기준일을 옮기는가(순수 판정 — 조회 없음).
  //    오늘은 서버(KST)가 정한다 — 클라 시계를 믿으면 타임존이 어긋나 경고가 하루씩 밀린다.
  const pair = transferPairRisk(prevWindow, field, value, kstToday());
  if (pair) risks.push(pair);

  if (risks.length > 0) {
    const token = dateEditConfirmToken(enrollmentId, field, value, risks);
    // 🔴 서명이 정확히 같을 때만 통과 — 확인창을 띄운 뒤 사실이 바뀌면 새 내용으로 다시 묻는다.
    if (confirmed !== token) {
      return {
        confirm: {
          token,
          // 제목도 서버가 정한다 — 화면이 "출결이…"로 고정하면 짝만 걸린 편집에서 거짓말이 된다.
          title: dateEditConfirmTitle(risks),
          message: dateEditConfirmMessage(field, value, risks),
          field,
          value,
        },
      };
    }
  }

  /**
   * 종료를 비우면(null) 재원중 복귀 = `withdrawal_reason`도 해제.
   *
   * 🔴 **`is_transferred`도 함께 푼다**(2026-09-10 적대 리뷰). 정본인 이동 취소
   *    ([`cancelScheduledEnrollment`](./scheduled-actions.ts))가 세 필드를 같이 되돌리는데 여기만
   *    표식을 남기고 있었다. 남기면 두 가지가 조용히 깨진다:
   *      ① 전출 행을 되살리면 도착지 수강은 그대로라 학생이 **두 반 명단에 동시에** 선다
   *         (GiST는 `(학생, 반)` 축이라 다른 반은 안 막는다).
   *      ② 그 상태에서 옆의 '수강 종료 · 오늘까지'를 누르면 종료 규약이 **배타**로 읽혀
   *         (`isEnrollmentEndedOn(오늘, 오늘, true)` = true) 버튼이 약속한 *"내일부터 빠집니다"*가
   *         그 자리에서 거짓이 된다.
   *    되살린 수강은 더 이상 "이동으로 끝난 수강"이 아니므로 표식을 지우는 것이 사실에도 맞다.
   */
  const patch: {
    start_date?: string;
    end_date?: string | null;
    withdrawal_reason?: string | null;
    is_transferred?: boolean;
  } =
    field === "start"
      ? { start_date: value as string }
      : value
        ? { end_date: value }
        : { end_date: null, withdrawal_reason: null, is_transferred: false };

  const { error } = await supabase.from("enrollments").update(patch).eq("id", enrollmentId);
  if (error) {
    if (isOverlapConflict(error)) {
      return {
        error: await describeOverlapConflict(
          supabase,
          current.student_id as string,
          current.class_id as string,
          nextStart,
          nextEnd,
          enrollmentId,
        ),
      };
    }
    return { error: toKoreanDbError(error, "날짜를 저장하지 못했습니다") };
  }

  await logAction({
    action: "enrollment_dates_update",
    targetType: "student",
    metadata: {
      studentId: current.student_id,
      classId: current.class_id,
      field,
      from: field === "start" ? current.start_date : current.end_date,
      to: value,
      // 🔴 "깨지는 걸 알고도 저장했다"는 사실을 남긴다 — 나중에 "왜 이 학생이 그날 명단에 없지",
      //    "왜 이동이 종료로 뜨지"를 되짚을 때 이게 유일한 흔적이다(원장 규약: 변동은 모두 감사로그).
      ...(shrink ? { attendanceOutside: shrink.count, attendanceOutsideLast: shrink.lastDate } : {}),
      ...(pair ? { transferPairBroken: pair.anchor } : {}),
    },
  });

  revalidatePath("/timetable");
  revalidatePath(`/students/${current.student_id}`);
  revalidatePath(`/classes/${current.class_id}`);
  return { ok: true };
}

// ─────────────────────── 잘못 만든 수업 이력 삭제(원장·super_admin) ───────────────────────

export type DeleteEnrollmentState = { error?: string; ok?: true } | undefined;

/** 삭제 확인 조회가 하나라도 실패하면 **막는다** — "못 셌으니 없나 보다"로 지우면 되돌릴 수 없다. */
const DELETE_PROBE_FAILED =
  "남은 기록을 확인하지 못해 삭제를 중단했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * 그 (학생, 반) 조합에 붙은 기록 수를 센다 — 표 목록·판정 근거는 [`deletable.ts`](../deletable.ts) 주석 참조.
 * 전부 `count: "exact", head: true`(행을 안 받는다, B2). 하나라도 error면 null을 돌려 **삭제를 막는다.**
 *
 * 🔴 **세는 조회만 admin 클라이언트**(RLS 우회) + `tenant_id` 명시 필터로 한다. 이유:
 *   · `class_sheet_student_marks`는 **RLS enabled에 정책이 0개**라 세션 클라이언트로는 누가 읽어도
 *     **에러 없이 0행**이다([[#104]]) — 그대로 두면 영어 시트 기록이 있어도 가드가 "없다"고 거짓말한다.
 *   · `invoices`·`invoice_*`는 역할 게이트(0158a·0165a)가 걸려 있어 **읽는 사람에 따라 0**이 될 수 있다.
 *  가드는 **적게 세는 쪽이 곧 사고**(지우면 안 될 것을 지운다)라, 여기서만 RLS를 우회한다.
 * ⚠️ 우회는 **세는 데까지**다 — 실제 삭제는 세션 클라이언트로 한다(권한은 RLS도 함께 지킨다).
 * ⚠️ admin은 테넌트 격리가 없다 → 모든 조회에 `.eq("tenant_id", tenantId)` 필수.
 */
async function countEnrollmentRecords(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  studentId: string,
  classId: string,
): Promise<EnrollmentRecordCounts | null> {
  const headCount = async (
    table: string,
    apply: (
      q: ReturnType<ReturnType<typeof createAdminClient>["from"]>,
    ) => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ): Promise<number | null> => {
    const { count, error } = await apply(admin.from(table));
    if (error) {
      console.error(`[enrollments] 삭제 전 기록 확인 실패(${table}):`, error.message);
      return null;
    }
    return count ?? 0;
  };

  // 청구 계열은 학생과 반이 **다른 표에 나뉘어** 있다 — 그 학생의 invoice id를 먼저 모은 뒤 반 조건으로 센다.
  // id 배열은 whitelist라 페이지네이션(B2) + `.in()`은 100개 청크(B3).
  const countBilling = async (): Promise<number | null> => {
    try {
      const invoices = await fetchAllPaged<{ id: string }>((from, to) =>
        admin
          .from("invoices")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("student_id", studentId)
          .order("id")
          .range(from, to),
      );
      if (invoices.length === 0) return 0;
      const ids = invoices.map((r) => r.id);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
      let total = 0;
      for (const table of ["invoice_session_terms", "invoice_teacher_splits"]) {
        for (const chunk of chunks) {
          const { count, error } = await admin
            .from(table)
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("class_id", classId)
            .in("invoice_id", chunk);
          if (error) {
            console.error(`[enrollments] 삭제 전 청구 확인 실패(${table}):`, error.message);
            return null;
          }
          total += count ?? 0;
        }
      }
      return total;
    } catch (e) {
      console.error("[enrollments] 삭제 전 청구 확인 실패:", e);
      return null;
    }
  };

  const [attendance, lessonReports, onescreenSessions, sheetMarks, followups, billing] =
    await Promise.all([
      headCount("attendance_records", (q) =>
        q
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("student_id", studentId)
          .eq("class_id", classId),
      ),
      // 수업보고서는 정규 반(class_id)과 **보강 반**(makeup_class_id, 0171a) 둘 다 이 반을 가리킬 수 있다.
      headCount("lesson_reports", (q) =>
        q
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("student_id", studentId)
          .or(`class_id.eq.${classId},makeup_class_id.eq.${classId}`),
      ),
      headCount("onescreen_daily_sessions", (q) =>
        q
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("student_id", studentId)
          .eq("class_id", classId),
      ),
      headCount("class_sheet_student_marks", (q) =>
        q
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("student_id", studentId)
          .eq("class_id", classId),
      ),
      headCount("attendance_followups", (q) =>
        q
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("student_id", studentId)
          .eq("class_id", classId),
      ),
      countBilling(),
    ]);

  if (
    attendance === null ||
    lessonReports === null ||
    onescreenSessions === null ||
    sheetMarks === null ||
    followups === null ||
    billing === null
  ) {
    return null;
  }
  return { attendance, lessonReports, onescreenSessions, sheetMarks, followups, billing };
}

/**
 * **잘못 만든 수업 이력(enrollments 행) 삭제** — 원장(owner 콘솔 full) + super_admin 전용.
 *
 * 원장 2026-08-20: *"이런 잘못된 수업 이력을 지우고 싶은데 마스터 및 원장에게 권한부여"* →
 * *"지우는건 안되네 이미 추가된 기록에 대해"* → *"대신 감사 로그에는 남겨"*.
 *
 * 🔴 **붙은 기록이 있으면 거절**한다(무엇이 몇 건인지 + 대안까지 말한다) — 판정은 순수 함수
 *    [`enrollmentDeleteBlockReason`](../deletable.ts) 단일 소스. 세는 표 목록과 "형제 수강" 규칙은
 *    그 파일 주석에 있다(짐작이 아니라 schema.ts + migrations 전수 스캔 결과).
 * 🔴 **감사로그에 행을 통째로 스냅샷**한다 — 행이 사라지면 그게 유일한 흔적이라, 나중에 손으로
 *    복구할 수 있을 만큼 담는다.
 * ⚠️ RLS를 우회하지 않는다(세션 클라이언트). 테넌트는 명시적으로 한 번 더 확인한다.
 */
export async function deleteEnrollment(
  _prev: DeleteEnrollmentState,
  formData: FormData,
): Promise<DeleteEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  // 🔴 super_admin은 새로 만드는 어떤 게이트도 **항상 통과**한다(원장 2026-08-13 결정).
  //    나머지는 owner(원장) 콘솔 권한 = full — 수강 날짜 정정(updateEnrollmentDates)과 같은 자물쇠다.
  //    화면도 같은 판정으로 버튼을 감추지만 화면 조건은 게이트가 아니다(#77 — 여기가 진짜 게이트).
  const ownerLevel =
    (await isCurrentUserSuperAdmin()) ||
    (await accessLevelTenant(user.systemRole, "owner")) === "full";
  // **배정 취소** 경로(원장 2026-09-01: *"대기학생은 '수강 종료' 대신 '배정 취소'… 아무일도 없던것처럼"*) —
  // 아직 **시작도 안 한** 배정은 배정을 만들 수 있는 사람(students full = 사무실)이 되돌릴 수 있다.
  // 🔴 넓히는 범위를 좁게 못박는다: 아래에서 `start_date > 오늘`을 **다시 확인**하고, 붙은 기록이 있으면
  //    공통 판정(enrollmentDeleteBlockReason)이 그대로 거절한다. 시작한 수강 삭제는 여전히 원장 전용이다.
  const assignLevel = await canManageTenant(user.systemRole, "students");
  if (!ownerLevel && !assignLevel) return { error: "수업 이력 삭제 권한이 없습니다 (원장 전용)" };

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();

  // 지울 행 전체를 먼저 읽는다 — 판정 재료 + 감사로그 스냅샷(행이 사라지면 이게 유일한 흔적).
  const { data: enr, error: selErr } = await supabase
    .from("enrollments")
    .select(
      `id, tenant_id, student_id, class_id, start_date, end_date, on_hold, withdrawal_reason,
       attendance_days, is_transferred, is_transferred_in, salary_tier, created_at`,
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (selErr) return { error: toKoreanDbError(selErr, "수강 정보를 불러오지 못했습니다") };
  if (!enr) return { error: "수강 정보를 찾을 수 없습니다" };
  // RLS가 이미 테넌트로 좁히지만, 파괴적 작업이라 명시적으로 한 번 더 본다.
  if (enr.tenant_id !== user.tenantId) return { error: "수강 정보를 찾을 수 없습니다" };

  const studentId = enr.student_id as string;
  const classId = enr.class_id as string;

  // 🔴 배정 취소 경로의 **진짜 자물쇠** — 원장이 아니면 **아직 시작 안 한 배정만** 지울 수 있다.
  //    (화면은 '예정' 줄에만 버튼을 그리지만 화면 조건은 게이트가 아니다 — #77.)
  //    시작한 수강은 되돌리는 게 아니라 끝내는 것이라 '수강 종료'로 보낸다(대안을 말해 준다).
  if (!ownerLevel && !(String(enr.start_date) > kstToday())) {
    return {
      error: "이미 시작한 수강은 삭제할 수 없습니다 — 다니던 수업은 '수강 종료'로 끝내주세요(기록은 남습니다).",
    };
  }

  // 반 이름(스냅샷용) + 같은 (학생,반)의 다른 수강 + 붙은 기록 수. 서로 독립이라 병렬(B4).
  // 🔴 형제 수강은 **개수만이 아니라 `salary_tier`까지** 읽는다 — 정산 매핑(collectTierRows)이 티어가
  //    지정된 행에서만 만들어져서, 티어를 가진 유일한 행을 지우면 정산액이 조용히 줄어든다(deletable.ts 주석).
  //    head 카운트로 되돌리면 그 구멍이 다시 열린다.
  const [klassRes, siblingRes, counts] = await Promise.all([
    supabase.from("classes").select("class_name, subject").eq("id", classId).maybeSingle(),
    supabase
      .from("enrollments")
      .select("id, salary_tier")
      .eq("student_id", studentId)
      .eq("class_id", classId)
      .neq("id", enrollmentId)
      .limit(200),
    countEnrollmentRecords(createAdminClient(), user.tenantId, studentId, classId),
  ]);

  if (siblingRes.error) return { error: DELETE_PROBE_FAILED };
  if (!counts) return { error: DELETE_PROBE_FAILED };

  const siblings = siblingRes.data ?? [];
  const hadSibling = siblings.length > 0;
  const siblingHasTier = siblings.some((r) => !!r.salary_tier);
  const thisRowHasTier = !!enr.salary_tier;
  const blocked = enrollmentDeleteBlockReason({
    counts,
    hasSiblingEnrollment: hadSibling,
    thisRowHasTier,
    siblingHasTier,
  });
  if (blocked) return { error: blocked };

  // 실제로 지워진 행을 확인한다 — RLS가 막으면 error 없이 0행이라 "성공"으로 위장한다([[#104]] 계열).
  const { data: deleted, error: delErr } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollmentId)
    .select("id");
  if (delErr) return { error: toKoreanDbError(delErr, "수업 이력을 삭제하지 못했습니다") };
  if (!deleted || deleted.length === 0) {
    return { error: "수업 이력을 삭제할 권한이 없거나 이미 삭제된 행입니다" };
  }

  // 🔴 원장 지시("대신 감사 로그에는 남겨") — 지운 행을 통째로. 손으로 되살릴 수 있을 만큼 담는다.
  await logAction({
    action: "enrollment_delete",
    targetType: "student",
    targetLabel: (klassRes.data?.class_name as string | null) ?? null,
    metadata: {
      studentId,
      classId,
      className: (klassRes.data?.class_name as string | null) ?? null,
      subject: (klassRes.data?.subject as string | null) ?? null,
      // 삭제된 행 스냅샷(복구용 원본 값).
      snapshot: {
        id: enr.id,
        tenantId: enr.tenant_id,
        studentId,
        classId,
        startDate: enr.start_date,
        endDate: enr.end_date,
        onHold: enr.on_hold,
        withdrawalReason: enr.withdrawal_reason,
        attendanceDays: enr.attendance_days,
        isTransferred: enr.is_transferred,
        isTransferredIn: enr.is_transferred_in,
        salaryTier: enr.salary_tier,
        createdAt: enr.created_at,
      },
      // 지울 때 붙어 있던 기록 수(0이 아니면 형제 수강이 있어 허용된 것) — 사후 역검수 재료.
      recordCounts: counts,
      // '배정 취소'(아직 시작 전)로 지운 것인가 — 원장이 아닌 사람이 지울 수 있는 유일한 경우라
      // 역검수에서 이 표식으로 두 경로를 가른다(감사로그가 유일한 흔적이다).
      cancelledBeforeStart: String(enr.start_date) > kstToday(),
      hadSiblingEnrollment: hadSibling,
      // 급여 단가(티어) 판정 근거 — 정산이 줄었다는 제보가 오면 여기부터 본다.
      thisRowHasTier,
      siblingHasTier,
    },
  });

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/timetable");
  return { ok: true };
}
