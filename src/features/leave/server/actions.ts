"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { canSeeStaffMember, STAFF_SCOPE_DENIED_MSG } from "@/features/staff/department/server/subject-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { resolveLeavePeriod } from "../accrual";
import { applyLeaveGrantOverride } from "../test-grants";
import { formatLeaveDays } from "../request-days";
import {
  deltaForTotal,
  formatSignedDays,
  grantedTotal,
  leaveRowMatchesPeriod,
  MAX_LEAVE_DELTA,
  MAX_LEAVE_TOTAL,
  roundDays,
} from "../balance";
import { canAdjustLeave, LEAVE_ADJUST_DENIED_MSG } from "../access";
import { isMissingUsedRangeColumn } from "../missing-used-range";
import { adjustmentDaysFor, reservedLeaveDays } from "./admin";
import { isMissingRelation } from "@/features/approvals/server/queries";
import type { LeaveActionState } from "../action-state";
import { isLeaveEligibleRole } from "../eligibility";

/**
 * 연차 조정 쓰기 — 이월·특별휴가 부여와 정산 차감(원장 2026-09-08).
 *
 * 🔴 게이트는 **화면과 같은 두 문**이다 — 직원관리 메뉴 + 지정(`canAdjustLeave`). 직원관리를 볼 수 있다고 남의
 *    연차까지 고칠 수 있는 건 아니고([[#77]]), 지정됐다고 직원관리가 닫힌 사람이 요청을 만들어 고칠 수 있는 것도 아니다
 *    (지정은 원장이 화면에서 누구에게나 줄 수 있다 — 연차 관리 화면은 직원관리 메뉴 안에 있다).
 * 🔴 직원관리 과목 범위가 걸린 사람은 **범위 안의 직원만** 조정한다 — 연차 관리 표가 범위 안만 보여 주는 것과 같은 판정이다.
 * 🔴 **구간·현재값은 클라를 믿지 않고 서버가 다시 계산한다** — 폼이 보낸 period나 "현재 총 부여"를
 *    그대로 쓰면 오래된 화면(다른 사람이 그 사이 조정한 경우)이 남의 조정을 덮어 쓴 값을 적는다.
 * ⚠️ admin(service_role)은 RLS 우회 — 모든 쿼리에 `tenant_id` 명시 필터([[#104]]).
 */

const MAX_REASON = 200;
// 일수 상한은 화면 미리보기와 **같은 상수**를 읽는다(balance.ts) — 값이 갈리면 버튼은 열려 있는데
// 서버만 거절하거나 그 반대가 된다. MAX_LEAVE_DELTA는 DB check(±100)와 같은 값이다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const TABLE_MISSING_MSG =
  "연차 조정 표가 아직 준비되지 않았습니다 — 마이그레이션 0252a를 적용하면 바로 쓸 수 있습니다";
const USED_RANGE_MISSING_MSG =
  "사용 기간 칸이 아직 준비되지 않았습니다 — 마이그레이션 0270b를 적용하면 쓸 수 있습니다(기간을 비우면 지금도 저장됩니다)";
const REASON_REQUIRED_MSG =
  "사유 없이 저장하려면 마이그레이션 0277a가 필요합니다 — 그전까지는 사유를 적어 주세요";

async function requireAdjuster() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  const [settings, isSuperAdmin, canOpenStaff] = await Promise.all([
    getTenantSettings(),
    isCurrentUserSuperAdmin(),
    canAccessTenant(user.systemRole, "staff"),
  ]);
  if (!canOpenStaff || !canAdjustLeave(user, isSuperAdmin, { adjusterIds: settings.permissions.specialAccess.leaveAdjusterIds })) {
    return { error: LEAVE_ADJUST_DENIED_MSG as string };
  }
  return { user };
}

/** 0.25(반반차) 단위인가 — 연차 차감 해상도와 같은 격자에만 값을 놓는다. */
function isQuarterStep(v: number): boolean {
  return Math.round(v * 100) % 25 === 0;
}

