/**
 * 반 임시 위임(결근 대체)의 **유효 구간 판정 — 순수함수 단일 소스** (0173a, 2026-08-03).
 *
 * 위임은 `[fromDate, toDate]` **양끝 포함** 구간이다(하루 위임이면 두 값이 같다).
 * SQL도 같은 규약으로 좁히지만(`from_date <= d and to_date >= d`), 최종 판정은 **항상 이 함수**를 한 번 더
 * 태운다 — DB 필터와 화면 표시가 갈라지면 "칩엔 있는데 학생이 없는 반"이나 그 반대가 생긴다.
 * (같은 교훈: 보이는 것과 세는 것은 한 값이 정해야 한다.)
 *
 * ⚠️ 여기엔 server 전용 import를 두지 말 것 — 클라 컴포넌트(반 칩 배지)도 이 판정을 쓴다(#61).
 */

/** 위임 1건의 기간 — DB row에서 필요한 최소 필드만(테스트·클라 표시 공용). */
export type DelegationWindow = {
  fromDate: string; // YYYY-MM-DD (포함)
  toDate: string; // YYYY-MM-DD (포함)
  revokedAt?: string | null; // 해제된 위임은 기간 안이어도 무효(행은 감사 목적으로 남긴다)
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 최대 위임 기간(일). 이보다 길면 임시 대체가 아니라 담임 교체 — 인수인계로 안내한다. */
export const DELEGATION_MAX_DAYS = 90;

/**
 * 그 날짜에 이 위임이 살아 있는가. 형식이 깨진 값은 **false**(fail-closed) — 위임은 남의 반을 여는
 * 권한이라, 값이 이상하면 여는 쪽이 아니라 닫는 쪽으로 떨어져야 한다(담당 반은 이 함수와 무관하게 그대로다).
 */
export function isDelegationActiveOn(d: DelegationWindow, date: string): boolean {
  if (d.revokedAt) return false;
  if (!YMD.test(d.fromDate) || !YMD.test(d.toDate) || !YMD.test(date)) return false;
  return d.fromDate <= date && date <= d.toDate;
}

/**
 * 위임 기간이 `[from, to]` 구간과 **겹치는가**(양끝 포함).
 *
 * 하루 단위 판정(`isDelegationActiveOn`)으로는 부족한 소비처가 있다 — ECS는 **주 단위 시트**라
 * "화요일만 대신 맡았는데 월요일 저녁에 미리 열어보기 / 수요일에 고치기"가 정상 업무다. 그래서 ECS는
 * 위임 앞뒤로 유예를 두고 이 함수로 판정한다(유예 상수는 ECS 쪽 access.ts에 있다 — 소비처가 정한다).
 * 형식이 깨진 값은 **false**(fail-closed) — 남의 반을 여는 판정이라 의심스러우면 닫는다.
 */
export function delegationOverlapsRange(d: DelegationWindow, from: string, to: string): boolean {
  if (d.revokedAt) return false;
  if (!YMD.test(d.fromDate) || !YMD.test(d.toDate) || !YMD.test(from) || !YMD.test(to)) return false;
  if (from > to) return false;
  return d.fromDate <= to && from <= d.toDate;
}

/** 두 날짜 사이 일수(양끝 포함). 형식이 깨졌으면 null. */
export function inclusiveDayCount(from: string, to: string): number | null {
  if (!YMD.test(from) || !YMD.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * 위임 기간 유효성 — 통과면 null, 아니면 **한글 사유**(그대로 화면에 뜬다. raw 코드 노출 금지 규약).
 * 서버 액션이 저장 전에 부르고, 폼도 같은 함수로 미리 알린다(두 벌로 적으면 갈라진다).
 */
export function validateDelegationRange(from: string, to: string): string | null {
  if (!YMD.test(from) || !YMD.test(to)) return "기간을 날짜로 선택해주세요";
  const days = inclusiveDayCount(from, to);
  if (days == null) return "기간을 날짜로 선택해주세요";
  if (days <= 0) return "종료일이 시작일보다 빠릅니다";
  if (days > DELEGATION_MAX_DAYS)
    return `위임은 최대 ${DELEGATION_MAX_DAYS}일까지입니다 — 더 길게 맡기려면 '강사 인수인계'를 쓰세요`;
  return null;
}

/** 기간 라벨 — 하루면 "8월 3일", 여러 날이면 "8월 3일 ~ 8월 7일". 형식이 깨졌으면 원문 그대로. */
export function delegationRangeLabel(from: string, to: string): string {
  if (!YMD.test(from) || !YMD.test(to)) return `${from} ~ ${to}`;
  const short = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
  return from === to ? short(from) : `${short(from)} ~ ${short(to)}`;
}
