"use server";
import { canManageAdministrativeStudentStatusNow } from "@/features/students/server/status-access";
import { STUDENT_STATUS_DENIED } from "@/features/students/status-access";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { mergeNoteFor } from "@/features/students/status/merged";
import { CLEANUP_WITHDRAWAL_MEMO } from "@/features/withdrawals/system-bulk";
import { canRequestReport, missingReportSchema, type WithdrawalReport } from "@/features/withdrawal-reports/model";
import { applyDirectNow } from "@/features/withdrawal-reports/server/direct-apply";
import { REFUND_GATE_NOT_READY, refundGateReady } from "@/features/withdrawal-reports/server/refund-check";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { MERGE_TABLES } from "../merge-scope";
import { planMakeeduCarry } from "../makeedu-carry";
import { createAdminClient } from "@/lib/supabase/admin";
import { moveCareToKeeperStudent } from "@/features/student-care/server/merge-move";

/** `warning` = 병합은 끝났지만 마무리 한 가지가 남았을 때(화면이 그대로 보여 준다). */
export type MergeStudentsState =
  | { error?: string; mergedRows?: number; warning?: string }
  | undefined;

/**
 * DB가 그 문장을 **거절했다고 알려 준** 오류인가(오류 코드가 있다) — 그러면 그 문장은 적용되지 않았다.
 * 코드가 없으면(응답을 받지 못함 · 중간 장비의 오류) **적용됐는지 모른다** — 쓰기가 DB에서 끝난 뒤 응답만 끊길 수 있다.
 * 🔴 모든 오류를 "적용 안 됨"으로 치지 말 것 — 그러면 실제로는 바뀐 기록을 "바뀐 것이 없다"고 답하고 기록도 남기지 않는다.
 */
function isRejectedByDb(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.length > 0;
}

/**
 * 두 학생 병합. keeperId가 살아남고, mergeeId의 기록을 keeperId로 옮긴다.
 * 옮기는 표 = [`MERGE_TABLES`](../merge-scope.ts)(화면 안내와 같은 목록 — 그 밖의 기록은 옮기지 않는다).
 * mergee는 soft delete (status='withdrawn' + withdrawn_at=today + 메모로 마킹).
 * 🔴 표를 하나씩 옮긴다(한 번에 묶는 트랜잭션이 아니다) — 중간에 멈추면 **앞 단계는 이미 옮겨진 채**다.
 *    그래서 멈춘 자리와 그때까지 옮긴 범위를 감사로그에 남기고, 화면에도 그렇게 알린다(같은 두 학생을 다시 병합하면 이어진다).
 * 🔴 "오류가 없었다"를 "옮겨졌다"로 읽지 않는다 — 권한(RLS)이 막은 쓰기는 **오류 없이 0건**으로 끝난다. 옮길 건수를 먼저 세어
 *    실제로 옮겨진 건수와 견주고, 진 쪽의 퇴원 처리는 실제로 한 줄이 바뀌었는지 확인한다. 모자라면 완료로 답하지 않는다.
 * ⚠️ 이 계정에게 **보이지 않는** 기록(조회 권한이 없는 표)은 셀 수 없다 — 그런 기록은 옮기지도 못하고 남는다(알려진 한계).
 */
