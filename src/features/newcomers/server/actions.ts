"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { ONBOARDING_ITEM_KEYS } from "../onboarding-items";

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
 */
export async function setOnboardingCheck(input: {
  studentId: string;
  itemKey: string;
  /** true=완료, false=해제. */
  done: boolean;
  /** 완료일(YYYY-MM-DD). 없으면 오늘 — 뒤늦게 기록할 때 실제 날짜를 넣을 수 있다. */
  doneOn?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "newcomers")))
    return { ok: false, error: "신규생 관리 쓰기 권한이 없습니다" };
  if (!input.studentId) return { ok: false, error: "학생 정보가 없습니다" };
  if (!ONBOARDING_ITEM_KEYS.includes(input.itemKey)) return { ok: false, error: "알 수 없는 항목입니다" };

  const doneOn = input.done ? (/^\d{4}-\d{2}-\d{2}$/.test(input.doneOn ?? "") ? input.doneOn! : kstToday()) : null;
  const admin = createAdminClient();
  // admin은 RLS 우회 — 이 학생이 **이 학원 학생인지**가 유일한 격리선이다.
  const { data: student } = await admin
    .from("students")
    .select("id, name")
    .eq("id", input.studentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!student) return { ok: false, error: "학생을 찾을 수 없습니다" };

  const { error } = await admin.from("student_onboarding_checks").upsert(
    {
      tenant_id: user.tenantId,
      student_id: input.studentId,
      item_key: input.itemKey,
      done_on: doneOn,
      done_by: input.done ? user.id : null,
    },
    // 일반 유니크(0251a)라 이 축으로 추론이 된다 — 부분 유니크였으면 42P10으로 전건 실패한다([[#113]]).
    { onConflict: "tenant_id,student_id,item_key" },
  );
  if (error) {
    const missing = /does not exist|Could not find the table|PGRST205|42P01/i.test(error.message);
    return {
      ok: false,
      error: missing
        ? "신규생 체크 표가 아직 만들어지지 않았습니다(0251a 적용 후 사용할 수 있습니다)"
        : "체크를 저장하지 못했습니다 — 다시 시도해 주세요",
    };
  }
  // 🔴 **쓰기는 감사로그로 남긴다**(원장 2026-09-09 *"기능이 추가되거나 변동되는건 모두 감사로그에
  //    남도록 해야함"*). 이 칸은 "학부모에게 전화했다"는 **사실 주장**이라, 나중에 "안 왔다는데 콜은
  //    했다고 돼 있네"를 되짚을 수 있어야 한다. 체크만큼 **해제**도 남긴다(해제가 더 중요한 흔적이다).
  // ⚠️ `logAction`은 실패해도 조용히 넘어간다(본 작업을 막지 않는다) — 그래서 저장 뒤에 부른다.
  await logAction({
    action: input.done ? "newcomer_check" : "newcomer_uncheck",
    targetType: "student",
    targetLabel: student.name ?? null,
    metadata: { studentId: input.studentId, itemKey: input.itemKey, doneOn },
  });
  revalidatePath("/newcomers");
  return { ok: true };
}
