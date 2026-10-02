/**
 * 수강 **시작·종료일 인라인 정정**의 순수 판정 — 검증 + "이미 찍힌 출결이 기간 밖으로 밀려나는가".
 *
 * 🔴 왜 별도 파일인가: 호출부 [`server/actions.ts`](./server/actions.ts)가 `"use server"`라 동기 함수를
 *    export할 수 없다([[#119]] · db-errors.ts와 같은 이유). 클라(`EditableDateCell`)도 문구를 읽으므로
 *    `import "server-only"`도 붙이지 않는다([[#61]]).
 *
 * ## 이 파일이 답하는 질문 — "이 날짜를 옮기면 조용히 깨지는 게 있나?"
 * 2026-09-10 원장 제보(*"수업에서 더블클릭으로 시작날짜는 수정되는데 종료날짜는 수정이 안되네"*)로
 * 반 상세 명단에도 종료일 편집을 열면서, 그 편집이 조용히 할 수 있는 나쁜 일 **둘**을 붙잡는다:
 *   ① 이미 찍힌 출결이 새 기간 밖으로 밀려남 · ② 반이동 짝(날짜로 이어 붙인 관계)이 끊어짐.
 * 둘 다 **DB는 아무 불평도 하지 않는다** — 그래서 저장 전에 사람에게 묻는다.
 *
 * ### 결정: **막지 않는다 — 대신 확인을 받는다**(2026-09-10)
 * 세 가지 실측이 "하드 블록"을 반증했다.
 *  · 프로덕션(injaewon)에 **수강 구간 밖 출결이 이미 1,394건**, 종료일 뒤 출결을 가진 수강행이 **74건**
 *    있다. 막으면 그 74건은 **영영 정정할 수 없는 행**이 된다(정정하려고 여는 화면인데).
 *  · 같은 화면의 [`수강 종료 · 어제까지`](./end-choices.ts)는 **아무것도 안 묻고** 같은 상태를 만든다
 *    (원장 2026-09-01 승인). 옆 버튼이 그냥 하는 일을 이 칸만 거절하면 규칙이 아니라 고장으로 읽힌다.
 *  · [`enrollment-span`](@/features/attendance/enrollment-span)이 못박은 대로 **재원 기간 밖이라고 출결
 *    입력을 막지 않는다**(퇴원 뒤 보강 출석이 실제로 있다). 기간이 기록을 지배하지 않는다.
 * 그래서 **거절이 아니라 한 번 더 묻는다.** 조용히 통과시키지도, 손을 묶지도 않는다.
 *
 * 🔴 확인의 **게이트는 서버**다([[#77]]) — 화면이 확인창을 그리는 것으로 끝나면 주소·폼 조작으로 바로
 *    새어 나간다. 서버가 매번 다시 세어(`attendanceShrinkToken`) 클라가 돌려준 서명과 **정확히 같을 때만**
 *    통과시킨다(가져오기 충돌 체크리스트의 `confirmMatchesPlan`과 같은 결). 그 사이 출결이 늘었으면
 *    서명이 어긋나 **새 숫자로 다시 묻는다**.
 *
 * ⚠️ **기간을 넓히는 편집은 안 묻는다** — 밀려나는 기록이 없다. 묻는 건 오직 *줄일 때*뿐이고,
 *    그중에서도 **이번 편집이 새로 밀어내는 구간**만 센다. 원래부터 기간 밖이던 기록까지 세면
 *    무관한 편집마다 같은 경고가 떠서 진짜 신호가 묻힌다([[#105]] 결).
 */

import { addDays, isValidYmd } from "@/lib/date-kst";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type EnrollmentDateField = "start" | "end";

/** 화면의 마지막 수강일을 기존 저장 경계로 되돌린다. 전출 여부는 서버 조회값을 사용한다. */
export function dateEditStorageValue(
  field: EnrollmentDateField,
  value: string | null,
  inclusiveEnd: boolean,
  isTransferred: boolean,
): string | null {
  return field === "end" && inclusiveEnd && isTransferred && value && isValidYmd(value)
    ? addDays(value, 1)
    : value;
}

export type EnrollmentWindow = {
  startDate: string;
  endDate: string | null;
  /**
   * 반이동(전출)이면 종료일 **당일에 이미 새 반**이라 구간이 `[start, end)`다.
   * 일반 퇴원·수강 종료는 그날까지 재원(`[start, end]`).
   * ⚠️ 모르면(undefined) 일반 종료로 본다 — 근거 없이 하루를 깎지 않는다
   *    ([`eligibility`](./eligibility.ts) `isEnrollmentEndedOn`과 같은 규약).
   */
  isTransferred?: boolean;
};

