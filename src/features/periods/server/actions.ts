"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { periodsTag } from "./queries";

// 세션 기간(operating_periods) 저장 — /owner "세션 기간" 탭에서 호출.
//
// ⚠️ 하드코딩 master 체크 금지(#58) — 원장이 역할·권한에서 owner를 위임하면 여기도 함께 열려야 한다.
// ⚠️ operating_periods는 RLS 정책 0개(service_role 전용, 0189a)라 **게이트는 이 액션이 유일한 방어**다.
//    admin client는 RLS를 우회하므로 tenant_id를 반드시 코드로 건다(사용자 입력에서 받지 않는다).

export type PeriodsActionState = { error?: string; ok?: boolean; saved?: number } | undefined;

type IncomingRow = { labelMonth: number; startDate: string; endDate: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 클라가 보낸 행을 **서버에서 다시 검증**한다. 클라 파서는 UX용일 뿐이고,
 * 이 표는 청구·급여가 읽으므로 서버가 통과시킨 값만 진실이다.
 */
function validate(raw: unknown, year: number): { rows: IncomingRow[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "저장할 세션 목록을 읽지 못했습니다" };
  if (raw.length > 24) return { error: "한 해에 세션은 24개를 넘을 수 없습니다" };

  const rows: IncomingRow[] = [];
  const months = new Set<number>();
  for (const r of raw) {
    if (!r || typeof r !== "object") return { error: "세션 항목의 형식이 올바르지 않습니다" };
    const { labelMonth, startDate, endDate } = r as Record<string, unknown>;
    const m = Number(labelMonth);
    if (!Number.isInteger(m) || m < 1 || m > 12) return { error: "월은 1~12만 저장할 수 있습니다" };
    if (typeof startDate !== "string" || !YMD.test(startDate)) return { error: `${m}월 시작 날짜가 올바르지 않습니다` };
    if (typeof endDate !== "string" || !YMD.test(endDate)) return { error: `${m}월 끝 날짜가 올바르지 않습니다` };
    if (startDate > endDate) return { error: `${m}월은 끝 날짜가 시작 날짜보다 빠릅니다` };
    if (months.has(m)) return { error: `${m}월이 두 번 있습니다 — 한 달에 세션은 하나입니다` };
    // 라벨 연도와 너무 동떨어진 날짜(오타 방어). 세션은 라벨월을 넘길 수 있지만 해를 통째로 벗어나진 않는다.
    const sy = Number(startDate.slice(0, 4));
    if (sy < year - 1 || sy > year + 1) return { error: `${m}월 날짜가 ${year}년과 너무 멉니다 — 연도를 확인해주세요` };
    months.add(m);
    rows.push({ labelMonth: m, startDate, endDate });
  }
  return { rows };
}

/** DB 제약 위반을 사람 말로 (raw 코드 노출 금지). */
function humanize(code: string | undefined, message: string): string {
  if (code === "23P01") return "세션 기간이 서로 겹칩니다 — 앞 세션의 끝과 다음 세션의 시작을 확인해주세요";
  if (code === "23505") return "같은 달에 세션이 두 개입니다 — 한 달에 하나만 저장할 수 있습니다";
  if (code === "23503") return "선택한 반을 찾을 수 없습니다";
  if (code === "42P01") return "세션 기간 표가 아직 만들어지지 않았습니다 — 마이그레이션(0189a)을 먼저 적용해주세요";
  if (code === "42883") return "세션 저장 함수가 없습니다 — 마이그레이션(0189a)을 먼저 적용해주세요";
  console.error("[periods] 저장 실패", code, message);
  return "저장하지 못했습니다. 잠시 후 다시 시도해주세요";
}

export async function savePeriodsForSubject(
  _prev: PeriodsActionState,
  formData: FormData,
): Promise<PeriodsActionState> {
  const g = await gate();
  if ("error" in g) return g;

  const subjectKey = String(formData.get("subjectKey") ?? "").trim();
  const year = Number(formData.get("year"));
  const classIdRaw = String(formData.get("classId") ?? "").trim();
  const classId = classIdRaw === "" ? null : classIdRaw;
  const rowsRaw = String(formData.get("rows") ?? "[]");

  if (!subjectKey) return { error: "과목을 선택해주세요" };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "연도를 확인해주세요" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rowsRaw);
  } catch {
    return { error: "저장할 세션 목록을 읽지 못했습니다" };
  }
  const checked = validate(parsed, year);
  if ("error" in checked) return checked;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("save_operating_periods", {
    p_tenant: g.user.tenantId,
    p_subject: subjectKey,
    p_class: classId,
    p_year: year,
    p_rows: checked.rows,
    p_user: g.user.id,
  });
  if (error) return { error: humanize(error.code, error.message) };

  await logAction({
    action: "operating_periods_save",
    targetType: "operating_periods",
    targetLabel: `${year}년 ${subjectKey} 세션 ${checked.rows.length}건`,
  });

  // 세션은 출석부·청구·급여가 읽는다 → 캐시 무효화 + 소비처 라우트 갱신.
  updateTag(periodsTag(g.user.tenantId)); // server action 전용 read-your-writes(즉시)
  revalidatePath("/owner");
  revalidatePath("/attendance");

  return { ok: true, saved: typeof data === "number" ? data : checked.rows.length };
}
