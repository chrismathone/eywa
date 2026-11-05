import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { compareByJobRank } from "@/features/approvals/job-rank";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { resolveLeavePeriod, type LeavePeriod } from "../accrual";
import { applyLeaveGrantOverride } from "../test-grants";
import {
  grantedTotal,
  leaveRowMatchesPeriod,
  remainingDays,
  roundDays,
  sumAdjustments,
  type LeaveAdjustmentRow,
  type PeriodWindow,
} from "../balance";
import { isMissingUsedRangeColumn } from "../missing-used-range";
import { isLeaveEligibleRole } from "../eligibility";
// 표 미적용 판정(PGRST205·42P01…)은 전자결재 쪽과 **같은 헬퍼**를 쓴다 — 실패 모양을 두 번 정의하면
// 한쪽만 새 오류 코드를 배운다. ⚠️ 다만 **문구는 여기서 쓴다**(아래 `describeOverviewError`):
// 그쪽 문구는 "결재 문서를 볼 권한이 없습니다"라 직원관리 화면에서는 남의 시스템 얘기가 된다.
import { isMissingRelation, type LeaveLoadError } from "@/features/approvals/server/queries";

/**
 * 연차 관리(직원관리) 조회 — 직원별 **부여·조정·사용·잔여**를 한 표로.
 *
 * 🔴 **admin 클라이언트 + `tenant_id` 명시 필터**([[#104]]). 남의 연차를 보는 화면이라 세션 RLS로는
 *    본인 행만 나오고(0252a 정책이 self-read), leave_forms도 결재 관계자만 읽힌다 — 그래서 서버가
 *    권한(`canAdjustLeave`)을 먼저 확인하고 admin으로 읽는다. 호출부(page)가 게이트를 통과시킨다.
 *
 * 🔑 잔여 산식은 [`balance.ts`](../../leave/balance.ts) **한 곳**에서 온다 — 내 연차 현황(getMyLeaveBalance)·
 *    기안 거절(submitLeaveDraft)과 같은 식이라 "화면엔 18일인데 기안은 15일까지"가 안 생긴다.
 *
 * ⚠️ 0252a 미적용이어도 **화면은 산다**([[#95]]) — 조정 조회만 fail-soft로 비우고 `tableReady=false`를
 *    올려 편집을 잠근다(법정 부여·사용·잔여는 그대로 보인다).
 */

export type LeaveOverviewRow = {
  userId: string;
  name: string;
  jobTitle: string | null;
  hireDate: string | null;
  /** 입사일이 없으면 null — 그 행은 계산도 조정도 못 한다(화면이 "입사일 미등록"으로 안내). */
  period: LeavePeriod | null;
  /** 법정 계산분(입사일 기준). 테스트 부여 오버라이드가 있으면 그 값. */
  legalGranted: number;
  /** 조정 합계(+이월 / −차감). */
  adjustment: number;
  /** 총 부여 = 법정 + 조정. */
  granted: number;
  used: number;
  pending: number;
  remaining: number;
  /** 이 구간의 조정 이력(최신순). 창에서 그대로 보여 주고 삭제한다. */
  adjustments: LeaveAdjustmentRow[];
};

export type LeaveOverview = {
  rows: LeaveOverviewRow[];
  /** 0252a 적용 여부 — false면 화면이 배너를 띄우고 조정 버튼을 잠근다. */
  tableReady: boolean;
  /**
   * 사용 기간 칸(0270b) 적용 여부 — false면 조정 창의 **사용 기간 입력만** 잠근다(일수·사유는 그대로).
   * 🔴 `tableReady`와 따로 두는 이유: 컬럼만 없는 창에서 조정 기능 전체를 잠그면, 이미 되는 일까지
   *    못 하게 된다([[#95]] expand/contract는 "덜 되게"가 아니라 "그만큼만 되게"다).
   */
  usedRangeReady: boolean;
  loadError?: LeaveLoadError;
};

type StaffRaw = {
  id: string;
  display_name: string | null;
  job_title: string | null;
  hire_date: string | null;
  subjects: string[] | null;
};

type FormRaw = {
  user_id: string;
  period_start: string;
  period_end: string;
  days: number | string;
  doc: { status?: string } | null;
};

