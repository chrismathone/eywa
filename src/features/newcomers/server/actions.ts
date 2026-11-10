"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { ONBOARDING_ITEM_KEYS } from "../onboarding-items";
import { ANY_SUBJECT, isSubjectKey } from "../subject-rows";
import { isMissingSubjectColumn } from "./cohort";
import { studentTakesSubject } from "./consult-link";
import { completionMemo, type Completion } from "../completion";

/**
 * 신규생 체크리스트 한 칸 — 완료/해제(0251a `student_onboarding_checks`).
 *
 * 🔴 게이트는 메뉴 쓰기 권한 하나(`canWriteTenant("newcomers")`) — 강사는 readonly라 통과하지 못한다
 *    (학생 기록을 강사가 못 바꾸게 한 2026-08-18 결정과 같은 결). 화면에서 감추는 것은 게이트가 아니다([[#77]]).
 * 🔴 항목 키는 **앱 상수에 있는 것만** 받는다 — 임의 문자열이 들어오면 화면에 안 보이는 유령 행이 쌓인다.
 * 🔴 해제는 **행을 지우지 않고** `done_on`을 비운다 — 메모·처리자 기록이 함께 사라지면 "누가 체크했다 풀었나"를
 *    되짚을 수 없다.
 * 🔴 **쓰기는 admin 클라이언트**다 — 0251a는 0242a·0247a와 같은 설계라 **select 정책만** 있고, 세션
 *    클라이언트로 upsert하면 RLS가 조용히 거부한다(표가 생기는 순간 터지는 종류라 적대적 리뷰가 잡았다).
 *    admin은 RLS를 우회하므로 ① `tenant_id`를 명시해 쓰고 ② **그 학생이 이 학원 학생인지 먼저 확인**한다
 *    (안 하면 남의 학원 학생 id로 이 학원에 유령 체크 행이 생긴다).
 * ⚠️ 0251a 미적용이면 표가 없다 — 그때는 한글로 그 사실을 돌려준다(영문 원문 노출 금지).
 * 🔴 **과목별로 저장한다**(0256a, 원장 2026-09-10 "과목별로 따로") — 수학 사전 콜과 영어 사전 콜은 다른 사람이
 *    거는 다른 전화다. 화면이 보낸 과목은 **서버가 다시 확인한다**([[#77]]): 그 학생이 그 과목 반을 실제로
 *    듣고 있어야 한다(안 그러면 화면에 안 보이는 과목으로 유령 체크가 쌓인다).
 * ⚠️ 0256a가 아직 안 돌았으면 과목 칸이 없다 — 그때는 **옛 모양(학생 단위)** 으로 저장한다([[#95]]).
 *    화면은 그 사실을 배너로 밝힌다(과목별로 보이지만 체크는 두 과목에 함께 걸린다).
 */
