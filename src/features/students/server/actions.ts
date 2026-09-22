"use server";

import { revalidatePath } from "next/cache";
import {
  clearOnHoldForActiveEnrollments,
  endEnrollmentById,
  listOpenEnrollments,
  reopenEnrollmentsClosedByWithdrawal,
} from "./enrollment-sync";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { canonicalSchoolName, type SchoolSaveAlias } from "@/features/schools/school-name";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accessLevelTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "@/features/withdrawals/types";
import { currentPeriod, isCommentCategory } from "../grades-meta";
// 생성 = 공용 진입점(전 경로 공유) / 수정 = 자기 자신을 taken에서 빼야 해서 순수 함수 직접 호출.
import { resolveUniqueStudentName } from "../name-suffix";
import { preserveMergeNote } from "../merged";
import { resolveUniqueStudentNameFor } from "./unique-name";

export type StudentFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      ok?: true;
      redirectTo?: string;
      nonce?: number;
      notice?: string; // 이름 중복으로 접미사(A·B·C)가 강제 부여됐을 때 안내.
    }
  | undefined;

const STATUSES = ["prospect", "consulted", "enrolled", "on_hold", "withdrawn"] as const;
type StudentStatus = (typeof STATUSES)[number];

/**
 * 한국 전화번호 정규화 (F5). 숫자만 추출 후 휴대폰/지역번호 규칙으로 하이픈 삽입,
 * 앞자리 0 누락(예: "1065317203")도 보정. 인식 못 하는 길이는 원본 유지(과도한 변형 방지).
 */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 && d.startsWith("10")) d = "0" + d; // 1065317203 → 01065317203
  if (d.length === 11 && d.startsWith("010")) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return raw;
}

function readForm(formData: FormData, schoolAliases: readonly SchoolSaveAlias[]) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v).trim();
  };
  const status = get("status");
  const gender = get("gender");
  return {
    name: get("name"),
    englishName: get("englishName") || null,
    classnoteName: get("classnoteName") || null,
    grade: get("grade") || null,
    // 저장 표기 강제(원장 2026-09-01) — 학생 자연키가 학교를 쓰므로 표기가 갈리면 중복도 갈린다.
    school: canonicalSchoolName(get("school"), schoolAliases),
    studentCode: get("studentCode") || null,
    attendanceCode: get("attendanceCode") || null,
    gender: gender === "male" || gender === "female" ? gender : null,
    birthDate: get("birthDate") || null,
    nickname: get("nickname") || null,
    graduationYear: get("graduationYear") || null,
    address: get("address") || null,
    zipCode: get("zipCode") || null,
    addressDetail: get("addressDetail") || null,
    email: get("email") || null,
    studentPhone: normalizePhone(get("studentPhone") || null),
    homePhone: normalizePhone(get("homePhone") || null),
    otherPhone: normalizePhone(get("otherPhone") || null),
    parentName: get("parentName") || null,
    parentPhone: normalizePhone(get("parentPhone") || null),
    parentRelation: get("parentRelation") || null,
    status: (STATUSES.includes(status as StudentStatus) ? status : "prospect") as StudentStatus,
    enrolledAt: get("enrolledAt") || null,
    withdrawnAt: get("withdrawnAt") || null,
    notes: get("notes") || null,
  };
}

