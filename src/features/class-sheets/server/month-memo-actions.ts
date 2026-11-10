"use server";

/**
 * ECS 월간 **특이사항 메모** 저장(0246a) — 달력 보기의 월간계획 아래 한 칸.
 *
 * 원장 2026-09-03: *"인재원 영어의 강사시트 달력뷰에서 특이사항 메모할 수 있는 메모란을 추가해야겠어.
 * 월별 계획 아래쪽에 추가하면 될듯."*
 *
 * 🔴 게이트는 `requireEcsClassAccess(classId, { write: true })` 하나 — 목표·계획과 **같은 문**이다.
 *    화면에서 입력칸을 감추는 건 게이트가 아니다([[#77]]).
 * 🔴 계획(MP)과 달리 **EiE 조건을 걸지 않는다.** MP는 EiE 반에만 있는 서식이지만 특이사항 메모는
 *    그냥 메모라, 인재원 영어에서 못 쓰게 할 이유도 EiE에서 못 쓰게 할 이유도 없다.
 * 🔑 빈 문자열 = **행 삭제**. MP 칸과 달리 여기엔 "칸은 남기고 비운다"는 뜻이 없다(칸이 늘 하나다).
 *
 * ⚠️ `class_sheet_month_memos`는 RLS 정책 0개(service_role 전용)라 admin으로 쓰되 **모든 조건에
 *    `tenant_id`를 명시**한다([[#104]]).
 * ⚠️ 0246a 미적용이면 저장이 실패한다 — 원문 대신 **한글로** 아직 준비 중임을 말한다([[#95]]).
 * ⚠️ 이 파일은 `"use server"`라 **async 함수만 export**할 수 있다([[#119]]).
 */
import { isMissingRelation } from "@/lib/supabase/db-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEcsClassAccess } from "./access";

/** 0246a `body` CHECK와 같은 값 — 서버가 먼저 걸러 DB 오류 원문이 화면에 뜨지 않게 한다. */
const MAX_BODY = 2000;
const MONTH_RE = /^\d{4}-\d{2}$/;

type MemoSaveResult = { ok: true } | { ok: false; error: string };

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  return isMissingRelation(err, "class_sheet_month_memos"); // 표 이름 + 없음 코드(공용 판정, P1-E)
}

export async function saveMonthMemo(input: {
  classId: string;
  /** "YYYY-MM" — 서버가 그 달 1일로 굳혀 저장한다(문자열 달은 표기가 갈린다). */
  month: string;
  body: string;
}): Promise<MemoSaveResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!MONTH_RE.test(input.month ?? "")) return { ok: false, error: "잘못된 요청입니다(달)" };

  const body = (input.body ?? "").trim();
  if (body.length > MAX_BODY) return { ok: false, error: `메모는 ${MAX_BODY}자 이내로 입력하세요` };

  const admin = createAdminClient();
  const { tenantId, user } = gate.access;
  const first = `${input.month}-01`;

  if (body === "") {
    const { error } = await admin
      .from("class_sheet_month_memos")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("month", first);
    if (error) {
      if (isMissingTable(error)) return { ok: false, error: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요)" };
      return { ok: false, error: "저장에 실패했습니다" };
    }
    return { ok: true };
  }

  const { error } = await admin.from("class_sheet_month_memos").upsert(
    {
      tenant_id: tenantId,
      class_id: input.classId,
      month: first,
      body,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    // 술어 없는 일반 유니크라 추론이 된다([[#113]] — 부분 유니크였다면 여기서 42P10으로 전건 실패).
    { onConflict: "tenant_id,class_id,month" },
  );
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: "메모 칸은 아직 준비 중입니다(관리자에게 문의하세요)" };
    return { ok: false, error: "저장에 실패했습니다" };
  }
  return { ok: true };
}