type AdjRaw = {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  days: number | string;
  reason: string;
  created_at: string;
  created_by: string | null;
  /** 0270b 미적용 창에서는 아예 안 실려 온다(선택 필드) — 그 창에선 화면도 날짜 자리를 비운다. */
  used_start?: string | null;
  used_end?: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 조회 실패 → **이 화면의 한글 한 줄**. 원문은 툴팁으로만 나간다(UI에 영문 원문 노출 금지).
 * 🔴 전자결재의 `describeLoadError`를 그대로 쓰면 직원관리 화면에 "결재 문서를 볼 권한이 없습니다"가
 *    뜬다 — 사실이 아닌 안내다(적대 리뷰 2026-09-09).
 */
function describeOverviewError(e: unknown): LeaveLoadError {
  const raw = e instanceof Error ? e.message : String(e);
  if (/42P17|infinite recursion/i.test(raw)) {
    return { summary: "연차 데이터 접근 정책에 문제가 있습니다 — 관리자에게 알려주세요", raw };
  }
  if (isMissingRelation({ message: raw })) return { summary: "연차 표가 아직 준비되지 않았습니다", raw };
  if (/permission denied|42501/i.test(raw)) return { summary: "직원 연차를 볼 권한이 없습니다", raw };
  return { summary: "연차 현황을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요", raw };
}

/**
 * 활성 직원(학생·아르바이트 제외) — 연차 대상만. 결재선 후보(학생만 제외)보다 아르바이트만큼 좁다
 * (원장 2026-11-05 *"아르바이트생에게 연차 기능 필요없음"* — 판정은 `isLeaveEligibleRole` 한 곳).
 * ⚠️ 아르바이트는 **JS에서** 거른다 — SQL 필터에 'parttime'을 넣으면 그 열거형 값이 없는 DB(s2_0024 전)에서 22P02로 표 전체가 죽는다(2026-11-05 리뷰).
 */
async function activeStaff(tenantId: string): Promise<StaffRaw[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, display_name, job_title, hire_date, subjects, system_role")
    .eq("tenant_id", tenantId)
    .neq("status", "inactive")
    .neq("system_role", "student")
    .limit(500); // 학원 직원 수(수십)의 한참 위 — 절단 방지용 명시 상한(B2)
  if (error) throw new Error(error.message);
  return ((data ?? []) as (StaffRaw & { system_role: string | null })[]).filter((u) => isLeaveEligibleRole(u.system_role));
}

/**
 * 조정 행 조회(구간 무관 전건 → 호출부가 구간으로 거른다).
 * 표가 없으면 `null`을 돌려준다 — **빈 배열과 구분해야** 한다(빈 배열이면 화면이 "조정 없음"이라는
 * 사실을 주장하게 되는데, 실제로는 아직 모르는 상태다).
 */
const ADJ_COLS = "id, user_id, period_start, period_end, days, reason, created_at, created_by";

async function selectAdjustments(
  tenantId: string,
  userIds: string[],
  withRange: boolean,
): Promise<AdjRaw[]> {
  const admin = createAdminClient();
  const cols = withRange ? `${ADJ_COLS}, used_start, used_end` : ADJ_COLS;
  return await fetchAllPagedInChunks<AdjRaw>(userIds, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("leave_adjustments")
      .select(cols)
      .eq("tenant_id", tenantId)
      .in("user_id", chunk)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // OFFSET 페이지가 흔들리지 않게 unique tie-break
      .range(from, to);
    return { data: (data ?? []) as unknown as AdjRaw[], error };
  });
}

/** 조정 조회 결과 — 행과 "사용 기간 칸이 있었나"를 함께 돌려준다(화면이 입력을 잠글 근거). */
type AdjLoad = { rows: AdjRaw[] | null; usedRangeReady: boolean };

async function loadAdjustments(tenantId: string, userIds: string[]): Promise<AdjLoad> {
  try {
    return { rows: await selectAdjustments(tenantId, userIds, true), usedRangeReady: true };
  } catch (e) {
    // 표 미적용(0252a 전)만 조용히 넘긴다 — 그 밖의 실패는 화면이 알아야 한다.
    if (isMissingRelation({ message: e instanceof Error ? e.message : String(e) })) {
      return { rows: null, usedRangeReady: false };
    }
    // 사용 기간 칸(0270b)만 없는 창 — 그 칸을 빼고 다시 읽는다([[#95]]). 표는 이미 있어 조정 합계·이력은
    // 그대로 보여야 하고, 비는 것은 날짜 자리뿐이다.
    if (isMissingUsedRangeColumn(e)) {
      return { rows: await selectAdjustments(tenantId, userIds, false), usedRangeReady: false };
    }
    throw e;
  }
}