function validate(input: ReturnType<typeof readForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "이름은 필수입니다";
  if (input.parentPhone && !/^[\d\s\-+()]{8,}$/.test(input.parentPhone)) {
    errors.parentPhone = "연락처 형식을 확인해주세요";
  }
  if (input.status === "withdrawn" && !input.withdrawnAt) {
    errors.withdrawnAt = "퇴원일을 입력해주세요";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

function translateDbError(message: string): string {
  if (/duplicate key/i.test(message) || /students_natural_key/i.test(message)) {
    return "동일한 이름·학교·학년의 재원 학생이 이미 있습니다";
  }
  return message;
}

/**
 * 학생 기록 변경(등록·수정·상태 전환) 게이트 = students **full**만 (master·admin·manager·counselor).
 * 🔴 `canWriteTenant`는 scoped(강사)도 통과한다 — 2026-08-18 원장 지시("강사들은 퇴원처리 막아,
 * 수정도 안되게, AI 케어도 — 읽기만 해") 이후 강사는 학생 상세 **열람 전용**이다. 배경: 실제 등원 중인
 * 학생 7명이 7월 날짜로 소급 퇴원 처리되는 사고 + 감사로그 부재로 행위자 역추적 불가.
 * UI(학생 상세 헤더 버튼·edit 라우트)와 이 서버 게이트가 한 쌍이다(#77 — 화면 숨김은 게이트가 아니다).
 */
async function canManageStudentRecords(role: Parameters<typeof canManageTenant>[0]): Promise<boolean> {
  // canManageTenant(=full 판정) 위임 — 같은 의미를 두 벌 구현하면 다음 조정 때 한쪽만 고친다(적대 리뷰 F8).
  return canManageTenant(role, "students");
}

const STUDENT_MANAGE_DENIED = "학생 정보 변경 권한이 없습니다 — 강사 계정은 열람 전용입니다";

export async function createStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const input = readForm(formData, (await getTenantSettings()).operations.schoolSaveAliases);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // 이름 중복 방지 — 같은 이름이 이미 있으면 다음 빈 알파벳 접미사(A·B·C…) 강제(ijw/makeedu 규약).
  // 판정은 공용 진입점 하나로(상담 전환·엑셀 가져오기도 같은 함수) — 한 경로만 지키면 소용없다.
  const resolvedName = await resolveUniqueStudentNameFor(supabase, user.tenantId, input.name);

  const { data, error } = await supabase
    .from("students")
    .insert({
      tenant_id: user.tenantId,
      name: resolvedName.name,
      english_name: input.englishName,
      classnote_name: input.classnoteName,
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
      attendance_code: input.attendanceCode,
      gender: input.gender,
      birth_date: input.birthDate,
      nickname: input.nickname,
      graduation_year: input.graduationYear,
      address: input.address,
      zip_code: input.zipCode,
      address_detail: input.addressDetail,
      email: input.email,
      student_phone: input.studentPhone,
      home_phone: input.homePhone,
      other_phone: input.otherPhone,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      parent_relation: input.parentRelation,
      status: input.status,
      enrolled_at: input.enrolledAt,
      withdrawn_at: input.withdrawnAt,
      withdrawal_metadata:
        input.status === "withdrawn" ? DEFAULT_WITHDRAWAL_METADATA : null,
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: translateDbError(error?.message ?? "학생 등록 실패") };
  }

  await logAction({
    action: "student_create",
    targetType: "student",
    targetLabel: resolvedName.name,
    metadata: { studentId: data.id },
  });

  revalidatePath("/students");
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·동시편집 신호·이동(B-2).
  // (redirect()면 NEXT_REDIRECT throw로 폼의 nonce 효과가 안 돌아 'student:new' 초안이 안 비워진다.)
  return {
    ok: true,
    redirectTo: `/students/${data.id}`,
    nonce: Date.now(),
    notice: resolvedName.suffixed
      ? `이미 '${input.name}' 학생이 있어 '${resolvedName.name}'(으)로 등록했습니다.`
      : undefined,
  };
}

export type DeleteStudentState = { error?: string; ok?: true } | undefined;

/**
 * 학생 영구 삭제(단건) — 잘못 추가한 학생 즉시 정정용. 대부분 FK는 cascade지만 invoices는 restrict라
 * 청구(수납) 기록이 있으면 삭제 불가(퇴원 처리 권장). 파괴적이라 관리 도구(admin) 쓰기 권한으로 조임
 * (기본 master, 역할·권한에서 위임 시 admin/manager). 되돌릴 수 없음 → UI에서 2단계 확인.
 */
export async function deleteStudent(_prev: DeleteStudentState, formData: FormData): Promise<DeleteStudentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "영구 삭제 권한이 없습니다(관리 도구 권한 필요)" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 감사 기록용 이름 선조회 — 삭제 뒤엔 uuid로 이름을 되찾을 수 없다(describe.ts student_delete 참조).
  const { data: target } = await supabase.from("students").select("name").eq("id", id).maybeSingle();
  // 청구(invoices) 기록 있으면 FK restrict라 삭제 실패 → 미리 막고 퇴원 처리 안내(count head:true = 행 안 받음, B2).
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("student_id", id);
  if ((count ?? 0) > 0) {
    return { error: "청구(수납) 기록이 있어 영구 삭제할 수 없습니다. 퇴원 처리를 이용하세요." };
  }

  const { error, count: deleted } = await supabase.from("students").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: translateDbError(error.message) };
  if (!deleted) return { error: "학생을 찾을 수 없거나 권한이 없습니다" };

  await logAction({
    action: "student_delete",
    targetType: "student",
    targetLabel: target?.name ?? null,
    metadata: { studentId: id, studentName: target?.name ?? null },
  });

  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true };
}