export async function mergeStudents(
  _prev: MergeStudentsState,
  formData: FormData,
): Promise<MergeStudentsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageAdministrativeStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const keeperId = String(formData.get("keeperId") ?? "").trim();
  const mergeeId = String(formData.get("mergeeId") ?? "").trim();
  if (!keeperId || !mergeeId || keeperId === mergeeId) {
    return { error: "유효한 두 학생을 선택해주세요" };
  }

  const supabase = await createClient();
  let mergedRows = 0;
  /** 표별로 옮긴 건수 — 중간에 멈췄을 때 "어디까지 옮겨졌나"의 기록. */
  const moved: Record<string, number> = {};

  // 감사 기록용 이름 선조회 — mergee는 곧 퇴원 마킹되므로 병합 시점 이름을 보존한다.
  // ⚠️ `notes`도 함께 받는다 — 진 쪽 메모를 **덮어쓰지 않고 앞에 표식만 덧붙이기** 위해서다(아래).
  const { data: pairNames, error: pairError } = await supabase
    .from("students")
    .select("id, name, notes, makeedu_id")
    .in("id", [keeperId, mergeeId]);
  // 🔴 이 조회를 삼키면 안 된다 — 실패해도 아래가 그대로 진행돼 **보존하려던 바로 그 메모를 표식만으로
  //    덮어쓰고**(mergeeRow가 undefined) 감사로그 '대상' 칸도 빈다. 아직 한 줄도 안 썼으니 여기서 멈춘다.
  if (pairError) {
    return { error: explainDbError(pairError, { scope: "admin.mergeStudents.read", fallback: "학생을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }).message };
  }
  const mergeeRow = (pairNames ?? []).find((s) => s.id === mergeeId);
  const keeperRow = (pairNames ?? []).find((s) => s.id === keeperId);
  // 🔴 둘 다 실제로 있어야 시작한다 — 한쪽이 없는데(이미 지워짐·다른 지점) 진행하면 없는 학생 앞으로 기록을 옮기려다
  //    첫 표에서 멈추거나, 진 쪽이 없어 아무것도 안 옮긴 채 "0개 항목 이전 완료"라고 답한다.
  if (!mergeeRow || !keeperRow) return { error: "병합할 학생을 찾지 못했습니다. 새로고침한 뒤 다시 시도해 주세요." };
  const mergeeName = mergeeRow.name ?? null;
  const keeperName = keeperRow.name ?? null;
  // 메이크에듀 원생 번호 — 남는 쪽이 비어 있으면 옮긴다(2026-10-20 권민서·김지유: 병합이 번호를 버려 연결이 끊겼다).
  const makeeduCarry = planMakeeduCarry(keeperRow.makeedu_id as string | null, mergeeRow.makeedu_id as string | null);

  // 옮길 건수를 **쓰기 전에** 센다(행은 받지 않는다) — 실제로 옮겨진 건수와 견줄 기준이다. 서로 독립이라 한꺼번에.
  const remaining = (table: string) =>
    supabase.from(table).select("*", { count: "exact", head: true }).eq("student_id", mergeeId);
  const expectedCounts = await Promise.all(MERGE_TABLES.map(({ table }) => remaining(table)));
  const unreadable = expectedCounts.find((r) => r.error || typeof r.count !== "number");
  if (unreadable) {
    if (unreadable.error) logDbError(unreadable.error, "admin.mergeStudents.count");
    return { error: "옮길 기록을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요. 옮겨진 기록은 없습니다." };
  }

  /**
   * 중간에 멈춤 — 바뀐 것이 있거나 **바뀌었을 수 있으면** 그 범위와 멈춘 자리를 남기고 목록을 새로 읽게 한다.
   *  · `error` = DB가 돌려준 오류. 코드가 없으면(응답을 못 받음) 그 단계가 적용됐는지 모른다.
   *  · `short` = 오류는 없는데 옮겨야 할 건수보다 적게 바뀌었다(권한이 막았거나 그사이 바뀜).
   */
  const stop = async (step: string, cause: { error?: unknown; short?: { expected: number; done: number } }): Promise<MergeStudentsState> => {
    const uncertain = !!cause.error && !isRejectedByDb(cause.error);
    const info = cause.error
      ? explainDbError(cause.error, { scope: "admin.mergeStudents", fallback: "저장하지 못했습니다", context: { step } })
      : null;
    // 실제로 옮겨진 기록이 있거나, 이 단계가 적용됐는지 모를 때 남긴다(둘 다 아니면 바뀐 것이 없다).
    const changed = mergedRows > 0 || uncertain;
    if (changed) {
      await logAction({
        action: "student_merge",
        targetType: "student",
        targetLabel: keeperName,
        metadata: {
          studentId: keeperId, mergedStudentId: mergeeId, mergedName: mergeeName, mergedRows, moved,
          partial: true, failedStep: step, ...(uncertain ? { uncertain: true } : {}),
        },
      });
      revalidatePath("/owner");
      revalidatePath("/students");
    }
    if (uncertain) {
      return {
        error: `'${step}' 단계가 적용됐는지 확인하지 못했습니다(응답을 온전히 받지 못했습니다). 새로고침해 두 학생의 상태를 확인한 뒤, 중복 의심 목록에 남아 있으면 다시 병합해 주세요.`,
      };
    }
    const reason = cause.short
      ? `${cause.short.expected}건 가운데 ${cause.short.done}건만 바뀌었습니다(이 기록을 바꿀 권한이 없거나 그사이 바뀌었습니다)`
      : info!.message;
    return {
      error: mergedRows > 0
        ? `'${step}' 단계에서 멈췄습니다 — ${reason}. 앞 단계까지는 이미 옮겨졌습니다. 원인을 해결한 뒤 같은 두 학생을 다시 병합하면 이어집니다.`
        : `'${step}' 단계에서 멈췄습니다 — ${reason}. 옮겨진 기록은 없습니다.`,
    };
  };

  for (const [index, { table, label }] of MERGE_TABLES.entries()) {
    const expected = expectedCounts[index]!.count as number;
    moved[table] = 0;
    // 옮길 것이 없는 표에는 쓰지 않는다(쓰기는 적을수록 "적용됐는지 모르는" 자리가 준다).
    if (expected === 0) continue;
    const step = `${label} 기록 옮기기`;
    const { error, count } = await supabase
      .from(table)
      .update({ student_id: keeperId }, { count: "exact" })
      .eq("student_id", mergeeId);
    if (error) return stop(step, { error });
    // 🔴 건수를 못 받았으면(성공 응답인데 건수가 없다) **몇 건이 옮겨졌는지 모른다** — 적용 여부 미확인으로 멈춘다.
    //    남은 건수를 다시 세어 빼는 것으로는 알 수 없다: 그사이 다른 창이 진 쪽에 기록을 더하거나 빼면 그 차이가
    //    "이 요청이 옮긴 건수"가 아니게 되고, 실제로는 옮겨졌는데 0건으로 세어 "옮겨진 기록은 없습니다"라고 답하게 된다
    //    (적대 리뷰 3b B1). 코드 없는 오류로 넘겨 미확인 갈래를 탄다(남기고, 목록을 새로 읽게 한다).
    if (typeof count !== "number") return stop(step, { error: { message: "moved count unavailable" } });
    moved[table] = count;
    mergedRows += count;
    if (count < expected) return stop(step, { short: { expected, done: count } });
  }

  // 소개한 원생(0362a) — 진 쪽이 소개한 콜&상담의 연결도 남는 쪽으로(강사평가 원생 소개가 퇴원 처리된 쪽에서 담임을 못 찾아
  // 0건이 되지 않게). 보조 연결이라 실패해도 병합은 멈추지 않고 로그만 남긴다 · 칸이 없는 DB(적용 전)는 조용히 건너뛴다.
  // 옮길 것이 없으면 쓰지 않는다(위 표들과 같은 규칙). 한 줄만 읽어 본다 — 건수 조회(head)는 오류 문구가 비어 '칸 없음'을 못 가른다.
  const referrerProbe = await supabase.from("enrollment_consultations").select("id").eq("referrer_student_id", mergeeId).range(0, 0);
  const skipReferrer = (e: { message?: string } | null) => !e || /referrer_student_id/.test(e.message ?? "");
  if (referrerProbe.error && !skipReferrer(referrerProbe.error)) logDbError(referrerProbe.error, "admin.mergeStudents.referrer");
  if (!referrerProbe.error && referrerProbe.data?.length) {
    const referrerMove = await supabase.from("enrollment_consultations")
      .update({ referrer_student_id: keeperId }, { count: "exact" }).eq("referrer_student_id", mergeeId);
    if (referrerMove.error && !skipReferrer(referrerMove.error)) logDbError(referrerMove.error, "admin.mergeStudents.referrer");
    else if (referrerMove.count) moved["enrollment_consultations.referrer"] = referrerMove.count;
  }

  // 상담 약속·인계(s2_0028) — 진 쪽 학생의 약속도 남는 쪽으로. 약속 표는 서버 전용이라 위 표 목록(사용자 클라이언트)으로는 못 옮긴다.
  // 보조 이동이라 실패해도 병합은 멈추지 않고 로그만(표가 없는 DB는 조용히 0건).
  const careMoved = await moveCareToKeeperStudent(user.tenantId, mergeeId, keeperId);
  if (careMoved) moved["student_care_commitments"] = careMoved;

  // mergee soft delete — 🔴 실제로 한 줄이 바뀌었는지 본다(`.select`). 권한이 막으면 오류 없이 0줄이고,
  //    그걸 완료로 치면 "병합했다"는 기록과 달리 학생은 재원인 채 남는다.
  const today = kstToday();
  const { data: retired, error: retireError } = await supabase
    .from("students")
    .update({
      status: "withdrawn",
      withdrawn_at: today,
      // 🔴 기존 메모를 **보존**한다 — 종전엔 통째로 갈아끼워서 셔틀 안내 같은 실제 메모가 사라졌다.
      //    표식은 맨 앞에 붙는다(`isMergedStudent`가 접두로 판정 — 뒤에 붙이면 집계에서 안 걸러진다).
      notes: mergeNoteFor(keeperId, today, mergeeRow?.notes ?? null),
      dup_suspect: false,
      // 번호는 지점 안에서 하나만 쥘 수 있다(부분 유니크) — 남는 쪽에 주기 전에 진 쪽에서 비운다(같은 문장이라 함께 적용된다).
      ...(makeeduCarry.kind === "move" ? { makeedu_id: null } : {}),
    })
    .eq("id", mergeeId)
    .select("id");
  if (retireError) return stop("중복 학생 퇴원 처리", { error: retireError });
  if ((retired ?? []).length !== 1) return stop("중복 학생 퇴원 처리", { short: { expected: 1, done: 0 } });

  // 🔴 살아남은 쪽의 '의심' 표식도 내린다 — 안 내리면 keeper가 접미사 학생일 때(예: `권민서B`를 보존)
  //    상세 배너는 계속 *"중복 병합으로 합치세요"* 라고 하는데 짝은 이미 퇴원해 후보가 0건이라,
  //    원장이 제보한 "합칠 곳이 없음"이 병합 직후에 그대로 재현된다. 병합 = 사람이 답을 낸 것이다.
  //    이 한 줄이 실패해도(오류 · 0줄) 병합 자체는 끝났다(진 쪽은 이미 퇴원해 목록에서 사라졌다) — 되돌리거나 멈춘 것으로
  //    알리지 않고, 남은 일을 알린다.
  // 의심 표식 내리기 + 메이크에듀 번호 받기를 한 문장으로 — 번호를 못 받으면 진 쪽은 이미 비웠으니 연결이 사라진다(아래에서 알린다).
  const { data: cleared, error: clearError } = await supabase
    .from("students")
    .update({ dup_suspect: false, ...(makeeduCarry.kind === "move" ? { makeedu_id: makeeduCarry.makeeduId } : {}) })
    .eq("id", keeperId)
    .select("id");
  if (clearError) logDbError(clearError, "admin.mergeStudents.clearSuspect");
  const suspectLeft = !!clearError || (cleared ?? []).length !== 1;
  const makeeduLost = makeeduCarry.kind === "move" && suspectLeft;
  // 메이크에듀 지난 기록(0384a, 서버 전용 표)의 학생 연결도 따라간다 — 보조 기록이라 실패해도 병합은 멈추지 않는다.
  if (makeeduCarry.kind === "move" && !makeeduLost) {
    const { error: histError } = await createAdminClient()
      .from("makeedu_history_students")
      .update({ student_id: keeperId })
      .eq("tenant_id", user.tenantId)
      .eq("student_id", mergeeId);
    if (histError && !/makeedu_history_students/.test(histError.message ?? "")) logDbError(histError, "admin.mergeStudents.makeeduHistory");
  }

  await logAction({
    action: "student_merge",
    targetType: "student",
    // ⚠️ `audit_logs`엔 target_id 컬럼이 없다 — 되짚을 이름은 **targetLabel**이 나른다(비워 두면 감사로그
    //    목록의 '대상' 칸이 빈칸이라 어느 학생 건인지 목록에서 알 수 없다). id 두 개는 metadata에 그대로 있다.
    targetLabel: keeperName,
    metadata: {
      studentId: keeperId, mergedStudentId: mergeeId, mergedName: mergeeName, mergedRows, moved,
      ...(makeeduCarry.kind === "move" ? { makeeduIdMoved: makeeduCarry.makeeduId, ...(makeeduLost ? { makeeduIdLost: true } : {}) } : {}),
      ...(makeeduCarry.kind === "conflict" ? { makeeduIdConflict: makeeduCarry.mergeeMakeeduId } : {}),
    },
  });

  // 중복 병합 UI는 /owner?tab=data(데이터 정리 면)에 있다 — 그 경로를 revalidate해야 병합 후 목록이
  // 자동 갱신된다(구 /admin/duplicates는 redirect stub이라 무의미했음). /students도 함께(mergee 퇴원).
  revalidatePath("/owner");
  revalidatePath("/students");
  return {
    mergedRows,
    ...(makeeduLost
      ? { warning: `병합은 끝났지만 메이크에듀 원생 번호(${makeeduCarry.kind === "move" ? makeeduCarry.makeeduId : ""})를 남긴 학생에게 옮기지 못했습니다. 다음 메이크에듀 동기화가 다시 잇습니다 — 그 전에 관리자에게 알려 주세요.` }
      : makeeduCarry.kind === "conflict"
        ? { warning: `병합은 끝났지만 두 학생이 메이크에듀에서도 서로 다른 원생입니다(진 쪽 번호 ${makeeduCarry.mergeeMakeeduId}). 메이크에듀에서도 한 원생으로 정리해 주세요.` }
        : suspectLeft
          ? { warning: "병합은 끝났지만 보존한 학생의 '중복 의심' 표식을 내리지 못했습니다. 그 학생 상세에서 '정상 확인'을 눌러 주세요." }
          : {}),
  };
}

/** `warning` = 일부는 종료했지만 남은 건이 있을 때(화면이 그대로 보여 준다). */
export type CleanupState = { error?: string; closedCount?: number; warning?: string } | undefined;

/**
 * withdrawn 학생의 활성 enrollment 강제 종료.
 * 🔴 닫은 건수는 **실제로 바뀐 줄 수**만 센다 — 닫을 대상을 먼저 읽고, 권한이 막거나(오류 없이 0건) 그사이 지워진 수강을
 *    "닫았다"고 세지 않는다. 응답을 받지 못한 쓰기는 "적용됐는지 모른다"고 알린다(바뀐 것이 없다고 단정하지 않는다).
 */
export async function closeOrphanEnrollments(
  _prev: CleanupState,
  _formData: FormData,
): Promise<CleanupState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageAdministrativeStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const supabase = await createClient();
  const today = kstToday();

  // 퇴원 학생은 누적 증가(>1000 가능) → 무페이징 select는 silent 절단 → fetchAllPaged(B2). 페이지 경계가 흔들리지 않게 id 순.
  const withdrawnStudents = await fetchAllPaged<{ id: string }>((from, to) =>
    supabase.from("students").select("id").eq("status", "withdrawn").order("id").range(from, to),
  );
  const ids = withdrawnStudents.map((s) => s.id);
  if (ids.length === 0) return { closedCount: 0 };

  let closedCount = 0;
  /** 그중 아직 시작 전이라 **시작일로** 닫은 건수 — 감사 상세가 "전부 오늘로 닫았다"고 잘못 말하지 않게 따로 센다. */
  let futureCount = 0;
  /** 닫으려 했지만 바뀌지 않은 건수(권한이 막았거나 그사이 바뀜). */
  let skipped = 0;

  // 🔴 수강 기록을 한꺼번에 바꾸는 일이라 누가 언제 몇 건을 닫았는지 남긴다(종전엔 무기록이었다).
  //    묶음 중간에 멈춰도 **그때까지 닫은 만큼**은 남긴다(일괄 퇴원과 같은 규칙 — 무기록 창 방지).
  //    적용됐는지 모르는 쓰기가 있었으면 닫은 것이 0건이어도 남긴다(실제로는 바뀌었을 수 있다).
  const finish = async (error?: unknown): Promise<CleanupState> => {
    const uncertain = !!error && !isRejectedByDb(error);
    if (closedCount > 0 || uncertain) {
      await logAction({
        action: "enrollment_orphan_close",
        // 대상 유형은 다른 수강 기록(enrollment_*)과 같이 '학생'으로 남긴다(뷰어의 유형 라벨이 있는 값).
        targetType: "student",
        metadata: {
          count: closedCount,
          // 처리한 날 — 시작 전 수강은 이 날짜가 아니라 그 수강의 시작일로 닫는다(futureCount).
          processedOn: today,
          ...(futureCount > 0 ? { futureCount } : {}),
          ...(error ? { partial: true } : {}),
          ...(uncertain ? { uncertain: true } : {}),
        },
      });
    }
    // 데이터 정리 UI는 /owner?tab=data(데이터 정리 면)에 있다 — /admin/cleanup은 넘기기만 하는 주소라 그것만 무효화하면
    // 자동 종료 뒤에도 목록이 그대로 남는다(병합·일괄 퇴원과 같게 /owner를 함께).
    revalidatePath("/admin/cleanup");
    revalidatePath("/owner");
    if (uncertain) {
      explainDbError(error, { scope: "admin.closeOrphanEnrollments", fallback: "" });
      return { error: "적용됐는지 확인하지 못했습니다(응답을 온전히 받지 못했습니다). 새로고침해 남은 건수를 확인한 뒤 다시 종료해 주세요." };
    }
    if (error) {
      const info = explainDbError(error, { scope: "admin.closeOrphanEnrollments", fallback: "수강을 종료하지 못했습니다" });
      return {
        error: closedCount > 0 ? `${info.message} — ${closedCount}건은 이미 종료됐습니다. 새로고침한 뒤 남은 건을 다시 종료해 주세요.` : info.message,
      };
    }
    if (skipped > 0 && closedCount === 0) {
      return { error: "수강을 종료하지 못했습니다 — 수강 기록을 바꿀 권한이 있는 계정인지 확인해 주세요." };
    }
    return {
      closedCount,
      ...(skipped > 0
        ? { warning: `${skipped}건은 종료되지 않았습니다(그사이 바뀌었거나 바꿀 권한이 없습니다). 새로고침해 남은 건을 확인해 주세요.` }
        : {}),
    };
  };

  // 대량 .in()은 100개 청크로 분할(URL 414 방지, B3).
  // ⚠️ 종료일 = max(start_date, 오늘)로 클램프 — 미래 시작(배정 예정) 수강에 end_date=today를 넣으면
  //    daterange(start_date, today)가 lower>upper로 throw("range lower bound must be less than or equal
  //    to range upper bound"). 미래 시작 건은 end_date=start_date(zero-length=미활성=사실상 취소, run.ts 유령수강 픽스와 동일).
  for (const part of chunkIds(ids)) {
    // 닫을 대상(이 묶음의 열린 수강)을 먼저 읽는다 — 실제로 닫힌 건수와 견줄 기준이다.
    let open: { id: string; start_date: string }[];
    try {
      open = await fetchAllPaged<{ id: string; start_date: string }>((from, to) =>
        supabase.from("enrollments").select("id, start_date").in("student_id", part).is("end_date", null).order("id").range(from, to),
      );
    } catch (readError) {
      // 읽기 실패는 쓰기가 아니다 — 이 묶음에서는 바뀐 것이 없다(앞 묶음에서 닫은 만큼만 남긴다).
      return finish({ message: readError instanceof Error ? readError.message : "read failed", code: "READ" });
    }
    const started = open.filter((e) => e.start_date <= today);
    const future = open.filter((e) => e.start_date > today);

    if (started.length > 0) {
      // 정상(시작일 ≤ 오늘): end_date = 오늘 (한 번에).
      const { error, count } = await supabase
        .from("enrollments")
        .update(
          { end_date: today, withdrawal_reason: "퇴원에 따른 자동 종료" },
          { count: "exact" },
        )
        .in("student_id", part)
        .is("end_date", null)
        .lte("start_date", today);
      if (error) return finish(error);
      // 건수를 못 받았으면 얼마나 닫혔는지 모른다 — 적용됐는지 모르는 쓰기로 다룬다.
      if (typeof count !== "number") return finish({ message: "count unavailable" });
      closedCount += count;
      if (count < started.length) skipped += started.length - count;
    }

    // 미래 시작(배정 예정): 행마다 start_date가 달라 개별 종료(end_date = 그 수강의 start_date).
    for (const e of future) {
      const { data: closed, error: uErr } = await supabase
        .from("enrollments")
        .update({ end_date: e.start_date, withdrawal_reason: "퇴원에 따른 자동 종료" })
        .eq("id", e.id)
        .is("end_date", null)
        .select("id");
      if (uErr) return finish(uErr);
      // 실제로 바뀐 줄만 센다 — 읽은 뒤 다른 창이 지웠거나 권한이 막았으면 0줄이다.
      if ((closed ?? []).length === 1) {
        closedCount += 1;
        futureCount += 1;
      } else {
        skipped += 1;
      }
    }
  }

  return finish();
}

// === 데이터 정리: 수강 없는 재원생 일괄 처리 (퇴원/삭제) ===

export type BulkStudentState = { error?: string; ok?: true; message?: string } | undefined;

/** 큰 .in()을 100개 청크로 분할 (B3 — URL 414 방지). */
function chunkIds(ids: string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function parseSelectedIds(formData: FormData): string[] {
  return String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 선택한 학생들을 일괄 퇴원 처리(상태=withdrawn + withdrawn_at) — "수강 없는 재원생" 장부 정리용.
 * 가역적(학생 상세에서 재원 복구 가능). 관리 도구(admin) 쓰기 권한(기본 master, 위임 시 admin/manager).
 * 🔴 **지금 다니는 수강이 없는 재원생만** 받는다(서버가 다시 본다 — 화면 후보 목록은 게이트가 아니다, #77). 퇴원은 퇴원보고서로만
 *    (원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"*) — 이 정리가 다니는 학생을 보고서 없이 퇴원시키는 뒷문이 되지 않게.
 *    예전엔 남은 수강까지 함께 닫았다(어떤 학생이든 퇴원시킬 수 있었다). 수강 중·퇴원 예약이 걸린 학생은 건너뛰고 알린다.
 */
export async function bulkWithdrawStudents(
  _prev: BulkStudentState,
  formData: FormData,
): Promise<BulkStudentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageAdministrativeStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const picked = parseSelectedIds(formData);
  if (picked.length === 0) return { error: "학생을 선택해주세요" };
  // 퇴원은 퇴원보고서(바로 처리)로 남긴다 — 바로 처리는 관리자·원장 역할만 된다(작성 요청과 같은 역할). 위임받은 다른 역할엔 먼저 알린다.
  if (!canRequestReport(user.systemRole)) return { error: "수강 없는 재원생 정리(퇴원)는 원장·관리자·매니저 계정이 할 수 있습니다." };

  const supabase = await createClient();
  const today = kstToday();
  // 지금 다니는 수강(종료일 없음 · 오늘 이후 종료)이 있는 학생은 뺀다 — 그 학생의 퇴원은 퇴원보고서 몫이다.
  let attending: Set<string>;
  try {
    const rows = await fetchAllPagedInChunks<{ student_id: string }>(picked, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select("student_id")
        .in("student_id", chunk)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order("id")
        .range(from, to),
    );
    attending = new Set(rows.map((r) => r.student_id));
  } catch (error) {
    logDbError(error, "admin.bulkWithdraw.attending");
    return { error: "수강 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const ids = picked.filter((id) => !attending.has(id));
  if (ids.length === 0) return { error: "고른 학생이 모두 수업을 듣고 있습니다. 퇴원은 원생 화면의 '퇴원보고서'에서 진행해 주세요." };
  // 🔴 퇴원은 퇴원보고서로만(원장 2026-10-23) — 장부 정리도 학생마다 **관리자 바로 처리 보고서**(0453a `direct_withdrawal_report`, 반 0개)로
  //    남긴다. 학생을 직접 퇴원으로 쓰지 않는다(예전엔 이 자리에서 상태를 바꿨다). 사유·메모는 예전과 같다 — 처리 함수가 학생 퇴원 메모로 옮겨
  //    `isCleanupExit`(장부 정리 판정)가 그대로 알아본다. 처리일 = 오늘 · 처리 함수가 학생·수강 정보를 다시 대조한다.
  const admin = createAdminClient();
  // 일괄 퇴원도 감사로그에 남긴다 — 2026-08-17 배치(31명)가 "누가 했는지" 추적 불가였던 것 재발 방지.
  // 🔴 중간에 멈춰도 **이미 퇴원된 만큼은** 기록한다(무기록 창 방지, 적대 리뷰 F6) — 로그 id는 실제로 처리된 학생.
  const done: string[] = [];
  const reportIds: string[] = [];
  /** 기록은 했지만 아직 처리되지 않은 학생(원장 환불 결정 대기 · 확인 실패 — 처리일 cron이 다시 본다). */
  const waiting: string[] = [];
  let failed = 0;
  let firstFailure: string | null = null;
  let notReady = false;
  // 새 앱 + 옛 DB(s2_0033 전)면 바로 처리 함수를 부르지 않는다(리뷰 #5 — 안에서 부르는 처리가 확인 값을 모른다).
  try { if (!(await refundGateReady())) return { error: REFUND_GATE_NOT_READY }; }
  catch { return { error: "퇴원보고서 환불 관문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
  for (const id of ids) {
    const { data, error } = await admin.rpc("direct_withdrawal_report", {
      p_tenant: user.tenantId,
      p_actor: user.id,
      p_payload: { studentId: id, enrollmentIds: [], effectiveDate: today, reason: "other", reasonDetail: "", memo: CLEANUP_WITHDRAWAL_MEMO },
    });
    if (error) {
      if (missingReportSchema(error)) {
        notReady = true;
        break;
      }
      failed++;
      // 첫 실패의 이유를 화면에 그대로 — 담당 범위·등록일·진행 중 보고서 등 DB가 말한 한글 사유(#138).
      const why = explainDbError(error, { scope: "admin.bulkWithdraw.direct", fallback: "처리하지 못한 학생이 있습니다.", context: { studentId: id } });
      firstFailure ??= why.message;
      continue;
    }
    done.push(id);
    reportIds.push(String(data));
    // 처리일이 오늘이라도 DB 안의 처리는 환불 확인 값이 없어 미룬다(s2_0033) — 같은 요청에서 확인 값과 처리(원장 환불 결정 전이면 처리 예약으로 남는다).
    const { data: report } = await admin.from("withdrawal_reports").select("*").eq("tenant_id", user.tenantId).eq("id", String(data)).maybeSingle();
    if (report) {
      const applied = await applyDirectNow(report as WithdrawalReport, user.id);
      if (applied.report.status !== "completed") waiting.push(id);
    } else waiting.push(id);
  }
  if (done.length > 0) {
    await logAction({
      action: "student_bulk_withdraw",
      targetType: "student",
      metadata: { count: done.length, studentIds: done, reportIds, ...(failed > 0 ? { failed } : {}), ...(waiting.length ? { refundWait: waiting.length } : {}) },
    });
  }
  if (done.length === 0) {
    return {
      error: notReady
        ? "퇴원보고서 바로 처리를 준비 중이라 정리하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : (firstFailure ?? "고른 학생을 정리하지 못했습니다. 재원 상태·퇴원 예약·진행 중인 퇴원보고서를 확인해 주세요."),
    };
  }

  revalidatePath("/owner");
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  revalidatePath("/withdrawal-reports");
  const skipped = picked.length - done.length;
  return {
    ok: true,
    message: `${done.length}명 퇴원 처리 완료(퇴원보고서 기록을 남겼습니다)${skipped > 0 ? ` · ${skipped}명은 수업을 듣고 있거나 처리할 수 없어 건너뜀(퇴원은 '퇴원보고서'로)` : ""}${firstFailure ? ` — ${firstFailure}` : ""}`,
  };
}

/**
 * 선택한 학생들을 일괄 삭제(영구). 대부분 FK는 cascade지만 invoices는 onDelete=restrict이므로
 * 청구 기록이 있는 학생은 삭제 불가 → 건너뛰고 보고(퇴원 처리 권장). 관리 도구(admin) 쓰기 권한(기본 master, 위임 시 admin/manager).
 */
export async function bulkDeleteStudents(
  _prev: BulkStudentState,
  formData: FormData,
): Promise<BulkStudentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const ids = parseSelectedIds(formData);
  if (ids.length === 0) return { error: "학생을 선택해주세요" };

  const supabase = await createClient();

  // 청구(invoices) 기록 있는 학생 식별 — FK restrict라 삭제 불가
  const withInvoice = new Set<string>();
  for (const part of chunkIds(ids)) {
    const { data, error } = await supabase.from("invoices").select("student_id").in("student_id", part);
    if (error) return { error: error.message };
    (data ?? []).forEach((r) => withInvoice.add(r.student_id as string));
  }

  const deletable = ids.filter((id) => !withInvoice.has(id));
  const skipped = withInvoice.size;
  if (deletable.length === 0) {
    return {
      error: `선택한 ${ids.length}명 모두 청구 기록이 있어 삭제할 수 없습니다. 퇴원 처리를 이용하세요.`,
    };
  }

  // 청크 중간 실패 시에도 이미 지워진 만큼은 기록(F6) — id는 delete가 실제 지운 행(select 반환, F10).
  const done: string[] = [];
  const writeBulkLog = () =>
    done.length === 0
      ? Promise.resolve()
      : logAction({
          action: "student_bulk_delete",
          targetType: "student",
          metadata: { count: done.length, studentIds: done },
        });
  for (const part of chunkIds(deletable)) {
    const { data: deleted, error } = await supabase
      .from("students")
      .delete()
      .in("id", part)
      .select("id");
    if (error) {
      await writeBulkLog();
      return { error: error.message };
    }
    done.push(...(deleted ?? []).map((r) => r.id as string));
  }
  const count = done.length;
  await writeBulkLog();

  revalidatePath("/owner");
  revalidatePath("/students");
  return {
    ok: true,
    message:
      skipped > 0
        ? `${count}명 삭제 완료 · ${skipped}명은 청구 기록이 있어 건너뜀(퇴원 처리 권장)`
        : `${count}명 삭제 완료`,
  };
}
