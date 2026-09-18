import "server-only";

/**
 * 내 연차 **내역**(내 정보 화면) — 이 구간에 낸 휴가 문서 + 사무실이 손으로 적은 조정을 모은다
 * (원장 2026-09-18: *"내정보에서 연차 남은 갯수 연차 언제썼는지 기타등등 볼수있게"* ·
 *  *"가감된거 내정보에서도 언제 쓴지까지 연계시켜줘"*).
 *
 * 🔑 **숫자는 여기서 다시 세지 않는다** — 부여·사용·결재중·잔여는 `getMyLeaveBalance`(잔여 산식 단일
 *    소스 balance.ts)가 내고 이 파일은 **무엇이 언제 있었는지**만 모은다. 두 곳이 각자 세면 카드 안에서
 *    "사용 3일"인데 목록은 2줄인 모순이 난다.
 * 🔑 **세션 클라이언트**로 읽는다 — 본인 것만 보는 화면이라 RLS가 곧 게이트다(0252a 정책이 조정을
 *    본인 행만 열고, leave_forms는 결재 관계자에게 열린다). 남의 연차를 보는 관리자 표가 admin
 *    클라이언트를 쓰는 것과 **반대 방향**이라 여기서 admin을 쓸 이유가 없다([[#104]]).
 * ⚠️ 어느 구간의 것인지는 **중앙 날짜**(`leaveRowMatchesPeriod`)가 정한다 — 입사일이 정정돼도 이미 쓴
 *    연차가 목록에서 사라지거나 다음 해로 새지 않는다(관리자 표·잔여 산식과 같은 규약).
 * ⚠️ **실패해도 화면은 산다** — 내 정보는 이력서를 채우는 화면이라 연차 한 조각 때문에 죽으면 안 된다.
 *    못 읽은 것과 "없는 것"은 플래그로 갈라 화면이 사실만 말하게 한다([[#95]]·[[#89]]).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { leaveRowMatchesPeriod, type PeriodWindow } from "../balance";
import { isMissingUsedRangeColumn } from "../missing-used-range";

/** 결재로 낸 휴가 한 건. 종류·상태 **라벨은 화면**이 단일 소스에서 뽑는다(여기선 원값만 옮긴다). */
export type MyLeaveDoc = {
  id: string;
  docNo: string | null;
  kind: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
};

/** 사무실이 적은 조정 한 줄. 사용 기간은 차감 행에만 있다(부여 행은 null, 하루면 끝이 null). */
export type MyLeaveAdjustment = {
  id: string;
  days: number;
  reason: string;
  usedStart: string | null;
  usedEnd: string | null;
  createdAt: string;
};

export type MyLeaveHistory = {
  docs: MyLeaveDoc[];
  adjustments: MyLeaveAdjustment[];
  /** 조정을 **실제로 읽었나** — false면 화면이 "아직 못 읽었다"를 밝힌다(빈 목록과 구분, [[#89]]). */
  adjustmentsReady: boolean;
  /** 사용 기간 칸(0270b)이 있나 — false면 조정 줄에 날짜가 비는 이유를 화면이 말한다. */
  usedRangeReady: boolean;
  /** 휴가 문서 조회 실패 — 한글 한 줄(원문은 화면이 툴팁으로만). */
  error?: string;
  errorRaw?: string;
};

const FORM_COLS =
  "document_id, leave_kind, start_date, end_date, days, period_start, period_end, doc:approval_documents!leave_forms_document_id_fkey(doc_no, status)";
const ADJ_COLS = "id, days, reason, created_at, period_start, period_end";

type FormRow = {
  document_id: string;
  leave_kind: string | null;
  start_date: string;
  end_date: string;
  days: number | string;
  period_start: string;
  period_end: string;
  doc: { doc_no?: string | null; status?: string | null } | null;
};