/** 편집이 만든 새 기간 — 바꾸는 필드 하나만 갈아끼운다. */
export function applyDateEdit(
  current: EnrollmentWindow,
  field: EnrollmentDateField,
  value: string | null,
): EnrollmentWindow {
  return field === "start"
    ? { ...current, startDate: value ?? current.startDate }
    : { ...current, endDate: value };
}

/**
 * 저장 전 순수 검증 — 못 저장하면 **한글 사유**, 저장 가능하면 null.
 * ⚠️ 문구는 종전 서버 액션이 쓰던 것을 **글자 그대로** 옮겼다(같은 화면에서 말이 바뀌지 않게).
 */
export function enrollmentDateEditError(
  field: string,
  value: string | null,
  current: EnrollmentWindow,
): string | null {
  if (field !== "start" && field !== "end") return "잘못된 필드입니다";
  if (field === "start" && !value) return "시작일은 비울 수 없습니다";
  if (value && !isValidYmd(value)) return "날짜 형식이 올바르지 않습니다";

  const next = applyDateEdit(current, field, value);
  // ISO 문자열은 사전식 비교가 곧 날짜 비교.
  if (next.endDate && next.startDate > next.endDate) {
    return "시작일이 종료일보다 늦을 수 없습니다";
  }
  return null;
}

/**
 * 이번 편집이 **새로** 기간 밖으로 밀어내는 출결의 날짜 구간(양끝 포함).
 * `to: null` = 위쪽이 열린 구간(원래 종료일이 없던 수강을 처음 닫는 경우).
 *
 * 🔑 "옛 기간 안 ∧ 새 기간 밖"만 담는다 — 원래부터 밖이던 기록은 이번 편집의 책임이 아니다.
 * ⚠️ 한 번의 편집은 필드 하나만 움직이므로 실제로는 길이 0 또는 1이다. 그래도 배열로 두는 건
 *    두 축을 각각 정직하게 판정해 테스트로 잠그기 위해서다(호출부는 전부 순회하면 된다).
 */
export type ExcludedRange = { from: string; to: string | null };

export function newlyExcludedAttendanceRanges(
  prev: EnrollmentWindow,
  next: EnrollmentWindow,
): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];

  // ① 시작일을 **뒤로** 밀면 [옛 시작, 새 시작 −1]이 밖으로 나간다(앞으로 당기면 기간이 커진다).
  if (next.startDate > prev.startDate) {
    ranges.push({ from: prev.startDate, to: addDays(next.startDate, -1) });
  }

  // ② 종료일을 **앞으로** 당기면 새 종료 다음날부터 옛 종료까지가 밖으로 나간다.
  //    비우는 것(null)은 기간이 무한히 커지는 것이라 밀려나는 기록이 없다.
  if (next.endDate !== null && (prev.endDate === null || next.endDate < prev.endDate)) {
    // 전출은 종료일 당일이 이미 밖이라 하한이 하루 앞이고, 상한도 하루 앞이다.
    const transferred = prev.isTransferred === true;
    const from = transferred ? next.endDate : addDays(next.endDate, 1);
    const to =
      prev.endDate === null ? null : transferred ? addDays(prev.endDate, -1) : prev.endDate;
    if (to === null || from <= to) ranges.push({ from, to });
  }

  return ranges;
}

/** 기간 밖으로 밀려나는 출결 실측 — 서버가 세어 넘긴다. */
export type AttendanceShrink = {
  count: number;
  /** 밀려나는 기록 중 **가장 최근** 날짜 — 사람이 "언제까지 수업했지"를 되짚는 닻. */
  lastDate: string;
};

/**
 * **반이동 짝이 끊긴다.** [`scheduled-changes`](./scheduled-changes.ts)는 예약된 이동을
 * `옛 수강.end_date === 새 수강.start_date ∧ 옛쪽 is_transferred`로 짝짓는다 — 이 날짜를 손으로
 * 옮기면 짝이 안 맞아 **전출이 '수강 종료'로 표시되고**(그만두는 아이로 읽힌다) 예약 취소 버튼도
 * 사라진다(`canCancel:false`). DB는 아무 불평도 하지 않는다.
 */