/** 조정 대상 + 그 사람의 현재 구간·부여·사용을 한 번에 확정한다(액션 둘이 공유). */
async function loadTarget(tenantId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, display_name, hire_date, status, system_role")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { error: `직원 조회 실패 — ${error.message}` };
  if (!data) return { error: "대상 직원을 찾을 수 없습니다" };
  if (data.status === "inactive") return { error: "퇴사한 직원의 연차는 조정할 수 없습니다" };
  if (data.system_role === "student") return { error: "학생 계정은 연차 대상이 아닙니다" };
  // 아르바이트도 연차 대상이 아니다(원장 2026-11-05) — 관리 표에서 빠지지만 주소·옛 화면으로 들어온 요청도 막는다.
  if (!isLeaveEligibleRole(data.system_role as string | null)) return { error: "아르바이트는 연차 대상이 아닙니다" };

  const today = kstToday();
  const period = applyLeaveGrantOverride(userId, resolveLeavePeriod((data.hire_date as string | null) ?? null, today), isChinsanTenant(await getTenantSettings()));
  if (!period) {
    return {
      error: "입사일이 등록되지 않아 연차 구간을 계산할 수 없습니다 — 직원관리에서 입사일을 먼저 등록하세요",
    };
  }

  const [adjustment, reserved] = await Promise.all([
    adjustmentDaysFor({ tenantId, userId, period }),
    reservedLeaveDays({ tenantId, userId, period }),
  ]);
  return {
    target: {
      id: userId,
      name: ((data.display_name as string | null) ?? "").trim() || "(이름 없음)",
      period,
      adjustment,
      /** 이미 쓴 + 결재중 — 총 부여를 이 아래로 내리면 잔여가 음수가 된다. */
      reserved,
      currentTotal: grantedTotal(period.granted, adjustment),
    },
  };
}

/**
 * 조정 추가 — 폼은 **가감(±N)** 또는 **총 부여(N일로)** 중 하나로 받고, 저장은 언제나 가감 한 줄이다
 * (0252a: 덮어쓰기가 아니라 행 누적 — 합이 곧 답이고 이력이 곧 근거).
 */