export async function updateStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const input = readForm(formData, (await getTenantSettings()).operations.schoolSaveAliases);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // status 전환 시 withdrawal_metadata 처리 — 새로 퇴원으로 가면 기본 메타 채움,
  // 다시 재원으로 돌리면 null로 비움. 이미 퇴원 상태였으면 손대지 않음.
  const { data: cur } = await supabase
    .from("students")
    // `notes`는 병합 표식(`중복 병합: …`)을 지켜내려고 함께 읽는다 — 아래 preserveMergeNote 주석 참조.
    .select("status, withdrawal_metadata, withdrawn_at, name, notes")
    .eq("id", id)
    .single();
  const prevStatus = cur?.status as string | undefined;

  let withdrawalMetadata: unknown = cur?.withdrawal_metadata ?? null;
  if (input.status === "withdrawn" && prevStatus !== "withdrawn") {
    withdrawalMetadata = DEFAULT_WITHDRAWAL_METADATA;
  } else if (input.status !== "withdrawn") {
    withdrawalMetadata = null;
  }

  // 이름을 새 값으로 바꾼 경우만 중복 검사 — 기존(=현재) 이름 유지 저장은 제외(원장 지시). 자기 자신(id)은 taken에서 빼서
  // 자기 이름과 충돌로 오인되지 않게. 신규 이름이 다른 학생과 겹치면 접미사(A·B·C…) 강제.
  const currentName = ((cur?.name as string | null) ?? "").trim();
  let finalName = input.name;
  let renamed = false;
  if (input.name.trim() !== currentName) {
    const existingNames = await fetchAllPaged<{ id: string; name: string | null }>((from, to) =>
      supabase.from("students").select("id, name").eq("tenant_id", user.tenantId).range(from, to),
    );
    const taken = new Set(
      existingNames.filter((r) => r.id !== id).map((r) => (r.name ?? "").trim()).filter(Boolean),
    );
    const resolved = resolveUniqueStudentName(input.name, taken);
    finalName = resolved.name;
    renamed = resolved.suffixed;
  }

  const { error } = await supabase
    .from("students")
    .update({
      name: finalName,
      english_name: input.englishName,
      classnote_name: input.classnoteName,
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
      attendance_code: input.attendanceCode,
      gender: input.gender,
      birth_date: input.birthDate,
      nickname: input.nickname,
      graduation_year: input.graduationYear,
      address: input.address,
      zip_code: input.zipCode,
      address_detail: input.addressDetail,
      email: input.email,
      student_phone: input.studentPhone,
      home_phone: input.homePhone,
      other_phone: input.otherPhone,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      parent_relation: input.parentRelation,
      status: input.status,
      enrolled_at: input.enrolledAt,
      withdrawn_at: input.status === "withdrawn" ? input.withdrawnAt : null,
      withdrawal_metadata: withdrawalMetadata,
      // 🔴 병합 표식은 사람이 지울 수 없다 — 이 칸('메모 / 특이사항')이 곧 `students.notes`라, 표식이
      //    사람 메모와 **같은 칸**에 들어 있다. 그냥 저장하면 표식이 날아가고 그 학생이 집계에서
      //    **퇴원으로 조용히 되살아난다**(에러도 경고도 없다). 병합된 학생이 아니면 입력값 그대로다.
      //    ⚠️ 단 **퇴원에서 되돌리는 저장이면 놓아 준다** — 잘못 병합한 건을 푸는 유일한 손잡이다.
      notes: preserveMergeNote(
        cur?.notes as string | null,
        input.notes,
        input.status === "withdrawn",
      ),
    })
    .eq("id", id);

  if (error) return { error: translateDbError(error.message) };

  // 상태 전환에 맞춰 활성 enrollment 정합성 유지 (changeStudentStatus와 동일 불변식).
  // 편집 폼 경로가 enrollment를 안 닫던 누수(F8) 보강 — 퇴원 시 종료, 복구/재원 시 on_hold 해제.
  if (input.status === "withdrawn" && prevStatus !== "withdrawn") {
    const enrErr = await closeActiveEnrollmentsClamped(supabase, id, input.withdrawnAt ?? null);
    if (enrErr) return { error: enrErr };
  } else if (input.status === "enrolled" && prevStatus !== "enrolled") {
    // 퇴원이 닫은 enrollment(end_date=퇴원일)를 다시 연다 — 안 하면 재원인데 시간표 '퇴원'에 남음.
    const withdrawnDate = cur?.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };
    const holdErr = await clearOnHoldForActiveEnrollments(supabase, id);
    if (holdErr) return { error: holdErr };
  } else if (input.status === "on_hold" && prevStatus !== "on_hold") {
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: true })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  }

  await logAction({
    action: "student_update",
    targetType: "student",
    targetLabel: finalName,
    metadata: { studentId: id, statusFrom: prevStatus ?? null, statusTo: input.status },
  });

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  // redirect 대신 결과 반환 — 클라가 성공 확정 후 동시편집 신호(publish) → 이동(B-2). nonce로 연속 저장 구분.
  return {
    ok: true,
    redirectTo: `/students/${id}`,
    nonce: Date.now(),
    notice: renamed ? `이미 '${input.name}' 학생이 있어 '${finalName}'(으)로 저장했습니다.` : undefined,
  };
}


/**
 * 학생의 활성(end_date null) 수강을 date로 종료한다. ⚠️ 미래 시작(start_date > date) 수강에
 * end_date=date를 넣으면 daterange(start_date, date)가 lower>upper로 throw("range lower bound must be
 * less than or equal to range upper bound") → 그 건은 end_date=start_date(zero-length=미활성=사실상 취소)로 클램프.
 * (admin 데이터정리 closeOrphanEnrollments와 동일 원리 — 그쪽은 다중 학생 청크판.) date 없으면 원래 동작(미종료).
 */
async function closeActiveEnrollmentsClamped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  date: string | null,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  if (!date) {
    const { error } = await supabase
      .from("enrollments")
      .update({ end_date: null, ...extra })
      .eq("student_id", studentId)
      .is("end_date", null);
    return error?.message ?? null;
  }
  // 정상(시작일 ≤ date): 일괄 end_date=date.
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: date, ...extra })
    .eq("student_id", studentId)
    .is("end_date", null)
    .lte("start_date", date);
  if (error) return error.message;
  // 미래 시작(배정 예정): 행마다 start_date가 달라 개별 종료(end_date = 그 수강의 start_date).
  const { data: future, error: fErr } = await supabase
    .from("enrollments")
    .select("id, start_date")
    .eq("student_id", studentId)
    .is("end_date", null)
    .gt("start_date", date);
  if (fErr) return fErr.message;
  for (const e of future ?? []) {
    const { error: uErr } = await supabase
      .from("enrollments")
      .update({ end_date: e.start_date, ...extra })
      .eq("id", e.id);
    if (uErr) return uErr.message;
  }
  return null;
}

// ────────────────────── 상태 전환 모달 (퇴원/휴원/수강종료/복구) ──────────────────────

