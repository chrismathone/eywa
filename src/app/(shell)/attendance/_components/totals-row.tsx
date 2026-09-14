"use client";

/**
 * 월별 출석부 **하단 합계 줄** — 검색이 걸리면 **여기 숫자도 검색 기준**이 된다(2026-08-20).
 *
 * 원장 제보: *"학생 검색시 하단 숫자는 안바뀌네."* 검색으로 반 2개·행 2줄만 남았는데 하단은
 * `10개 반 · 시수 279.5 · 청구 17,099,375 … (38명 기준)` 전체 값 그대로였다.
 *
 * 규약 셋:
 *  ① 라벨이 바뀐다(`합계` → `검색 합계` + 친 검색어) + **보이는 글씨**로 "검색 중 — 전체 아님"
 *     (`title` 툴팁은 모바일에서 없는 것과 같다).
 *  ② 모든 숫자를 `검색분 / 전체`로 **나란히** 세운다 — 좁혀 놓고 전체인 척하는 숫자가 이 저장소가
 *     가장 경계하는 실패다([[#89]]). 전체 값을 지우지 말 것.
 *  ③ 검색을 지우면 **한 글자도 안 남기고** 종전 표기로 돌아온다(라벨·칩·병기 전부).
 *
 * 🔴 **돈 산식은 여기서 다시 쓰지 않는다.** 정산액은 서버가 행마다 `floor1(단가×시수×0.911×비율)`로
 *    확정해 내려준 금액을 고르고 더하기만 한다(`scopedSettlement`). 검색이 없을 때의 값은 서버
 *    `tierSettlement.total`을 **그대로** 쓴다 — 클라 재계산이 1원이라도 갈릴 여지를 아예 없앤다.
 * 🔴 청구·납입은 **고유 학생 1회**(`byStudent`의 키가 학생이라 구조적으로 보장) — 강사 전체 보기는
 *    한 학생이 여러 반에 나와 줄이 둘 이상이다.
 */
import type { Counted } from "@/features/attendance/grid/totals";
import type { TeacherMoney } from "@/features/attendance/server/teacher-money";
import type { ReactNode } from "react";
import { StickyFitRow } from "./sticky-fit-row";
import { formatMoney } from "@/features/attendance/money-format";
import { formatSessionUnits } from "@/features/attendance/session-units";
import {
  classCountOfRows,
  scopedExclusions,
  scopedMoneyTotals,
  scopedSettlement,
} from "@/features/attendance/search-totals";
import { LiveUnits, OfTotal } from "./live-totals";
import { useAttendanceSearch } from "./search-context";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