export async function getLeaveOverview(
  tenantId: string,
  /** 보는 사람에게 보이는 직원인가 — 직원관리 과목 범위가 걸린 사람에게만 넘긴다(없으면 전원). 조회 전에 거른다. */
  visible?: (staff: { id: string; subjects: readonly string[] }) => boolean,
): Promise<LeaveOverview> {
  const today = kstToday();
  let staff: StaffRaw[];
  // 조정 줄의 기록자 이름은 **거르기 전** 직원 전체에서 찾는다 — 보이는 직원으로만 만들면 범위 밖 사람이 적은 줄의 이름이 빈다.
  let everyone: StaffRaw[];
  try {
    everyone = await activeStaff(tenantId);
    staff = visible ? everyone.filter((s) => visible({ id: s.id, subjects: Array.isArray(s.subjects) ? s.subjects : [] })) : everyone;
  } catch (e) {
    return { rows: [], tableReady: false, usedRangeReady: false, loadError: describeOverviewError(e) };
  }
  const ids = staff.map((s) => s.id);
  const admin = createAdminClient();

  // 세 조회는 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  let forms: FormRaw[] = [];
  let adjLoad: AdjLoad = { rows: null, usedRangeReady: false };
  let settings: Awaited<ReturnType<typeof getTenantSettings>>;
  try {
    [forms, adjLoad, settings] = await Promise.all([
      fetchAllPagedInChunks<FormRaw>(ids, async (chunk, from, to) => {
        const { data, error } = await admin
          .from("leave_forms")
          // ⚠️ 임베드엔 FK 이름을 명시한다 — 안 적으면 남이 컬럼 하나 더한 날 PGRST201로 죽는다([[#94]]).
          .select(
            "user_id, period_start, period_end, days, doc:approval_documents!leave_forms_document_id_fkey(status)",
          )
          .eq("tenant_id", tenantId)
          .in("user_id", chunk)
          .order("document_id", { ascending: true })
          .range(from, to);
        // 1:1 임베드는 런타임에 **객체**로 오는데 생성 타입은 배열이다(queries.ts도 같은 자리에서 캐스팅).
        return { data: (data ?? []) as unknown as FormRaw[], error };
      }),
      loadAdjustments(tenantId, ids),
      getTenantSettings(), // React cache — 레이아웃이 이미 부른 요청이면 왕복 0
    ]);
  } catch (e) {
    return { rows: [], tableReady: false, usedRangeReady: false, loadError: describeOverviewError(e) };
  }

  // 아래 판정·반환이 읽는 이름은 그대로 둔다(`tableReady: adjRows !== null`) — 조회 결과를 감싸는
  // 그릇만 바뀌었고 "표가 있었나"의 뜻은 같다.
  const adjRows = adjLoad.rows;
  const nameById = new Map(everyone.map((s) => [s.id, (s.display_name ?? "").trim() || "(이름 없음)"]));

  const rows: LeaveOverviewRow[] = staff.map((s) => {
    const hireDate = s.hire_date ?? null;
    const period = applyLeaveGrantOverride(s.id, resolveLeavePeriod(hireDate, today), isChinsanTenant(settings));
    const legalGranted = period?.granted ?? 0;

    const mine = period
      ? (adjRows ?? []).filter(
          (a) =>
            a.user_id === s.id &&
            leaveRowMatchesPeriod({ periodStart: a.period_start, periodEnd: a.period_end }, period),
        )
      : [];
    const adjustment = sumAdjustments(mine.map((a) => ({ days: num(a.days) })));
    const granted = grantedTotal(legalGranted, adjustment);

    let used = 0;
    let pending = 0;
    if (period) {
      for (const f of forms) {
        if (f.user_id !== s.id) continue;
        // 조정과 **같은 귀속 규칙**(중앙 날짜) — 입사일이 정정되면 옛 문서의 period_start가 새 구간과
        // 어긋나 '사용'이 0으로 리셋되고, 그러면 이미 쓴 연차를 한 번 더 쓸 수 있게 된다.
        if (!leaveRowMatchesPeriod({ periodStart: f.period_start, periodEnd: f.period_end }, period)) {
          continue;
        }
        const status = f.doc?.status;
        if (status === "approved") used += num(f.days);
        else if (status === "pending") pending += num(f.days);
      }
    }
    used = roundDays(used);
    pending = roundDays(pending);

    return {
      userId: s.id,
      name: nameById.get(s.id)!,
      jobTitle: s.job_title ?? null,
      hireDate,
      period,
      legalGranted,
      adjustment,
      granted,
      used,
      pending,
      remaining: remainingDays({ granted, used, pending }),
      adjustments: mine.map((a) => ({
        id: a.id,
        days: num(a.days),
        reason: a.reason,
        createdAt: a.created_at,
        // 기록자가 퇴사(inactive)했거나 계정이 지워졌으면 이름을 모른다 — 지어내지 않고 null.
        createdByName: (a.created_by && nameById.get(a.created_by)) || null,
        // 실제 휴가 사용 기간(0270b) — 부여 행과 칸 미적용 창에서는 null(화면이 그 자리를 비운다).
        usedStart: a.used_start ?? null,
        usedEnd: a.used_end ?? null,
      })),
    };
  });

  const order = settings.operations.jobTitles;
  rows.sort((a, b) => compareByJobRank({ name: a.name, jobTitle: a.jobTitle }, { name: b.name, jobTitle: b.jobTitle }, order));

  return { rows, tableReady: adjRows !== null, usedRangeReady: adjLoad.usedRangeReady };
}