const WITHDRAWAL_REASONS: WithdrawalReason[] = [
  "graduated",
  "relocation",
  "competitor",
  "financial",
  "schedule",
  "dissatisfaction",
  "other",
];

// ⚠️ `ok`는 다이얼로그가 **성공을 감지**하는 유일한 신호다 — 종전엔 성공 시 undefined를 돌려
// useActionState state가 초깃값 그대로였고, StatusDialog의 `if (state && !state.error)` 닫기 effect가
// 영영 발화하지 않아 퇴원을 눌러도 모달이 그대로 남았다(뒤 화면만 조용히 갱신).
export type ChangeStatusState = { error?: string; ok?: true } | undefined;

/**
 * 학생 상태 전환 (퇴원/휴원/복구). 학생 상세에서 호출.
 * - withdrawn: 학생 status='withdrawn' + 모든 활성 enrollment의 end_date 설정 + withdrawal_metadata 채움
 * - on_hold: 학생 status='on_hold' + 활성 enrollment에 on_hold=true
 * - enrolled (복구): 학생 status='enrolled' + withdrawn_at/metadata null + on_hold 해제
 */
export async function changeStudentStatus(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 🔴 퇴원·휴원·복구 = full만(강사 차단, 원장 지시 2026-08-18) — canManageStudentRecords 주석 참조.
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("target") ?? "").trim();
  const reasonStr = String(formData.get("reason") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const date = String(formData.get("date") ?? "").trim() || null;

  if (!id) return { error: "학생 ID가 누락되었습니다" };
  if (!["withdrawn", "on_hold", "enrolled"].includes(target)) {
    return { error: "유효하지 않은 상태 전환입니다" };
  }

  const supabase = await createClient();

  // 퇴원/휴원/복구는 전부 감사로그에 actor를 남긴다 — "누가 퇴원시켰는지 역검수 불가" 사고(2026-08-18) 재발 방지.
  // 🔴 로그는 students.update **성공 직후**에 남긴다 — 뒤의 enrollment 정합 단계가 실패해도 상태는 이미
  //    바뀌었으므로, 끝에서 몰아 남기면 "상태는 바뀌었는데 기록이 없는" 무기록 창이 생긴다(적대 리뷰 F6).
  const writeStatusLog = (closing?: { enrollmentIds: string[]; classIds: (string | null)[] }) =>
    logAction({
      action:
        target === "withdrawn" ? "student_withdraw" : target === "on_hold" ? "student_hold" : "student_restore",
      targetType: "student",
      metadata:
        target === "withdrawn"
          ? {
              studentId: id,
              date,
              reason: reasonStr,
              memo,
              // 🔴 "어느 수강을 닫았는지"를 남긴다(원장 2026-08-18 역검수) — 부분 종료(enrollment_end)와
              //    전체 퇴원(student_withdraw)이 로그에서 구분되고, 전체 퇴원은 닫힌 반까지 보인다.
              ...(closing ?? {}),
            }
          : // 🔴 휴원 메모는 담을 컬럼이 없어 종전엔 폼에서 받고 **버려졌다**(거짓 약속).
            //    students엔 휴원용 칸이 없으니 감사로그가 유일한 자리다 — 적었으면 남는다.
            target === "on_hold"
            ? { studentId: id, memo }
            : { studentId: id },
    });

  if (target === "withdrawn") {
    if (!WITHDRAWAL_REASONS.includes(reasonStr as WithdrawalReason)) {
      return { error: "퇴원 사유를 선택해주세요" };
    }
    if (!date) return { error: "퇴원일을 입력해주세요" };

    const metadata: WithdrawalMetadata = {
      reason: reasonStr as WithdrawalReason,
      memo,
      consultation: {
        adminCalledParent: false,
        teacherCalledParent: false,
        talkedWithStudent: false,
      },
    };

    // 닫힐 수강을 **닫기 전에** 읽어 둔다 — 감사로그에 어느 반이 종료 대상이었는지 싣기 위해서다.
    // (조회 실패는 퇴원을 막지 않는다: 기록이 조금 얇아질 뿐, 상태 전환이 더 중요하다.)
    const { rows: closingRows } = await listOpenEnrollments(supabase, id);

    const { error: stuErr } = await supabase
      .from("students")
      .update({
        status: "withdrawn",
        withdrawn_at: date,
        withdrawal_metadata: metadata,
      })
      .eq("id", id);
    if (stuErr) return { error: stuErr.message };
    await writeStatusLog({
      enrollmentIds: closingRows.map((r) => r.id),
      classIds: closingRows.map((r) => r.classId),
    });

    // 활성 enrollment 종료 (미래 시작 수강은 end_date=start_date로 클램프 — daterange 에러 방지).
    const enrErr = await closeActiveEnrollmentsClamped(supabase, id, date, { withdrawal_reason: reasonStr });
    if (enrErr) return { error: enrErr };
  } else if (target === "on_hold") {
    const { error: stuErr } = await supabase
      .from("students")
      .update({ status: "on_hold" })
      .eq("id", id);
    if (stuErr) return { error: stuErr.message };
    await writeStatusLog();

    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: true })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  } else if (target === "enrolled") {
    // 복구 전에 이 학생의 퇴원일(withdrawn_at)을 먼저 읽는다 — 그 날짜로 닫힌 enrollment가 이번 퇴원이 종료시킨 것.
    const { data: before } = await supabase
      .from("students")
      .select("withdrawn_at")
      .eq("id", id)
      .single();
    const withdrawnDate = before?.withdrawn_at ? String(before.withdrawn_at).slice(0, 10) : null;

    // 복구: status=enrolled, withdrawn_at=null, metadata=null, on_hold=false
    const { error: stuErr } = await supabase
      .from("students")
      .update({
        status: "enrolled",
        withdrawn_at: null,
        withdrawal_metadata: null,
      })
      .eq("id", id);
    if (stuErr) return { error: stuErr.message };
    await writeStatusLog();

    // ⚠️ 퇴원이 닫은 enrollment(end_date=퇴원일)를 다시 연다 — 안 하면 재원인데 수강이 종료로 남아 시간표 '퇴원'에 뜬다.
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };

    // 나머지 이미 열려있던 enrollment의 on_hold 해제.
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: false })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  }

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true };
}