export type TransferPairRisk = { kind: "transferPair"; anchor: string };

/**
 * 저장하면 **조용히 깨지는 것들** — 확인창이 하나하나 이름을 대고 묻는다.
 * (막지 않는 이유는 이 파일 머리 주석. 둘이 함께 걸리면 문장 둘이 나란히 선다.)
 */
export type DateEditRisk =
  /** 이미 찍힌 출결이 새 기간 밖으로 밀려난다. */
  | { kind: "attendanceOutside"; shrink: AttendanceShrink }
  | TransferPairRisk;

/**
 * 반이동 짝 위험 — 순수 판정. 옮기는 쪽(`is_transferred`)은 **종료일**이, 들어오는 쪽
 * (`is_transferred_in`)은 **시작일**이 짝의 닻이다.
 * ⚠️ 값이 그대로면(같은 날짜 재저장) 위험이 아니다 — 짝이 안 움직인다.
 *
 * 🔴 **아직 오지 않은 이동만 묻는다**(`anchor >= today`). 실측 2026-09-10: 전입 표식이 붙은 수강이
 *    **157건**인데 대부분 이미 지나간 이동이다 — 전부 물으면 편집할 때마다 같은 창이 떠서 정작
 *    위험한 건이 묻힌다(가져오기 충돌 체크리스트가 "이번 변경이 건드린 것만" 확인시키는 것과 같은 결).
 *    근거도 갈린다: 예약 배너([`scheduled-changes`](./scheduled-changes.ts))는 **미래 행만** 모아
 *    날짜가 **정확히 같아야** 짝을 짓고 예약 취소(0233a)도 미래분만 대상이라 — 여기서만 한 글자 차이로
 *    끊긴다. 지난 이동의 뱃지 판정([`transferTo`](@/features/attendance/enrollment-span))은 **14일
 *    허용**이라 웬만한 날짜 정정을 견딘다.
 */
export function transferPairRisk(
  prev: EnrollmentWindow & { isTransferredIn?: boolean },
  field: EnrollmentDateField,
  value: string | null,
  today: string,
): TransferPairRisk | null {
  const anchor = field === "end" ? prev.endDate : prev.startDate;
  const flagged = field === "end" ? prev.isTransferred === true : prev.isTransferredIn === true;
  const moved = anchor !== value;
  if (!flagged || !moved || !anchor || anchor < today) return null;
  return { kind: "transferPair", anchor };
}

/**
 * 확인 서명 — 서버가 다시 계산해 **정확히 같을 때만** 저장한다([[#77]]).
 * 위험의 내용(숫자·날짜)까지 담으므로, 확인창을 띄운 뒤 사실이 바뀌면 서명이 어긋나 다시 묻는다.
 */
export function dateEditConfirmToken(
  /** ⚠️ 서명은 **이 행에 대해** 받은 것이어야 한다 — 안 넣으면 같은 숫자를 내는 남의 수강 토큰이 통한다. */
  enrollmentId: string,
  field: EnrollmentDateField,
  value: string | null,
  risks: readonly DateEditRisk[],
): string {
  const parts = risks.map((r) =>
    r.kind === "attendanceOutside"
      ? `att:${r.shrink.count}:${r.shrink.lastDate}`
      : `pair:${r.anchor}`,
  );
  return `${enrollmentId}|${field}|${value ?? ""}|${parts.join(",")}`;
}

/**
 * 확인창 **제목** — 걸린 위험에 따라 갈린다.
 * 🔴 "출결이 기간 밖이 됩니다"로 고정하면 **출결이 한 건도 안 밀려나는 경우**(반이동 짝만 걸린 편집)에
 *    화면이 거짓말을 한다 — 실제로 나는 경로다(전입 행의 시작일을 **당기는** 편집은 기간이 넓어져
 *    밀려나는 출결이 0인데 짝은 끊긴다). 그래서 제목도 서버가 정해 내려보낸다.
 */
export function dateEditConfirmTitle(risks: readonly DateEditRisk[]): string {
  const att = risks.some((r) => r.kind === "attendanceOutside");
  const pair = risks.some((r) => r.kind === "transferPair");
  if (att && pair) return "저장하면 함께 바뀌는 것이 있습니다";
  if (pair) return "예약된 반 이동의 기준일입니다";
  return "이미 찍힌 출결이 기간 밖이 됩니다";
}