export async function setOnboardingCheck(input: {
  studentId: string;
  /** 과목 키 — 그 줄의 과목. null/빈 값이면 과목 무관(수강이 없는 학생 줄). */
  subject?: string | null;
  itemKey: string;
  /** true=완료, false=해제. */
  done: boolean;
  /** 완료일(YYYY-MM-DD). 없으면 오늘 — 뒤늦게 기록할 때 실제 날짜를 넣을 수 있다. */
  doneOn?: string;
  /** 완료할 때 = 실행한 액션 + 처리 결과(필수). 체크만으로 끝내지 않는다(aywa-next 인계 — 근거 있는 완료). */
  completion?: Completion;
}): Promise<{ ok: boolean; error?: string; doneOn?: string | null }> {
  // 다른 강사 뷰면 그 강사 권한으로 판정한다(#154) — 강사·담당만(scoped)은 관리 콜을 완료하지 않는다(적응 피드백만 남긴다).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (user.tenantView) return { ok: false, error: "현재 보기에서는 완료 기록을 변경할 수 없습니다" };
  if (user.systemRole === "teacher" || (await accessLevelTenant(user.systemRole, "newcomers")) === "scoped")
    return { ok: false, error: "관리 콜 완료는 관리자가 처리합니다. 담당 학생의 적응 피드백을 남겨 주세요." };
  if (!(await canWriteTenant(user.systemRole, "newcomers")))
    return { ok: false, error: "신규생 관리 쓰기 권한이 없습니다" };
  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };
  if (!ONBOARDING_ITEM_KEYS.includes(input.itemKey)) return { ok: false, error: "알 수 없는 항목입니다" };
  const subject = (input.subject ?? ANY_SUBJECT).trim();
  if (subject !== ANY_SUBJECT && !isSubjectKey(subject)) return { ok: false, error: "알 수 없는 과목입니다" };

  let memo: string | undefined;
  if (input.done) {
    try { memo = completionMemo(input.completion); }
    catch { return { ok: false, error: "실행한 액션과 처리 결과를 입력해 주세요" }; }
  }
  const today = kstToday();
  const doneOn = input.done ? (input.doneOn ?? today) : null;
  if (doneOn && (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn) || Number.isNaN(Date.parse(`${doneOn}T00:00:00Z`)) || doneOn > today))
    return { ok: false, error: "실제 수행일을 확인해 주세요. 미래 일자는 완료 처리할 수 없습니다" };
  const admin = createAdminClient();
  // admin은 RLS 우회 — 이 학생이 **이 학원 학생인지**가 유일한 격리선이다.
  const { data: student } = await admin
    .from("students")
    .select("id, name")
    .eq("id", input.studentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!student) return { ok: false, error: "학생을 찾을 수 없습니다" };

  // 🔴 과목은 **그 학생이 실제로 듣는 과목**이어야 한다([[#77]]) — 반은 학생 한 명분이라 수 개뿐이다.
  if (subject !== ANY_SUBJECT) {
    const takes = await studentTakesSubject(admin, user.tenantId, input.studentId, subject);
    if (!takes.ok) return { ok: false, error: "체크를 저장하지 못했습니다 — 다시 시도해 주세요" };
    if (!takes.takes) return { ok: false, error: "이 학생은 그 과목을 듣지 않습니다" };
  }

  const record = {
    tenant_id: user.tenantId,
    student_id: input.studentId,
    item_key: input.itemKey,
    done_on: doneOn,
    done_by: input.done ? user.id : null,
    ...(memo ? { memo } : {}),
  };
  // 일반 유니크라 이 축으로 추론이 된다 — 부분 유니크였으면 42P10으로 전건 실패한다([[#113]]).
  let { error } = await admin
    .from("student_onboarding_checks")
    .upsert({ ...record, subject }, { onConflict: "tenant_id,student_id,subject,item_key" });
  let storedSubject: string = subject;
  if (error && isMissingSubjectColumn(error)) {
    // 0256a 미적용 — 과목 칸이 없다. 옛 모양(학생 단위)으로 저장한다([[#95]]).
    ({ error } = await admin
      .from("student_onboarding_checks")
      .upsert(record, { onConflict: "tenant_id,student_id,item_key" }));
    storedSubject = ANY_SUBJECT;
  }
  if (error) {
    const missing = /does not exist|Could not find the table|PGRST205|42P01/i.test(error.message);
    return {
      ok: false,
      error: missing
        ? "신규생 체크 표가 아직 만들어지지 않았습니다(0251a 적용 후 사용할 수 있습니다)"
        : "체크를 저장하지 못했습니다 — 다시 시도해 주세요",
    };
  }
  // 손으로 바꾼 칸은 더 이상 "상담으로 한 체크"가 아니다(0295a) — 연결을 끊어야 그 상담을 지우거나 고칠 때
  // 이 손 체크가 함께 풀리지 않는다. 컬럼이 아직 없으면(0295a 전) 끊을 연결도 없다 — 오류는 무시한다.
  const unlinked = await admin
    .from("student_onboarding_checks")
    .update({ consultation_id: null })
    .eq("tenant_id", user.tenantId)
    .eq("student_id", input.studentId)
    .eq("subject", storedSubject)
    .eq("item_key", input.itemKey)
    .not("consultation_id", "is", null);
  // 컬럼 부재(0295a 전)만 조용히 넘긴다 — 다른 실패는 남겨야 "상담을 지웠더니 손 체크가 풀렸다"를 되짚는다.
  if (unlinked.error && !/consultation_id/i.test(unlinked.error.message))
    console.error("[newcomers] clear consultation link:", unlinked.error.message);

  // 🔴 **쓰기는 감사로그로 남긴다**(원장 2026-09-09 *"기능이 추가되거나 변동되는건 모두 감사로그에
  //    남도록 해야함"*). 이 칸은 "학부모에게 전화했다"는 **사실 주장**이라, 나중에 "안 왔다는데 콜은
  //    했다고 돼 있네"를 되짚을 수 있어야 한다. 체크만큼 **해제**도 남긴다(해제가 더 중요한 흔적이다).
  // ⚠️ `logAction`은 실패해도 조용히 넘어간다(본 작업을 막지 않는다) — 그래서 저장 뒤에 부른다.
  await logAction({
    action: input.done ? "newcomer_check" : "newcomer_uncheck",
    targetType: "student",
    targetLabel: student.name ?? null,
    // 🔴 과목도 남긴다 — "영어 콜은 했다는데"를 되짚으려면 어느 과목의 체크였는지가 필요하다.
    //    `subjectStored`는 실제로 저장된 축이다(0256a 전이면 과목 무관으로 떨어진다).
    metadata: { studentId: input.studentId, itemKey: input.itemKey, doneOn, subject, subjectStored: storedSubject },
  });
  revalidatePath("/newcomers");
  // 화면을 연 뒤 KST 날짜가 바뀌어도 실제 저장한 완료일을 표시한다.
  return { ok: true, doneOn };
}