export function MatrixTotalsSummary({
  classCount,
  fallback,
  countByRow,
  money,
  moneyNote,
  trailing,
}: {
  /** 표에 담긴 반 수(전체). */
  classCount: number;
  /** 서버가 낸 표 전체 집계 — 격자가 없을 때의 폴백. */
  fallback: Counted;
  /** 행 키 → 서버 집계. 격자가 없어도 **검색 모수로** 셀 수 있게 하는 재료. */
  countByRow: Record<string, Counted>;
  /** 원장 전용 금액. null이면 금액 부분을 통째로 안 그린다. */
  money?: TeacherMoney | null;
  moneyNote?: string | null;
  /**
   * 합계 **뒤에 이어 붙이는** 한 조각(조작 안내, 원장 2026-09-14 *"2행은 1행 우측 끝으로 간략하게"*).
   * 🔴 이 덩어리(`sticky left-0 flex-wrap`) **안에** 둬야 한다 — 밖에서 `sticky right-0`로 따로 세웠더니
   *    표가 화면보다 넓을 때 두 sticky가 제 폭을 지키며 **안내가 합계·정산액을 덮었다**(적대적 리뷰 2026-09-14).
   *    안에 두면 자리가 모자랄 때 다음 줄로 접힐 뿐 숫자를 가리지 않는다 — 단 덩어리 폭을 `StickyFitRow`가
   *    **보이는 폭**으로 묶어야 실제로 접힌다(안 묶으면 표 전체 폭까지 늘어나 접히지 않고, 폰에서 끝까지 밀면
   *    합계가 화면 밖으로 나갔다 — 재리뷰 2026-09-14).
   */
  trailing?: ReactNode;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const search = useAttendanceSearch();
  const searching = search?.active ?? false;
  // 🔴 모수는 **학생 id 집합**이다 — 이름으로 좁히면 동명이인이 한 명으로 접혀 남의 돈이 섞인다.
  const ids = searching ? (search?.matchedStudentIds ?? null) : null;
  const shownClasses = searching ? classCountOfRows(search?.matched ?? []) : classCount;

  // 검색이 없으면 **서버 값을 그대로** 쓴다(재계산 0 = 드리프트 0).
  const totals = money ? (ids ? scopedMoneyTotals(money.byStudent, ids) : money.totals) : null;
  const tier = money?.tierSettlement;
  const scopedTier = tier?.status === "ready" && ids ? scopedSettlement(tier.settlementLines, ids) : null;
  const scopedMissing = tier?.status === "ready" && ids ? scopedExclusions(tier.excludedLines, ids) : null;
  const missingTierStudents = scopedMissing?.missingTierStudents ?? (tier?.status === "ready" ? tier.missingTierStudents : []);
  const missingPriceTiers = scopedMissing?.missingPriceTiers ?? (tier?.status === "ready" ? tier.missingPriceTiers : []);
  const excludedUnits = scopedMissing?.excludedUnits ?? (tier?.status === "ready" ? tier.excludedUnits : 0);

  return (
    <StickyFitRow className="gap-x-3 gap-y-1 px-3 py-2">
      <span className="text-foreground text-xs font-bold">
        {t(searching ? "att.totals.search" : "att.totals.all")}
      </span>
      {searching ? (
        <>
          {/* 무엇으로 좁혔는지 — 검색칸이 화면 위쪽에 있어 스크롤하면 안 보인다. */}
          <span className="text-text-dim text-xs">{`‘${search?.query.trim() ?? ""}’`}</span>
          {/* ⚠️ **보이는 글씨**여야 한다 — 툴팁은 폰에서 없는 것과 같다. */}
          <span className="bg-amber-soft text-amber shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap">
            {t("att.totals.searching")}
          </span>
        </>
      ) : null}
      {/* ⚠️ 클래스는 종전 그대로(`num` 신설 금지) — 검색을 지우면 **표기까지** 원래대로여야 한다. */}
      <span className="text-text-dim text-xs">
        {shownClasses}
        {searching ? <OfTotal>{classCount}</OfTotal> : null}
        {t("att.totals.classes")}
      </span>
      <span className="text-foreground num text-xs font-bold">
        {t("att.totals.units")}
        <LiveUnits countByRow={countByRow} fallback={fallback} />
      </span>
      {money && totals ? (
        <>
          {/* ⚠️ 합계는 **고유 학생 1회**만 더한다 — 한 학생이 여러 반에 나와도 청구서는 한 장이다. */}
          <span className="text-text-dim num text-xs">
            {tf("att.totals.billed", { amount: formatMoney(totals.billed) })}
            {searching ? <OfTotal>{formatMoney(money.totals.billed)}</OfTotal> : null}
            {t("att.totals.paidPre")}
            {formatMoney(totals.paid)}
            {searching ? <OfTotal>{formatMoney(money.totals.paid)}</OfTotal> : null}
            <span className="text-text-faint ml-1">
              ({totals.students}
              {searching ? ` / ${money.totals.students}` : ""}
              {t("att.totals.basis")}
            </span>
          </span>
          {moneyNote ? (
            <span
              className="text-amber text-xs"
              title={t("att.totals.slotTitle")}
            >
              {moneyNote}
            </span>
          ) : null}
          {totals.sharedStudents > 0 ? (
            <span
              className="text-amber text-xs"
              title={t("att.totals.sharedTitle")}
            >
              {tf("att.totals.shared", { n: totals.sharedStudents })}
              {searching ? ` / ${money.totals.sharedStudents}` : ""}
              {t("att.totals.sharedIncluded")}
            </span>
          ) : null}
          {/* 강사 몫(정산액) — 1순위는 티어 단가(0199a, 시트 산식 Σ floor1(단가×시수×0.911×비율)).
              티어 미배선이면 종전 안내(회차 확정/배분율)로 폴백. 없으면 0을 지어내지 않는다. */}
          {tier?.status === "ready" ? (
            <span className="text-foreground num text-xs font-bold">
              {tf("att.totals.pay", {
                amount: formatMoney(scopedTier ? scopedTier.total : tier.total),
              })}
              {searching ? <OfTotal>{formatMoney(tier.total)}</OfTotal> : null}
              <span className="text-text-faint ml-1 text-xs font-normal">
                {t("att.totals.unitsPre")}
                {formatSessionUnits(scopedTier ? scopedTier.unitsTotal : tier.unitsTotal)}
                {searching ? ` / ${formatSessionUnits(tier.unitsTotal)}` : ""}
                {t("att.totals.formula")}
              </span>
              {missingTierStudents.length > 0 ? (
                <span
                  className="text-amber ml-1 text-xs font-normal"
                  title={tf("att.totals.missingTierTitle", {
                    names: missingTierStudents.join(", "),
                  })}
                >
                  {tf("att.totals.missingTier", {
                    n: missingTierStudents.length,
                    units: formatSessionUnits(excludedUnits),
                  })}
                </span>
              ) : null}
              {missingPriceTiers.length > 0 ? (
                <span
                  className="text-amber ml-1 text-xs font-normal"
                  title={tf("att.totals.missingPriceTitle", {
                    tiers: missingPriceTiers.join(", "),
                  })}
                >
                  {tf("att.totals.missingPrice", { n: missingPriceTiers.length })}
                </span>
              ) : null}
            </span>
          ) : tier?.status === "hold" ? (
            <span
              className="text-amber text-xs"
              title={
                tier.missingTierStudents.length > 0
                  ? tf("att.totals.missingTierPlain", {
                      names: tier.missingTierStudents.join(", "),
                    })
                  : undefined
              }
            >
              {t("att.totals.payHold")}
            </span>
          ) : (
            <span className="text-text-faint text-xs">
              {money.splitRows === 0
                ? t("att.totals.noTerms")
                : money.commissionRate === null
                  ? t("att.totals.noRate")
                  : tf("att.totals.rateNote", { rate: money.commissionRate })}
            </span>
          )}
        </>
      ) : null}
      {trailing}
    </StickyFitRow>
  );
}