/**
 * 확인창 문구 — **사실만** 적는다. 두 방향으로 다 틀릴 수 있어 실제 소비처를 읽고 맞췄다(2026-09-10).
 *
 * 🔴 **"표시만 바뀝니다"는 거짓이다.** 처음에 그렇게 적었다가 적대 검증에서 반증됐다 — 수강 구간을
 *    읽어 **숫자를 만드는** 곳이 실제로 여럿이다:
 *      · 월별 출석부 집계([`getMonthlyAttendanceMatrix`](@/features/attendance/server/queries))
 *        — 명단에서 빠지면 출석률·인원·건수가 함께 줄고, 보고서 파생 출결도 안 만들어진다.
 *      · 자리(LAB·JJ) 월별([`foldEnrollments`](@/features/attendance/seat/monthly-build))
 *        — 로스터가 좁아져 **시수 합계**(confirmedUnits)가 바뀐다.
 *      · 급여명세서 지표([`spanOverlapsMonth`](@/features/payroll/payslip-metrics))
 *        — 그 달 수업인원·연 누계·퇴원생율의 분모가 다시 계산된다.
 *    그래서 문구는 **바뀌는 곳의 이름을 댄다**(테스트가 이 이름들을 잠근다).
 * 🔴 반대로 **"기록이 지워집니다"도 거짓이다** — `attendance_records`는 한 행도 손대지 않는다.
 * ⚠️ 티어 정산 **금액** 자체는 수강 기간을 안 본다((학생,반) 축 + `salary_tier`,
 *    [`collectTierRows`](@/features/payroll/server/tier-rows)) — 그래서 "금액이 바뀐다"고도 적지 않는다.
 *    바뀌는 건 **지표(세는 값)**다. 이 구분을 뭉개면 둘 중 하나는 반드시 거짓말이 된다.
 */
export function dateEditConfirmMessage(
  field: EnrollmentDateField,
  value: string | null,
  risks: readonly DateEditRisk[],
): string {
  const when = value ?? "—";
  const lines = risks.map((r) => {
    if (r.kind === "attendanceOutside") {
      const head =
        field === "end"
          ? `종료일을 ${when}로 앞당기면 그 뒤에 이미 찍힌 출결 ${r.shrink.count}건`
          : `시작일을 ${when}로 늦추면 그 앞에 이미 찍힌 출결 ${r.shrink.count}건`;
      return (
        `${head}(마지막 ${r.shrink.lastDate})이 수강 기간 밖이 됩니다. ` +
        `기록이 지워지지는 않지만 그날 이 학생이 이 반 명단에서 빠져, ` +
        `월별 출석부의 출석률·인원, 자리 출석부의 시수 합계, 급여명세서의 수업인원 지표가 다시 계산됩니다.`
      );
    }
    // ⚠️ 화면은 이 문자열을 **그대로** 그린다 — `**강조**` 같은 마크업을 넣으면 별표가 보인다.
    //
    // 🔴 이 문장은 적대 검증에서 **두 군데가 거짓**이라 고쳤다(2026-09-10):
    //   · ~~"이동이 '수강 종료'로 표시된다"~~ — 틀렸다. 짝이 끊겨도 `viaTransfer: l.isTransferred`가
    //     그대로 실려(scheduled-changes.ts) 라벨은 `sched.transferOut`("다른 반으로 이동")로 남는다.
    //     실제로 바뀌는 건 **출발·도착이 한 줄로 안 묶이고 따로 서는 것**이다.
    //   · ~~"나중에 학생 상세에서 수정하세요"~~ — 저장한 **뒤엔 불가능하다**. 짝이 끊긴 출발지는
    //     `canCancel:false`가 되고 `ScheduledChangeActions`가 그때 블록을 통째로 `return null` 해서
    //     취소뿐 아니라 **'수정' 버튼까지 사라진다**. 그래서 "저장하기 전에"라고 적는다
    //     (할 수 없는 일을 시키는 안내 금지, [[#77]] 결).
    return (
      `이 수강은 ${r.anchor}에 예약된 반 이동의 기준일입니다. ` +
      `날짜를 옮기면 출발·도착이 한 줄로 안 묶여 따로 표시되고, 그 예약의 수정·취소 버튼도 사라집니다. ` +
      `이동 날짜를 바꾸려면 저장하지 말고 그 학생 상세의 '예약된 반 변경'에서 고치세요.`
    );
  });
  return `${lines.join("\n\n")}\n\n그대로 저장할까요?`;
}
