/**
 * 수강 구간(재원 기간) 판정 — 출석부가 "이 학생이 그날 이 반 소속이었나"와
 * "이번 달에 들어왔나·나갔나·옮겼나"를 정하는 단일 소스. 순수 함수 + Vitest.
 *
 * 구 출석부(D:\attendance)는 칸마다 재원 기간을 보고 밖이면 빗금을 치고, 그 경계 칸에
 * `첫수업`·`퇴원`·`반이동` 뱃지를 얹었다. eywa 매트릭스엔 이 개념이 통째로 없어서
 * **8월 5일에 그만둔 학생과 계속 다니는 학생이 화면에서 구분되지 않았다**(원장 2026-08-06).
 *
 * 🔴 이 판정은 **표시 전용**이다. 재원 외 칸이라고 입력을 막지 않는다 —
 *    퇴원 뒤 보강 출석이 실제로 있고(구 출석부도 `value>0`이면 빗금 위에 값을 그렸다),
 *    막으면 이미 들어와 있는 기록을 고칠 길이 사라진다.
 */

import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { sheetTf } from "@/features/teacher-view/i18n";
// 🔴 반이동 툴팁엔 **반 이름이 둘** 들어간다 — 상대 반도 같은 표기표를 통과시켜야 한 문장이
//    두 언어로 갈리지 않는다(호출부가 준 `className`은 이미 변환된 값이다).
import { classNameFor } from "@/features/teacher-view/class-name";
import { addDays } from "@/lib/date-kst";

export type EnrollSpan = {
  start: string;
  end: string | null;
  /**
   * 이 구간이 **반 이동으로** 끝났나(`enrollments.is_transferred`) — 종료 규약이 갈린다.
   * 반이동은 종료일 **당일에 이미 새 반**이고(RPC가 `old.end_date = new.start_date`로 닫는다),
   * 일반 퇴원·수강 종료는 그날까지 재원이다.
   * ⚠️ 모르면(undefined) **일반 종료로 본다** — 근거 없이 하루 일찍 지우지 않는다.
   */
  isTransferred?: boolean;
};

/** 반이동으로 볼 최대 공백(일). 이보다 벌어지면 '쉬었다 재등록'이지 이동이 아니다. */
export const TRANSFER_GAP_DAYS = 14;

/**
 * 그 날짜에 이 반 소속이었나.
 *
 * ⚠️ 구간이 **하나도 없으면 true**(=아무 표시도 안 한다). 모르는 걸 "재원 아님"으로 칠하면
 *    표 전체가 회색이 되고, 그건 사실이 아니라 자료 없음이다.
 */
export function isEnrolledOn(date: string, spans: readonly EnrollSpan[]): boolean {
  if (spans.length === 0) return true;
  // 🔴 종료 규약을 여기서 다시 쓰지 않는다 — `date <= s.end`로 직접 판정하면 **반이동한 학생이
  //    옛 반에 적용일 하루 더 남는다**(2026-09-01 실측: 자리·반별 월간 표에서 12명이 옛 반·새 반
  //    양쪽에 섰다). [eligibility](@/features/enrollments/eligibility)가 유일한 판정자다.
  return spans.some((s) => s.start <= date && !isEnrollmentEndedOn(s.end, date, s.isTransferred));
}

/** "2026-08" → 그 달의 첫날·마지막날. 말일은 다음 달 0일로 구해 28/29/30/31을 안 따진다. */
export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * 표가 그리는 **기간**. 달력월이면 monthBounds가 만들고, 세션이면 그 세션의 시작·끝이다(0189a).
 * ⚠️ 세션은 달력월을 넘길 수 있으므로(2월 세션이 3/5까지) 판정을 월 문자열에 묶으면 안 된다 —
 *    날짜축만 세션으로 바꾸고 이 판정을 월로 두면, 표는 그 칸을 그리는데 뱃지만 사라진다.
 */
export type SpanRange = { first: string; last: string };

/**
 * 그 기간에 **새로 들어온** 날 — 없으면 null.
 * ⚠️ 기간이 시작되기 전날에 이미 소속이었으면 신입이 아니다(중간에 반이 잠깐 끊긴 재등록 방어).
 */
