// 급여명세서 화면 모델 — 서버 조회(payslip-queries)와 인쇄 화면이 공유하는 타입.
// ⚠️ 클라이언트 컴포넌트가 import하므로 `server-only`를 넣지 말 것([[#61]]).

import type { PayslipAmounts } from "./payslip";
import type { GroupRates } from "./salary-group";
import type { TierSettlementLine } from "./tier-settlement";
import type { WithdrawalStats } from "./payslip-metrics";

/** 월별 수동 조정(0205a payslips 행). 표가 없거나 행이 없으면 전부 0/미입력. */
export type PayslipAdjustments = {
  incentive: number;
  otherDeduction: number;
  /** 명세서 '내신분석' 칸 — 실제로는 블로그 작성일. 빈 값 = 미작성. */
  blogWrittenOn: string | null;
  /** 그 달 배분율 차감(%p). */
  ratePenaltyPoints: number;
  ratePenaltyReason: string | null;
  memo: string | null;
  status: "draft" | "issued";
  issuedAt: string | null;
};

export function emptyAdjustments(): PayslipAdjustments {
  return {
    incentive: 0,
    otherDeduction: 0,
    blogWrittenOn: null,
    ratePenaltyPoints: 0,
    ratePenaltyReason: null,
    memo: null,
    status: "draft",
    issuedAt: null,
  };
}

export type PayslipData = {
  period: string;
  company: {
    name: string;
    representativeName: string | null;
    bizRegNo: string | null;
    sealUrl: string | null;
    /** 서명란 라벨(담당/원장/수령인 중 '담당'에 적을 사람 이름들). null = 미설정. */
    signerLabels: string | null;
  };
  teacher: {
    id: string;
    name: string;
    /** 이력서(restricted)에서 읽는다. 없으면 null → 화면에 '미입력'. 절대 지어내지 않는다. */
    residentRegNo: string | null;
    bankName: string | null;
    accountNumber: string | null;
    employmentType: string | null;
    department: string | null;
    hireDate: string | null;
    contractPeriod: { start: string; end: string; stored: boolean } | null;
    classes: { id: string; className: string; subject: string | null }[];
  };
  amounts: PayslipAmounts;
  /**
   * null = **산정 불가**(경고에 사유가 담긴다). 0원으로 지어내지 않는다.
   * ⚠️ 화면은 이 값이 null이면 금액 칸을 **전부** '산정 불가'로 그려야 한다 — 수업료만 가리고
   *    지급총액·실수령액에 ₩0을 찍으면 겉보기 정상인 거짓 명세서가 인쇄된다(적대 리뷰 지적).
   */
  settlement: {
    /** 산정된 정산액(원). */
    total: number;
    lines: TierSettlementLine[];
    grossTuition: number;
    unitsTotal: number;
    rowCount: number;
    excludedUnits: number;
    missingTierStudents: string[];
    missingPriceTiers: string[];
    /**
     * 총 시수 뒤 단위 글자 — 출석부 기준(프리랜서) 명세서만 싣는다: 영어만 `U` · 수학만 `T` · 섞이면 null(글자 없음).
     * 없으면(종전 티어 정산 · 옛 발행 스냅샷) 화면이 종전대로 `T`를 붙인다.
     */
    unitSuffix?: "U" | "T" | null;
  } | null;
  /**
   * 수업료의 근거 — `sheet` = 그 강사 **출석부(강사 전체 보기)의 실급여 합계**(프리랜서, 원장 2026-10-06) · `tier` = 티어 정산(그 밖).
   * 없으면(옛 발행 스냅샷) `tier`다. 별지가 어느 출석부를 붙일지도 이 값으로 정한다.
   */
  tuitionBasis?: "sheet" | "tier";
  /**
   * 대상 학년을 좁힌 선생님(출석부 '비율 설정')이면 그 학년 — 없으면 전체. 수업료·수업인원·퇴원 지표·출석부 별지가
   * 전부 이 학년 학생만 센다(원장 2026-10-07 *"고등학생에 대해서만 급여 명세서가 나오도록"*). 발행 스냅샷에도 함께 굳는다.
   */
  sheetLevels?: ("초등" | "중등" | "고등")[];
  /** 특강의 학년 제한 예외도 발행 시점 값으로 보존한다. */
  sheetIncludeSpecial?: boolean;
  rates: {
    base: GroupRates;
    baseDefault: number | null;
    applied: GroupRates;
    /** 과정별 값이 없을 때 실제로 적용되는 기본 비율(차감 반영). null = 기본 비율 미설정. */
    appliedDefault: number | null;
    penaltyPoints: number;
  };
  metrics: {
    studentsThisMonth: number;
    withdrawal: WithdrawalStats;
    cumulativeStudents: number;
    averageStudents: number;
    /** 그 해 퇴원 누계(이 강사에게 배우던 학생 중). 일괄 도장일 제외. */
    yearlyWithdrawals: number;
    /**
     * 대상 학년을 좁힌 명세서 — 그 달 **대상 학년 학생이 있는 반**의 수. 없으면(전체 · 옛 스냅샷) 담임 반 수를 쓴다.
     * 수업인원은 고등학생만인데 '담당 반'이 전 학년 반이면 한 표에서 말이 갈린다(적대 리뷰 2026-10-07).
     */
    scopedClassCount?: number;
  };
  adjustments: PayslipAdjustments;
  /** 화면 상단에 그대로 띄운다 — 조용히 빠진 금액이 있으면 안 된다. */
  warnings: string[];
  /** 발행 시점 스냅샷을 그대로 보여주는 중인가(= 지금 계산한 값이 아니다). */
  frozen?: boolean;
};

/** 금액 표기 — 시트와 같은 ₩ + 천단위. */
export function won(n: number): string {
  return `₩${n.toLocaleString("ko-KR")}`;
}

/** 시트가 빈칸에 쓰던 표기(장음부호). 0이 아니라 '없음'을 뜻한다. */
export const EMPTY_MARK = "ㅡ";

/** 금액 칸 — 0이면 시트처럼 'ㅡ'. */
export function wonOrDash(n: number): string {
  return n > 0 ? won(n) : EMPTY_MARK;
}