export async function addLeaveAdjustment(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const gate = await requireAdjuster();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const userId = String(formData.get("userId") ?? "").trim();
  if (!UUID_RE.test(userId)) return { error: "대상 직원을 선택하세요" };
  if (!(await canSeeStaffMember(user, userId))) return { error: STAFF_SCOPE_DENIED_MSG };

  // 사유는 **선택**이다(원장 2026-09-21: *"연차관리에 사유없어도 조정기록 되게해줘"*). 0252a는 필수로
  // 잠가 뒀었지만 — 적을 말이 없어 조정을 못 하는 쪽이 더 나쁘다는 판단 — 칸은 두고 비울 수 있게만 했다.
  // 🔑 빈 값은 null이 아니라 **빈 문자열**로 저장한다(0277a 주석: "없음"이 두 가지가 되면 표시가 갈린다).
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length > MAX_REASON) return { error: `사유는 ${MAX_REASON}자를 넘을 수 없습니다` };

  // 실제 휴가 **사용 기간**(0270b, 원장 2026-09-18: *"가감일수가 1일 이상이면 사용일 종료일 이렇게
  // 길게해야지 하루씩만 할수있는게 말이안되자나"*) — 선택 입력이고, 하루면 종료일을 비운다.
  // 이월·특별휴가 부여(+)엔 기간이 없고, 결재 밖에서 쓴 연차를 차감(−)할 때 "언제부터 언제까지 쉬었나"를
  // 사유 문장이 아니라 칸으로 남긴다.
  // 🔴 이 값은 기록·표시용이고 **잔여 산식에는 들어가지 않는다** — 차감은 아래 `delta`가 이미 한다
  //    (기간을 '사용'으로 또 세면 같은 연차가 두 번 깎인다, balance.ts 규약).
  const usedStart = String(formData.get("usedStart") ?? "").trim();
  const usedEnd = String(formData.get("usedEnd") ?? "").trim();
  if (usedStart && !YMD_RE.test(usedStart)) {
    return { error: "사용 시작일은 날짜로 골라 주세요(예: 2026-09-18)" };
  }
  if (usedEnd && !YMD_RE.test(usedEnd)) {
    return { error: "사용 종료일은 날짜로 골라 주세요(예: 2026-09-18)" };
  }
  // 시작 없이 종료만 있는 줄은 뜻이 없다(DB 제약과 같은 판정 — 여기서 한글로 먼저 말한다).
  if (usedEnd && !usedStart) return { error: "사용 시작일을 먼저 고르세요" };
  if (usedStart && usedEnd && usedEnd < usedStart) {
    return { error: "사용 종료일이 시작일보다 앞섭니다" };
  }

  const mode = String(formData.get("mode") ?? "delta") === "total" ? "total" : "delta";
  // 🔴 **빈 칸을 먼저 거른다** — `Number("")`는 NaN이 아니라 **0**이라 그냥 통과하고, '총 부여를 지정'
  //    모드에서 그 0이 "총 0일로"로 읽혀 사유만 적고 엔터를 친 순간 그 직원의 연차가 통째로 0이 된다
  //    (사용 이력이 없으면 하한 검사도 0 < 0이라 안 걸린다 — 적대 리뷰 2026-09-08).
  const daysRaw = String(formData.get("days") ?? "").trim();
  if (!daysRaw) return { error: "일수를 입력하세요" };
  const raw = Number(daysRaw);
  if (!Number.isFinite(raw)) return { error: "일수를 숫자로 입력하세요" };
  if (!isQuarterStep(raw)) return { error: "연차는 0.25일(반반차) 단위로만 조정할 수 있습니다" };

  let loaded;
  try {
    loaded = await loadTarget(user.tenantId, userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "연차 조회 실패" };
  }
  if ("error" in loaded) return { error: loaded.error };
  const { target } = loaded;

  // 🔴 사용 기간은 **그 구간 안**이어야 한다 — 조정 행의 축이 (직원, 연차 구간)이라 구간 밖 날짜를 적으면
  //    내 정보 목록에서 그 줄만 엉뚱한 해에 서고, 정작 그 해 잔여와는 아무 관계가 없어진다. 구간을
  //    서버가 다시 계산해 두었으니(위 loadTarget) 클라가 보낸 날짜를 여기서 가둔다.
  // ⚠️ 양 끝을 **둘 다** 본다 — 시작만 보면 구간 끝을 넘겨 끝나는 기간이 그대로 들어온다.
  const outsidePeriod = [usedStart, usedEnd]
    .filter(Boolean)
    .some((d) => d < target.period.start || d > target.period.end);
  if (outsidePeriod) {
    return {
      error: `사용 기간이 이 연차 구간(${target.period.start} ~ ${target.period.end}) 밖입니다 — 그 날이 속한 구간에서 조정하세요`,
    };
  }

  let delta: number;
  if (mode === "total") {
    const total = roundDays(raw);
    if (total < 0) return { error: "총 부여 일수는 0일보다 작을 수 없습니다" };
    if (total > MAX_LEAVE_TOTAL) return { error: `총 부여 일수는 ${MAX_LEAVE_TOTAL}일을 넘을 수 없습니다` };
    delta = deltaForTotal(total, target.currentTotal);
    if (delta === 0) {
      return { error: `이미 총 ${formatLeaveDays(target.currentTotal)}입니다 — 바뀌는 값이 없습니다` };
    }
  } else {
    delta = roundDays(raw);
    if (delta === 0) return { error: "0일은 조정이 아닙니다 — 늘릴 일수(+)나 줄일 일수(−)를 입력하세요" };
  }
  if (Math.abs(delta) > MAX_LEAVE_DELTA) {
    return { error: `한 번에 조정할 수 있는 일수는 ${MAX_LEAVE_DELTA}일까지입니다` };
  }

  const newTotal = grantedTotal(target.period.granted, roundDays(target.adjustment + delta));
  // 🔴 이미 쓴(승인)·결재중인 일수 아래로는 못 내린다 — 내리면 잔여가 음수가 되는데 화면은 0으로 가려
  //    "다 썼다"처럼 보이고, 정작 승인된 휴가는 그대로 남는다(숫자가 사실과 어긋난 채 조용히 굳는다).
  if (newTotal < target.reserved) {
    return {
      error: `이미 사용·결재중인 ${formatLeaveDays(target.reserved)}보다 적게 조정할 수 없습니다 (요청 결과 ${formatLeaveDays(newTotal)})`,
    };
  }
  // 한 줄 상한(MAX_DELTA)만 두면 가감을 여러 번 쌓아 얼마든지 넘길 수 있다 — **결과 총액**도 막는다
  // (총 부여 모드에서 사용자에게 말한 상한과 같은 값이어야 말이 맞는다).
  if (newTotal > MAX_LEAVE_TOTAL) {
    return {
      error: `총 부여 일수는 ${MAX_LEAVE_TOTAL}일을 넘을 수 없습니다 (요청 결과 ${formatLeaveDays(newTotal)})`,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("leave_adjustments").insert({
    tenant_id: user.tenantId,
    user_id: userId,
    period_start: target.period.start,
    period_end: target.period.end,
    days: delta,
    reason,
    created_by: user.id,
    // 🔑 비었으면 **키 자체를 안 보낸다** — 0270b 미적용 창에서 `used_start: null`만 실어도 PGRST204로
    //    거절돼, 기간을 적지도 않은 사람까지 조정을 못 하게 된다([[#95]] expand/contract).
    ...(usedStart ? { used_start: usedStart } : {}),
    ...(usedEnd ? { used_end: usedEnd } : {}),
  });
  if (error) {
    if (isMissingRelation(error)) return { error: TABLE_MISSING_MSG };
    // 기간을 **적었을 때만** 이 문구 — 무엇을 하면 지금 저장되는지(비우기)까지 함께 말한다.
    if (usedStart && isMissingUsedRangeColumn(error)) return { error: USED_RANGE_MISSING_MSG };
    // 0277a 미적용 창 — 빈 사유를 DB가 아직 막는다(23514). 영문 제약 이름 대신 할 일을 한글로 말한다.
    if (!reason && /leave_adjustments_reason_present/.test(error.message ?? "")) {
      return { error: REASON_REQUIRED_MSG };
    }
    return { error: `저장 실패 — ${error.message}` };
  }

  await logAction({
    action: "leave_adjust",
    targetType: "user",
    targetLabel: target.name,
    metadata: {
      days: delta,
      before: target.currentTotal,
      after: newTotal,
      period: `${target.period.start} ~ ${target.period.end}`,
      reason,
      // 사용 기간까지 남긴다 — 나중에 "이 차감이 언제 쓴 연차였나"를 로그만으로도 되짚게.
      usedStart: usedStart || null,
      usedEnd: usedEnd || null,
    },
  });
  revalidatePath("/staff/annual-leave");
  revalidatePath("/approvals"); // 본인 결재함의 연차 현황(잔여)도 바뀐다
  revalidatePath("/me"); // 내 정보의 연차 카드(부여·잔여·조정 이력)도 바뀐다
  return {
    ok: true,
    notice: `${target.name} 연차 ${formatSignedDays(delta)} — 총 ${formatLeaveDays(newTotal)}`,
  };
}

/**
 * 조정 취소(행 삭제) — 잘못 적은 한 줄을 되돌린다. 감사로그가 삭제 사실을 남긴다.
 *
 * 🔑 `loadTarget`을 쓰지 않는다 — 그쪽은 **새 조정을 넣을 수 있는가**를 묻는 문(재직·입사일 필수)이라,
 *    퇴사했거나 입사일이 비는 사람의 잘못된 행을 **영영 못 지우는** 막다른 길이 된다. 지우는 것은
 *    자격을 늘리지 않으므로 그 조건을 요구하지 않고, **잔여 하한만** 같은 구간일 때 확인한다.
 */
export async function deleteLeaveAdjustment(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const gate = await requireAdjuster();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("adjustmentId") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "삭제할 조정을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: row, error: readError } = await admin
    .from("leave_adjustments")
    .select("id, user_id, days, reason, period_start, period_end")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readError) {
    return { error: isMissingRelation(readError) ? TABLE_MISSING_MSG : `조회 실패 — ${readError.message}` };
  }
  if (!row) return { error: "이미 삭제된 조정입니다" };

  const targetId = String(row.user_id);
  if (!(await canSeeStaffMember(user, targetId))) return { error: STAFF_SCOPE_DENIED_MSG };
  const { data: person } = await admin
    .from("users")
    .select("display_name, hire_date")
    .eq("id", targetId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const name = ((person?.display_name as string | null) ?? "").trim() || "(이름 없음)";
  const period = applyLeaveGrantOverride(
    targetId,
    resolveLeavePeriod((person?.hire_date as string | null) ?? null, kstToday()),
    isChinsanTenant(await getTenantSettings()),
  );

  const removed = Number(row.days) || 0;
  // 지난 구간의 행이면 지금 잔여와 무관하다 — 현재 구간의 사용량으로 옛 행을 막으면 영영 못 지운다.
  const samePeriod =
    period !== null &&
    leaveRowMatchesPeriod(
      { periodStart: String(row.period_start), periodEnd: String(row.period_end) },
      period,
    );
  let after: number | null = null;
  if (samePeriod) {
    let adjustment: number;
    let reserved: number;
    try {
      [adjustment, reserved] = await Promise.all([
        adjustmentDaysFor({ tenantId: user.tenantId, userId: targetId, period }),
        reservedLeaveDays({ tenantId: user.tenantId, userId: targetId, period }),
      ]);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "연차 조회 실패" };
    }
    after = grantedTotal(period.granted, roundDays(adjustment - removed));
    if (after < reserved) {
      return {
        error: `이 조정을 지우면 총 ${formatLeaveDays(after)}이 되어 이미 사용·결재중인 ${formatLeaveDays(reserved)}보다 적어집니다`,
      };
    }
  }

  const { error } = await admin
    .from("leave_adjustments")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { error: `삭제 실패 — ${error.message}` };

  await logAction({
    action: "leave_adjust_delete",
    targetType: "user",
    targetLabel: name,
    metadata: {
      days: removed,
      // 지난 구간이면 "총 몇 일이 됐는지"를 모른다 — 현재 구간 숫자를 적으면 딴 구간의 사실이 된다.
      ...(after === null ? {} : { after }),
      period: `${row.period_start} ~ ${row.period_end}`,
      reason: String(row.reason ?? ""),
    },
  });
  revalidatePath("/staff/annual-leave");
  revalidatePath("/approvals"); // 본인 결재함의 연차 현황(잔여)도 바뀐다
  revalidatePath("/me"); // 내 정보의 연차 카드에서도 그 줄이 사라진다
  return { ok: true, notice: `${name} 연차 조정 ${formatSignedDays(removed)}을 취소했습니다` };
}