export function joinedInRange(range: SpanRange, spans: readonly EnrollSpan[]): string | null {
  if (spans.length === 0) return null;
  if (isEnrolledOn(addDays(range.first, -1), spans)) return null;
  const starts = spans.map((s) => s.start).filter((s) => s >= range.first && s <= range.last);
  return starts.length > 0 ? starts.slice().sort()[0]! : null;
}

/**
 * 그 기간에 **나간** 날 — 없으면 null.
 * ⚠️ 마지막 날에 아직 소속이면 나간 게 아니다(같은 반 재등록으로 구간이 이어진 경우).
 */
export function leftInRange(range: SpanRange, spans: readonly EnrollSpan[]): string | null {
  if (spans.length === 0) return null;
  if (isEnrolledOn(range.last, spans)) return null;
  const ends = spans
    .map((s) => s.end)
    .filter((e): e is string => !!e && e >= range.first && e <= range.last);
  return ends.length > 0 ? ends.slice().sort().at(-1)! : null;
}

/** 달력월 진입점(기존 호출부·테스트 유지). */
export function joinedInMonth(month: string, spans: readonly EnrollSpan[]): string | null {
  return joinedInRange(monthBounds(month), spans);
}

/** 달력월 진입점(기존 호출부·테스트 유지). */
export function leftInMonth(month: string, spans: readonly EnrollSpan[]): string | null {
  return leftInRange(monthBounds(month), spans);
}

/** 다른 반의 수강 구간 — 반이동 판정에 쓴다. */
export type OtherSpan = EnrollSpan & { classId: string; className: string; subject: string | null };

/**
 * 나간 다음 **같은 과목의 다른 반이 이어받았으면** 퇴원이 아니라 반이동이다.
 *
 * 🔴 조건 셋을 모두 만족해야 한다 — 라벨이 틀리면 없느니만 못하다:
 *   ① 같은 과목(수학 그만두고 영어 시작한 건 이동이 아니다)
 *   ② 나간 **다음날 이후** 시작(겹치면 두 반을 같이 다닌 것이지 옮긴 게 아니다)
 *   ③ 공백이 14일 이내
 */