/**
 * 퇴원 다이얼로그의 **부분 종료** — 고른 수강만 닫고 **학생은 재원으로 남긴다.**
 *
 * 원장 2026-08-20: *"한과목 퇴원인데 두과목 퇴원처리되서 말싸움"* — 종전엔 퇴원 다이얼로그가 활성 수강을
 * 전부 닫는 길 하나뿐이었고, 정식 경로(단일 수강 종료)는 실데이터에서 5건만 쓰이고 있었다.
 *
 * 🔴 종료 자체는 단일 수강 종료와 **같은 원시함수**(endEnrollmentById)를 돈다 — 새 종료 로직을 또 짜면
 *    한쪽만 고쳐진다(#77). 감사로그도 같은 키(`enrollment_end`)라 기존 뷰어·이름 검색이 그대로 먹는다.
 * 🔴 학생 상태(students.status)는 **건드리지 않는다** — 퇴원이 아니므로 퇴원관리 목록
 *    (getWithdrawnStudents는 status='withdrawn'만)에 뜨지 않는다. 과목을 통째로 끊었다면
 *    퇴원관리 '수강종료'(getSubjectEndedStudents) 쪽에 잡힌다 — 그게 이 동작의 올바른 자리다.
 */
export async function endStudentEnrollments(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 🔴 단일 수강 종료와 **같은 게이트** — 강사(scoped)는 학생 기록 열람 전용(원장 2026-08-18).
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const reasonStr = String(formData.get("reason") ?? "").trim();
  const picked = new Set(
    formData
      .getAll("enrollmentIds")
      .map((v) => String(v).trim())
      .filter(Boolean),
  );

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!date) return { error: "종료일을 입력해주세요" };
  if (!WITHDRAWAL_REASONS.includes(reasonStr as WithdrawalReason)) {
    return { error: "종료 사유를 선택해주세요" };
  }
  if (picked.size === 0) return { error: "종료할 수업을 1개 이상 선택해주세요" };

  const supabase = await createClient();

  // 🔴 고른 id를 그대로 믿지 않는다 — **이 학생의 활성 수강**과 교집합만 닫는다(남의 학생 행·이미 끝난
  //    행이 낡은 화면에서 섞여 오는 것을 서버에서 잘라낸다. 화면 조건은 게이트가 아니다 — #77).
  const { error: listErr, rows: open } = await listOpenEnrollments(supabase, studentId);
  if (listErr) return { error: "수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  const targets = open.filter((r) => picked.has(r.id));
  if (targets.length === 0) {
    return { error: "종료할 수 있는 수강이 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
  }

  for (const t of targets) {
    const res = await endEnrollmentById(supabase, t.id, date, reasonStr);
    if (res.error) {
      // 앞의 몇 건은 이미 닫혔다 — 그 기록은 아래 루프 밖이 아니라 **건별로** 남겼으므로 유실되지 않는다.
      return { error: "수강을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    // 수강을 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18). 단일 수강 종료와 같은 키·모양 +
    // `partial`로 "전체 퇴원이 아니라 골라서 닫았다"를 구분한다.
    await logAction({
      action: "enrollment_end",
      targetType: "student",
      metadata: {
        studentId,
        classId: res.classId,
        date: res.endDate,
        reason: reasonStr,
        source: "status_dialog",
        partial: targets.length < open.length,
      },
    });
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  revalidatePath("/timetable");
  return { ok: true };
}

/**
 * 휴원 다이얼로그의 **부분 휴원** — 고른 수강만 대기로 돌리고 **학생은 재원으로 남긴다.**
 *
 * 원장 2026-09-16: *"퇴원이든 휴원이든 … 누르면 수강중인 수업 전부 보여주고 그중에서 선택한 과목만
 * 휴원 및 퇴원처리할 수 있게."* — 퇴원엔 2026-08-20부터 있던 길이 휴원엔 없어서, 영어만 쉬려 해도
 * 수학까지 함께 멈췄다(`changeStudentStatus`의 on_hold 갈래는 활성 수강 전건을 대기로 돌린다).
 *
 * 🔴 **선택이 곧 "휴원 중인 수업" 전체다** — 체크한 것은 대기로, **체크가 풀렸는데 지금 대기인 것은
 *    다시 수강으로** 돌린다. 되돌릴 문을 같은 화면에 두지 않으면 부분 휴원을 풀 방법이 없다(학생 상태가
 *    '재원'이라 메뉴에 '재원 복구'가 안 뜬다). 규칙은 [`hold-selection.ts`](../hold-selection.ts) 단일 소스.
 * 🔴 **바뀐 행만 쓴다** — 이미 대기인 행을 또 쓰면 감사로그가 같은 사실로 부풀고, 아무것도 안 바뀐
 *    저장이 "처리했다"는 기록을 남긴다.
 * 🔴 학생 상태(students.status)는 **건드리지 않는다** — 휴원이 아니므로 퇴원관리·재원생 집계가 움직이지 않는다.
 *    전부 선택은 화면이 종전 `changeStudentStatus(target=on_hold)`로 보낸다(행선지가 갈린다).
 */
export async function setStudentEnrollmentHolds(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 🔴 퇴원·부분 종료와 **같은 게이트** — 강사(scoped)는 학생 기록 열람 전용(원장 2026-08-18).
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();
  const picked = new Set(
    formData
      .getAll("enrollmentIds")
      .map((v) => String(v).trim())
      .filter(Boolean),
  );
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();

  // 🔴 고른 id를 그대로 믿지 않는다 — **이 학생의 활성 수강**과 교집합만 쓴다(낡은 화면·남의 행 차단, #77).
  const { error: listErr, rows: open } = await listOpenEnrollments(supabase, studentId);
  if (listErr) return { error: "수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };

  const toHold = open.filter((r) => picked.has(r.id) && !r.onHold);
  const toResume = open.filter((r) => !picked.has(r.id) && r.onHold);
  // 🔴 `picked.size`가 아니라 **이 학생의 활성 수강과의 교집합**으로 센다 — 낡은 화면이 남의 id를
  //    섞어 보내면 picked.size가 부풀어 "전부 휴원"으로 기록된다(숫자만 거짓이 되는 자리).
  const heldAfter = open.filter((r) => picked.has(r.id)).length;
  if (toHold.length === 0 && toResume.length === 0) {
    // 바뀐 게 없다 — 에러가 아니라 성공으로 통과(멱등). 화면은 그대로 닫힌다.
    return { ok: true };
  }

  for (const r of toHold) {
    const { error } = await supabase.from("enrollments").update({ on_hold: true }).eq("id", r.id);
    if (error) return { error: "수강을 대기로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." };
    // 수강을 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18). 시간표 드래그(holdSingleEnrollment)와 같은 키.
    await logAction({
      action: "enrollment_hold",
      targetType: "student",
      metadata: { studentId, classId: r.classId, date, source: "status_dialog", partial: heldAfter < open.length },
    });
  }
  for (const r of toResume) {
    const { error } = await supabase.from("enrollments").update({ on_hold: false }).eq("id", r.id);
    if (error) return { error: "수강을 되돌리지 못했습니다. 잠시 후 다시 시도해 주세요." };
    await logAction({
      action: "enrollment_resume",
      targetType: "student",
      metadata: { studentId, classId: r.classId, date, source: "status_dialog" },
    });
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath("/timetable");
  // 반 상세 명단이 대기 표시를 그린다 — holdSingleEnrollment와 같은 갱신 범위.
  for (const id of new Set([...toHold, ...toResume].map((r) => r.classId).filter(Boolean))) {
    revalidatePath(`/classes/${id}`);
  }
  return { ok: true };
}

/**
 * 단일 수강 **대기(휴원)** 전환 — 이 수강 한 건만 대기로 돌린다(퇴원·반 폐지 아님).
 *
 * 원장 2026-09-07(시간표 통합뷰): 학생을 대기 칸으로 끌어 놓으면 확인 팝업이 뜨고, 날짜를 고른다(기본 오늘).
 *
 * 🔴 **게이트는 수강 종료와 같다**(`canManageStudentRecords` = students full) — 강사는 학생 기록 열람 전용
 *    (원장 2026-08-18). 화면이 드래그를 숨기고 여기서 한 번 더 막는다(#77 이중 방어).
 * 🔴 **날짜는 기록이다** — `enrollments`엔 "언제부터 대기"를 담는 칸이 없다(퇴원은 `end_date`가 있다).
 *    그래서 화면은 저장 즉시 대기로 바뀌고, 고른 날짜는 감사로그(`metadata.date`)에 남아 되짚을 수 있다.
 *    미래 날짜 예약이 필요하면 컬럼(예: `hold_from`) 신설이 선행돼야 한다 — 원장 결정 사항.
 * ⚠️ 이미 종료된 수강은 거절한다(끝난 기록을 되살리는 것처럼 보인다). 이미 대기면 **성공으로 통과**(멱등).
 */
export async function holdSingleEnrollment(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();
  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from("enrollments")
    .select("id, class_id, student_id, end_date, on_hold")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!row) return { error: "수강 기록을 찾을 수 없습니다" };
  if (row.end_date) return { error: "이미 종료된 수강입니다" };

  if (!row.on_hold) {
    const { error } = await supabase.from("enrollments").update({ on_hold: true }).eq("id", enrollmentId);
    if (error) return { error: error.message };
    await logAction({
      action: "enrollment_hold",
      targetType: "student",
      metadata: {
        studentId: studentId || row.student_id,
        classId: row.class_id,
        date,
        source: "timetable_integrated_drag",
      },
    });
  }

  const sid = studentId || row.student_id;
  if (sid) revalidatePath(`/students/${sid}`);
  revalidatePath("/students");
  if (row.class_id) revalidatePath(`/classes/${row.class_id}`);
  revalidatePath("/timetable");
  return undefined;
}

/** 단일 수강 종료 (전체 퇴원과 별개) */
export async function endSingleEnrollment(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 수강 종료 = 학생 쓰기(full) 권한 이상만(master·admin·manager·counselor). UI 숨김 + 이 서버 게이트 이중 방어.
  if (!(await canManageStudentRecords(user.systemRole))) {
    return { error: "수강 종료 권한이 없습니다" };
  }

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || "other";
  const date = String(formData.get("date") ?? "").trim() || kstToday();

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 종료 규약(미래 시작 클램프 + withdrawal_reason)은 공용 원시함수 한 곳에 있다 — 퇴원 다이얼로그의
  // 부분 종료(endStudentEnrollments)도 같은 함수를 돈다(#77: 표면마다 다시 짜면 한쪽만 고쳐진다).
  const res = await endEnrollmentById(supabase, enrollmentId, date, reason);
  if (res.error) return { error: res.error };

  await logAction({
    action: "enrollment_end",
    targetType: "student",
    metadata: {
      studentId: studentId || res.studentId || null,
      classId: res.classId ?? null,
      date: res.endDate,
      reason,
    },
  });

  if (studentId) revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  // 반 상세에서도 바로 종료하므로(원장 2026-09-01) 그 반 화면·목록도 함께 갱신한다 —
  // 호출부의 router.refresh()는 그 문서 하나만 다시 그린다(창이 여러 개면 나머지는 stale).
  if (res.classId) revalidatePath(`/classes/${res.classId}`);
  revalidatePath("/classes");
  return undefined;
}

// ────────────────────── 메모 + 성적 ──────────────────────

export type CreateMemoState = { error?: string; ok?: boolean } | undefined;

export async function createStudentMemo(
  _prev: CreateMemoState,
  formData: FormData,
): Promise<CreateMemoState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "general";
  const content = String(formData.get("content") ?? "").trim();
  // '검색 허용'(0250a) — 체크박스는 꺼져 있으면 아예 안 실려 오므로 **존재 여부**로 읽는다.
  const searchable = formData.get("searchable") !== null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!content) return { error: "메모 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_memos").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    category,
    content,
    searchable,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  // 성공을 undefined로 돌리면 useActionState 소비처가 성공을 감지할 수 없다(성공 시 reset·초안 삭제가 죽는다).
  return { ok: true };
}

export type DeleteMemoState = { error?: string } | undefined;

export async function deleteStudentMemo(
  _prev: DeleteMemoState,
  formData: FormData,
): Promise<DeleteMemoState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "메모 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_memos").delete().eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type UpdateMemoState = { error?: string; ok?: boolean } | undefined;

export async function updateStudentMemo(
  _prev: UpdateMemoState,
  formData: FormData,
): Promise<UpdateMemoState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "general";
  const content = String(formData.get("content") ?? "").trim();
  const searchable = formData.get("searchable") !== null;
  if (!id) return { error: "메모 ID가 누락되었습니다" };
  if (!content) return { error: "메모 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_memos")
    .update({ category, content, searchable, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export type ToggleMemoPinState = { error?: string } | undefined;

export async function toggleStudentMemoPin(
  _prev: ToggleMemoPinState,
  formData: FormData,
): Promise<ToggleMemoPinState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const pinned = String(formData.get("pinned") ?? "false") === "true";
  if (!id) return { error: "메모 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_memos")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type CreateGradeState = { error?: string } | undefined;

export async function createStudentGrade(
  _prev: CreateGradeState,
  formData: FormData,
): Promise<CreateGradeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const examName = String(formData.get("examName") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const scoreStr = String(formData.get("score") ?? "").trim();
  const maxScoreStr = String(formData.get("maxScore") ?? "").trim();
  const takenOn = String(formData.get("takenOn") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!examName) return { error: "시험명을 입력해주세요" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!takenOn) return { error: "시험일을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    exam_name: examName,
    subject,
    score: scoreStr || null,
    max_score: maxScoreStr || null,
    taken_on: takenOn,
    notes,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type DeleteGradeState = { error?: string } | undefined;

export async function deleteStudentGrade(
  _prev: DeleteGradeState,
  formData: FormData,
): Promise<DeleteGradeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const grdLvl = await accessLevelTenant(user.systemRole, "students");
  if (grdLvl !== "full" && grdLvl !== "scoped") return { error: "성적 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "성적 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").delete().eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

// === 레벨테스트(배치/승급/진단) ===
export type LevelTestState = { error?: string } | undefined;

const LEVEL_TEST_TYPES = ["placement", "promotion", "diagnostic"];
// 과목별 세부점수 키 — UI 폼 필드명(sub_<키>)과 일치(client level-tests.tsx와 동기 유지).
const LEVEL_SUBSCORE_KEYS: Record<string, string[]> = {
  math: ["계산", "이해", "추론", "문제해결"],
  english: ["어휘", "문법", "청해", "독해"],
};

export async function createStudentLevelTest(
  _prev: LevelTestState,
  formData: FormData,
): Promise<LevelTestState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const testTypeRaw = String(formData.get("testType") ?? "placement").trim();
  const testType = LEVEL_TEST_TYPES.includes(testTypeRaw) ? testTypeRaw : "placement";
  const subject = String(formData.get("subject") ?? "").trim();
  const testedOn = String(formData.get("testedOn") ?? "").trim();
  const level = String(formData.get("level") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!testedOn) return { error: "시험일을 입력해주세요" };

  const subscores: Record<string, number> = {};
  for (const k of LEVEL_SUBSCORE_KEYS[subject] ?? []) {
    const v = String(formData.get(`sub_${k}`) ?? "").trim();
    if (v !== "" && Number.isFinite(Number(v))) subscores[k] = Number(v);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("level_tests").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    test_type: testType,
    subject,
    tested_on: testedOn,
    level,
    subscores: Object.keys(subscores).length ? subscores : null,
    notes,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export async function deleteStudentLevelTest(
  _prev: LevelTestState,
  formData: FormData,
): Promise<LevelTestState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "레벨테스트 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("level_tests").delete().eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

// === 성적 목표설정(grade_goals) / 성적 코멘트(grade_comments) ===
// 쓰기 권한: 성적(=students) full/scoped. deleteStudentGrade 게이트와 동일.
async function requireGradeWrite() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "students");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "성적 관리 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

export type GoalState = { error?: string; ok?: boolean } | undefined;

export async function createStudentGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const examName = String(formData.get("examName") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const examId = String(formData.get("examId") ?? "").trim() || null;
  const targetStr = String(formData.get("targetScore") ?? "").trim();
  const maxStr = String(formData.get("maxScore") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!examName) return { error: "시험명을 입력해주세요" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!targetStr || !Number.isFinite(Number(targetStr))) return { error: "목표 점수를 입력해주세요" };

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("grade_goals").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    exam_id: examId,
    exam_name: examName,
    subject,
    target_score: Number(targetStr),
    max_score: maxStr && Number.isFinite(Number(maxStr)) ? Number(maxStr) : null,
    reason,
    created_by: user.id,
  });
  if (insErr) return { error: insErr.message };

  revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export async function deleteStudentGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "목표 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error: delErr } = await supabase.from("grade_goals").delete().eq("id", id);
  if (delErr) return { error: delErr.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type GradeCommentState = { error?: string; ok?: boolean } | undefined;

function readCommentForm(formData: FormData) {
  const category = String(formData.get("category") ?? "general").trim();
  const subjectRaw = String(formData.get("subject") ?? "").trim();
  const subject = subjectRaw && subjectRaw !== "all" ? subjectRaw : null;
  const content = String(formData.get("content") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim() || currentPeriod();
  const sharedWithParent = formData.get("sharedWithParent") != null;
  return { category, subject, content, period, sharedWithParent };
}

export async function createStudentGradeComment(
  _prev: GradeCommentState,
  formData: FormData,
): Promise<GradeCommentState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const f = readCommentForm(formData);
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!isCommentCategory(f.category)) return { error: "유효한 카테고리가 아닙니다" };
  if (!f.content) return { error: "코멘트 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("grade_comments").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    category: f.category,
    subject: f.subject,
    content: f.content,
    period: f.period,
    shared_with_parent: f.sharedWithParent,
    author_id: user.id,
  });
  if (insErr) return { error: insErr.message };

  revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export async function updateStudentGradeComment(
  _prev: GradeCommentState,
  formData: FormData,
): Promise<GradeCommentState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const f = readCommentForm(formData);
  if (!id) return { error: "코멘트 ID가 누락되었습니다" };
  if (!isCommentCategory(f.category)) return { error: "유효한 카테고리가 아닙니다" };
  if (!f.content) return { error: "코멘트 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("grade_comments")
    .update({
      category: f.category,
      subject: f.subject,
      content: f.content,
      period: f.period,
      shared_with_parent: f.sharedWithParent,
    })
    .eq("id", id);
  if (updErr) return { error: updErr.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export async function deleteStudentGradeComment(
  _prev: GradeCommentState,
  formData: FormData,
): Promise<GradeCommentState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "코멘트 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error: delErr } = await supabase.from("grade_comments").delete().eq("id", id);
  if (delErr) return { error: delErr.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

/**
 * 동명이인 '의심' 해제 — 사람이 확인해 "실제 다른 학생이 맞다"고 확정하면 dup_suspect=false(배지 제거).
 * (실제로 같은 사람(중복)이면 이 버튼이 아니라 관리자 병합 도구로 합친다.) students 쓰기(full) 권한 필요.
 */
export async function clearDupSuspect(
  studentId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 학생 레코드 변경 = full만 — canWriteTenant는 scoped(강사)도 통과한다(적대 리뷰 F3, #77).
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };
  const id = String(studentId ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("students").update({ dup_suspect: false }).eq("id", id);
  if (error) return { error: error.message };

  // 학생 레코드를 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18). 이 해제는 **통합 후보를 없애는**
  // 판단이기도 하다(중복 병합의 접미사 신호가 이 표식을 본다) — 누가 "다른 사람이 맞다"고 확정했는지
  // 남지 않으면 나중에 되짚을 근거가 0이다.
  await logAction({
    action: "student_dup_confirm",
    targetType: "student",
    metadata: { studentId: id },
  });

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  // 통합 후보 목록(데이터 정리 면)이 이 표식을 읽는다 — 해제하면 그 자리에서 후보가 빠져야 한다.
  revalidatePath("/owner");
  return { ok: true };
}