type AdjRow = {
  id: string;
  days: number | string;
  reason: string | null;
  created_at: string;
  period_start: string;
  period_end: string;
  used_start?: string | null;
  used_end?: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 내 조정 줄 — 사용 기간 칸을 **먼저** 넣어 읽고, 칸이 없으면(0270b 전) 그 칸만 빼고 다시 읽는다.
 * 🔴 표가 없는 것과 칸이 없는 것을 구분한다 — 표가 없으면 조정 기능 자체가 준비 안 된 것이고,
 *    칸만 없으면 조정은 이미 쌓여 있으니 **목록은 보여야** 한다(날짜만 빈다).
 */
async function loadMyAdjustments(
  supabase: SupabaseClient,
  userId: string,
  period: PeriodWindow,
): Promise<{ rows: AdjRow[]; ready: boolean; usedRangeReady: boolean }> {
  const query = (cols: string) =>
    supabase
      .from("leave_adjustments")
      .select(cols)
      .eq("user_id", userId)
      // SQL은 겹치는 창까지 넓게 받고 귀속은 아래 순수 함수가 정한다(관리자 표와 같은 규약).
      .lte("period_start", period.end)
      .gte("period_end", period.start)
      .limit(500); // 한 사람·한 구간의 수기 조정 — 상한에 닿지 않는다(절단 방지용 명시 상한, B2)

  const withRange = await query(`${ADJ_COLS}, used_start, used_end`);
  if (!withRange.error) {
    return { rows: (withRange.data ?? []) as unknown as AdjRow[], ready: true, usedRangeReady: true };
  }
  if (isMissingUsedRangeColumn(withRange.error)) {
    const base = await query(ADJ_COLS);
    if (!base.error) {
      return { rows: (base.data ?? []) as unknown as AdjRow[], ready: true, usedRangeReady: false };
    }
    return { rows: [], ready: false, usedRangeReady: false };
  }
  // 표 없음(0252a 전)도, 그 밖의 실패도 이 화면에선 같은 뜻이다 — "조정을 아직 못 읽었다".
  // 🔴 던지지 않는다: 잔여(getMyLeaveBalance)는 이미 조정을 fail-soft 0으로 처리하므로, 여기서 던져 봐야
  //    내 정보 화면만 죽고 사실은 하나도 더 알려 주지 못한다([[#95]]).
  return { rows: [], ready: false, usedRangeReady: false };
}

export async function getMyLeaveHistory(userId: string, period: PeriodWindow): Promise<MyLeaveHistory> {
  const supabase = await createClient();
  const inPeriod = (r: { period_start: string; period_end: string }) =>
    leaveRowMatchesPeriod({ periodStart: String(r.period_start), periodEnd: String(r.period_end) }, period);

  // 두 조회는 서로 독립 — 함께 받는다(B4).
  const [formsRes, adj] = await Promise.all([
    supabase
      .from("leave_forms")
      .select(FORM_COLS)
      .eq("user_id", userId)
      .lte("period_start", period.end)
      .gte("period_end", period.start)
      .limit(500),
    loadMyAdjustments(supabase, userId, period),
  ]);

  const docs: MyLeaveDoc[] = formsRes.error
    ? []
    : ((formsRes.data ?? []) as unknown as FormRow[])
        .filter(inPeriod)
        // 회수·반려된 문서도 남긴다 — "낸 적은 있는데 어떻게 끝났나"가 본인에게 필요한 사실이다
        // (숫자에는 승인·결재중만 들어간다 — 그 판정은 balance 쪽이 한다).
        .map((f) => ({
          id: f.document_id,
          docNo: f.doc?.doc_no ?? null,
          kind: f.leave_kind ?? "annual",
          startDate: f.start_date,
          endDate: f.end_date,
          days: num(f.days),
          status: f.doc?.status ?? "pending",
        }))
        .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const adjustments: MyLeaveAdjustment[] = adj.rows
    .filter(inPeriod)
    .map((a) => ({
      id: a.id,
      days: num(a.days),
      reason: (a.reason ?? "").trim(),
      usedStart: a.used_start ?? null,
      usedEnd: a.used_end ?? null,
      createdAt: a.created_at,
    }))
    // 사용 기간이 있으면 그 **시작일**로, 없으면 적은 날로 줄을 세운다(목록의 축은 "언제의 일인가").
    .sort((a, b) => (b.usedStart ?? b.createdAt).localeCompare(a.usedStart ?? a.createdAt));

  return {
    docs,
    adjustments,
    adjustmentsReady: adj.ready,
    usedRangeReady: adj.usedRangeReady,
    ...(formsRes.error
      ? { error: "휴가 내역을 불러오지 못했습니다", errorRaw: formsRes.error.message }
      : {}),
  };
}