export function transferTo(
  leftOn: string,
  subject: string | null,
  others: readonly OtherSpan[],
  /**
   * 그 구간이 **반이동으로 닫혔나**(`enrollments.is_transferred`). 반이동 RPC는 옛 반을
   * `end_date = 새 반 start_date`로 닫으므로 **같은 날 시작**이 정상이다 — 이 표식이 있으면
   * 같은 날도 이동으로 본다(원장 2026-09-14 *"반이동생이 퇴원생 처리되지 않게 주의"*).
   * 🔴 표식이 없을 때 같은 날을 허용하면 두 반을 **같이 다니기 시작한 날**이 이동으로 둔갑한다.
   */
  endedByTransfer = false,
): OtherSpan | null {
  const limit = addDays(leftOn, TRANSFER_GAP_DAYS);
  const hit = others
    .filter(
      (o) =>
        o.subject === subject &&
        (endedByTransfer ? o.start >= leftOn : o.start > leftOn) &&
        o.start <= limit,
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  return hit[0] ?? null;
}

/** 들어오기 직전 **같은 과목의 다른 반이 끝났으면** 신입이 아니라 반이동이다(위 규칙의 반대 방향). */
export function transferFrom(
  joinedOn: string,
  subject: string | null,
  others: readonly OtherSpan[],
): OtherSpan | null {
  const floor = addDays(joinedOn, -TRANSFER_GAP_DAYS);
  const hit = others
    // 🔴 **같은 날 닫힌 반이동**(`isTransferred`)도 들어온 쪽에서 인정한다 — RPC가 옛 반을 새 반
    //    시작일로 닫기 때문이다(원장 2026-09-14). 표식 없는 같은 날 종료는 종전대로 제외.
    .filter(
      (o) =>
        o.subject === subject &&
        !!o.end &&
        (o.isTransferred === true ? o.end <= joinedOn : o.end < joinedOn) &&
        o.end >= floor,
    )
    .sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
  return hit[0] ?? null;
}

/**
 * 나간 날 **같은 과목의 다른 반을 이미 다니고 있고 그 뒤로도 계속 다니면** 퇴원이 아니라 **종강**이다.
 *
 * 원장 2026-09-14 *"이건 퇴원이 아니라 '종강' 처리해줘야지 과목 퇴원이 아니고 과목에서 여러개 수업을 듣다가
 * 특강 종료 등으로 종료한것인데. 과목을 완전 수강 종료하면 퇴원이지."* — `[특강]중3-2 개념 완성반` 9명이
 * 특강을 마치고 같은 수학 정규반을 계속 다니는데 전원 '퇴원'으로 떴다(최근 120일 일반 종료 378건 중 75건이 이 모양).
 *
 * 🔴 판정 순서는 **반이동(`transferTo`) → 종강 → 퇴원**이다. 여기서는 반이동이 아닌 경우만 본다.
 *   ① 같은 과목 키(`transferTo`와 같은 비교). 과목을 모르면(null) 판정하지 않는다 — 퇴원 그대로
 *   ② 나간 날 **이전이나 당일에** 시작(나간 뒤에 시작한 반은 반이동 쪽 몫이다)
 *   ③ 그 반의 **마지막 재원일 + 14일에도 재원**(`TRANSFER_GAP_DAYS` — 반이동과 같은 창). 재원 판정은 `isEnrolledOn`
 *      그대로(반이동 반열림 규약 포함). 🔴 "다음날 하루"로 보지 말 것 — 퇴원하면서 반마다 닫는 날이 하루~며칠 어긋난
 *      학생이 먼저 닫힌 반에서 전부 '종강'이 된다(리뷰 2026-09-14 실측 최근 120일 9건·전원 퇴원생: 박한별 BS2O 7/5 ·
 *      JJ2L 7/6 · 7/6 퇴원). 14일 안에 같은 과목이 전부 끝났으면 과목을 끝낸 것 = 퇴원이다.
 *      ⚠️ 의도한 절충: 특강이 끝난 뒤 정규반을 14일이 안 되게 더 다니다 그만둔 학생도 그 특강에선 '퇴원'이다
 *      (실측 어긋남은 하루~며칠이었지만 반이동 창과 한 값으로 맞췄다). 계속 반의 종료일이 비어 있다가 나중에
 *      14일 안쪽으로 입력되면 지난 달 뱃지가 '종강' → '퇴원'으로 바뀐다 — 그게 데이터가 말하는 사실이다.
 *   🔴 마지막 재원일은 **반이동으로 닫힌 구간이면 종료일 하루 전**(`endedByTransfer`)이다. 출석부는 원본 종료일을,
 *      MCS는 미리 하루 당긴 구간(`mathSpansOf`, 표식 없음)을 넘기므로 이걸 맞춰야 두 화면이 같은 날을 본다
 *      (안 맞추면 같은 학생이 출석부는 퇴원·MCS는 종강 — 리뷰 실측 2건: 노현우·임은진).
 * ⚠️ 학원을 그만둔 학생은 다른 반 구간을 **퇴원일로 먼저 자른 뒤** 넘길 것(`clipToWithdrawal`) — 퇴원일 뒤로
 *    end_date가 남은 수강이 실제로 있어(실측 48건) 안 자르면 그만둔 학생이 "계속 수강"으로 읽힌다.
 * 여러 반이면 가장 먼저 시작한 반.
 */
export function continuesIn(
  leftOn: string,
  subject: string | null,
  others: readonly OtherSpan[],
  /** 이 구간이 반이동으로 닫혔나(`transferTo`에 넘기는 값과 같다) — 닫혔으면 종료일 당일은 이미 새 반이다. */
  endedByTransfer = false,
): OtherSpan | null {
  if (subject == null) return null;
  const lastDay = endedByTransfer ? addDays(leftOn, -1) : leftOn;
  const probe = addDays(lastDay, TRANSFER_GAP_DAYS);
  const hit = others
    .filter((o) => o.subject === subject && o.start <= leftOn && isEnrolledOn(probe, [o]))
    .sort((a, b) => a.start.localeCompare(b.start));
  return hit[0] ?? null;
}

/**
 * 수강 한 건을 끝내면 그게 **무엇이 되는지** — 시간표 '수강 종료' 확인 문구의 판정.
 *
 * 원장 2026-09-14 *"1과목이 완전히 종료되면 그 과목에 대해서는 퇴원생 처리하는게 맞음 … 두과목 모두다 퇴원하면
 * 완전한 퇴원"*. 판정은 뱃지와 **같은 두 함수**(`transferTo` → `continuesIn`)를 과목마다 부른다 — 규칙을 새로 적지 않는다.
 *  · `class`   = 같은 과목 다른 반이 이어받거나(`transfer: true` = 반이동) 계속된다(`false` = 이 반만 종강) → 퇴원 아님
 *  · `subject` = 이 과목은 끝나지만 다른 과목 반이 계속된다 → 그 과목 수강종료
 *  · `student` = 계속되는 반이 하나도 없다 → 퇴원
 * 🔴 순서는 뱃지와 같다 — **반이동 → 종강 → 퇴원**(같은 학생을 뱃지는 '반이동'이라 부르는데 팝업이 '종강'이라 하면 안 된다).
 * @param others **이 반**의 수강을 뺀 학생의 다른 수강 전부(과목 불문, 퇴원일로 자른 것 — `clipToWithdrawal`)
 * @returns `other` = 이어받거나 계속 다니는 반(`class`면 같은 과목 반, `subject`면 다른 과목 반)
 */
export type EndScope = "class" | "subject" | "student";

export function endScopeOf(
  leftOn: string,
  subject: string | null,
  others: readonly OtherSpan[],
): { scope: EndScope; other: OtherSpan | null; transfer: boolean } {
  const moved = transferTo(leftOn, subject, others);
  if (moved) return { scope: "class", other: moved, transfer: true };
  const stay = continuesIn(leftOn, subject, others);
  if (stay) return { scope: "class", other: stay, transfer: false };
  for (const s of new Set(others.map((o) => o.subject))) {
    if (s === subject) continue;
    const hit = transferTo(leftOn, s, others) ?? continuesIn(leftOn, s, others);
    if (hit) return { scope: "subject", other: hit, transfer: false };
  }
  return { scope: "student", other: null, transfer: false };
}

/**
 * 학원 퇴원일(`students.withdrawn_at`)로 **다른 반** 구간의 끝을 자른다 — 실효 종료일 = 수강 종료와 퇴원일 중 이른 것
 * (MCS `mathSpansOf`의 `effectiveEndDate`와 같은 규약). 잘렸으면 일반 종료(퇴원일 당일까지 재원)다.
 * 퇴원일이 없거나 수강이 먼저 끝났으면 그대로 돌려준다.
 */
export function clipToWithdrawal<T extends EnrollSpan>(span: T, withdrawnAt: string | null | undefined): T {
  const cut = withdrawnAt ? withdrawnAt.slice(0, 10) : null;
  if (!cut || (span.end != null && span.end <= cut)) return span;
  return { ...span, end: cut, isTransferred: false };
}

/**
 * 이름 옆에 다는 표식. 보통 빈 배열이고, 그 달에 경계가 있는 학생만 1~2개를 갖는다.
 * (들어왔다 나간 달이면 둘 다 — 드물지만 감추지 않는다.)
 */
export type LifecycleBadge = {
  kind: "new" | "left" | "transferIn" | "transferOut" | "classEnded";
  /** 기준 날짜(시작일 또는 종료일). */
  date: string;
  /** 반이동 상대 반 이름 — 툴팁에 "A반 → B반"으로 쓴다. 종강이면 **계속 다니는 반** 이름. */
  otherClassName?: string;
};

/**
 * 한 학생의 그 달 표식 — 신입/퇴원, 그리고 이어받은 반이 있으면 반이동으로 승격.
 * @param others **다른 반**의 수강 구간(이 반은 빼고 넘길 것)
 */
export function lifecycleBadges(
  month: string,
  spans: readonly EnrollSpan[],
  subject: string | null,
  others: readonly OtherSpan[] = [],
): LifecycleBadge[] {
  return lifecycleBadgesInRange(monthBounds(month), spans, subject, others);
}

/** 기간판 — 세션(달력월을 넘길 수 있다)에서 쓴다. 판정 규칙은 위와 완전히 같다. */
export function lifecycleBadgesInRange(
  range: SpanRange,
  spans: readonly EnrollSpan[],
  subject: string | null,
  others: readonly OtherSpan[] = [],
): LifecycleBadge[] {
  const out: LifecycleBadge[] = [];
  const joined = joinedInRange(range, spans);
  if (joined) {
    const from = transferFrom(joined, subject, others);
    out.push(
      from
        ? { kind: "transferIn", date: joined, otherClassName: from.className }
        : { kind: "new", date: joined },
    );
  }
  const left = leftInRange(range, spans);
  if (left) {
    // 그 종료가 **반이동으로 닫힌 것**이면 같은 날 시작한 반도 이동으로 본다(위 transferTo 주석).
    const endedByTransfer = spans.some((s) => s.end === left && s.isTransferred === true);
    const to = transferTo(left, subject, others, endedByTransfer);
    // 반이동이 아니면 같은 과목 다른 반을 계속 다니는지 본다 — 그러면 과목 퇴원이 아니라 이 반만 종강(continuesIn 주석).
    const stay = to ? null : continuesIn(left, subject, others, endedByTransfer);
    out.push(
      to
        ? { kind: "transferOut", date: left, otherClassName: to.className }
        : stay
          ? { kind: "classEnded", date: left, otherClassName: stay.className }
          : { kind: "left", date: left },
    );
  }
  return out;
}

/** 화면 문구 — DB 값·영문 키를 그대로 내보내지 않는다. */
export const BADGE_LABEL: Record<LifecycleBadge["kind"], string> = {
  new: "신입",
  left: "퇴원",
  transferIn: "반이동",
  transferOut: "반이동",
  classEnded: "종강",
};

/**
 * 같은 뱃지의 **영어 표기** — 강사뷰 영어 화면. 🔴 한글 맵 바로 옆에 둔다(상태가 늘 때
 * 한쪽만 채워지면 raw 키가 새는 것은 출결 상태 표와 같다).
 */
export const BADGE_LABEL_EN: Record<LifecycleBadge["kind"], string> = {
  new: "New",
  left: "Left",
  transferIn: "Moved",
  transferOut: "Moved",
  // 수업목록 반 상태 '종강'(`cls.status.ended`)과 같은 영어 — 같은 한국어가 화면마다 다른 영어가 되지 않게.
  classEnded: "Finished",
};

/** 화면에 적을 뱃지 두 글자. 인자를 안 주면 한국어. */
export function badgeLabelOf(
  kind: LifecycleBadge["kind"],
  lang: "ko" | "en" = "ko",
): string {
  return lang === "en" ? BADGE_LABEL_EN[kind] : BADGE_LABEL[kind];
}

/** 툴팁 문장 — 언제·어디서/어디로인지까지 말한다(뱃지 두 글자만으론 사유를 모른다). */
export function badgeTitle(
  b: LifecycleBadge,
  className: string,
  // 화면 언어 — 안 주면 한국어(자리 출석부·MCS 등 기존 호출부는 한 글자도 안 바뀐다).
  lang: "ko" | "en" = "ko",
): string {
  if (b.kind === "new") return sheetTf(lang, "att.badge.new", { date: b.date });
  if (b.kind === "left") return sheetTf(lang, "att.badge.left", { date: b.date });
  const other = classNameFor(b.otherClassName ?? "", lang);
  if (b.kind === "classEnded") return sheetTf(lang, "att.badge.classEnded", { date: b.date, other });
  if (b.kind === "transferIn") {
    return sheetTf(lang, "att.badge.transferIn", { from: other, to: className, date: b.date });
  }
  return sheetTf(lang, "att.badge.transferOut", { from: className, to: other, date: b.date });
}