/**
 * 이 구간에서 이미 잡아 둔 연차(승인 + 결재중). 결재중도 빼야 같은 연차를 두 번 올리지 못한다.
 *
 * 🔑 기안 거절(submitLeaveDraft)·조정 하한 검사(leave/server/actions)가 **같은 함수**를 쓴다 — 각자 세면
 *    한쪽만 결재중을 빼먹어 "기안은 막히는데 조정은 통과" 같은 어긋남이 난다.
 */
export async function reservedLeaveDays(args: {
  tenantId: string;
  userId: string;
  period: PeriodWindow;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leave_forms")
    // ⚠️ 임베드 FK 명시([[#94]]).
    .select("period_start, period_end, days, doc:approval_documents!leave_forms_document_id_fkey(status)")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    // SQL은 **겹치는 창**까지 넓게 받고(입사일 정정으로 경계가 밀린 옛 문서를 놓치지 않게), 어느 구간의
    // 것인지는 아래 `leaveRowMatchesPeriod`(중앙 날짜)가 정한다 — 판정은 순수 함수 한 곳에서만.
    .lte("period_start", args.period.end)
    .gte("period_end", args.period.start)
    .limit(500); // 한 사람·한두 구간(1년)이라 상한에 닿지 않는다(절단 방지용 명시 상한, B2)
  if (error) throw new Error(`잔여 연차 확인 실패 — ${error.message}`);
  const total = (data ?? []).reduce((acc, r) => {
    const row = r as { period_start: string; period_end: string; doc?: { status?: string } | null };
    if (!leaveRowMatchesPeriod({ periodStart: row.period_start, periodEnd: row.period_end }, args.period)) {
      return acc;
    }
    const status = row.doc?.status;
    return status === "approved" || status === "pending" ? acc + num(r.days) : acc;
  }, 0);
  return roundDays(total); // 0.25(반반차) 해상도 보존 — 소수 1자리 반올림 금지
}

/**
 * 한 사람·한 구간의 조정 합계 — **기안 잔여 판정**(submitLeaveDraft)이 쓴다.
 *
 * 🔴 표가 없으면 0(0252a 전에도 기안은 되어야 한다). 그 밖의 실패는 **throw** 한다 —
 *    조용히 0으로 떨어뜨리면 이월 연차를 받은 사람이 이유도 모르고 기안을 거절당한다.
 */
export async function adjustmentDaysFor(args: {
  tenantId: string;
  userId: string;
  period: PeriodWindow;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leave_adjustments")
    .select("period_start, period_end, days")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    // 겹치는 창까지 넓게 받고(경계가 밀린 옛 행), 귀속은 `leaveRowMatchesPeriod`가 정한다(위와 같은 규약).
    .lte("period_start", args.period.end)
    .gte("period_end", args.period.start)
    .limit(500); // 한 사람·한두 구간의 수기 조정 — 상한에 닿지 않는다(절단 방지용 명시 상한, B2)
  if (error) {
    if (isMissingRelation(error)) return 0;
    throw new Error(`연차 조정 확인 실패 — ${error.message}`);
  }
  return sumAdjustments(
    (data ?? [])
      .filter((r) =>
        leaveRowMatchesPeriod({ periodStart: String(r.period_start), periodEnd: String(r.period_end) }, args.period),
      )
      .map((r) => ({ days: num(r.days) })),
  );
}
