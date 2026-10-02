// **예약된 수강 변경**의 분류·문구 — 순수 함수(Vitest).
//
// 배경(원장 2026-08-28~29): 미래 날짜로 반이동·배정을 예약할 수 있는데(기본뷰 드래그·학생 상세
// 반 이동·시트 가져오기가 전부 `move_enrollments_batch`를 탄다) **그 예약이 어디에도 안 보였다.**
// 실측 2026-08-29: 미래 시작 수강 28건·미래 종료 15건이 이미 DB에 있고 23명이 오늘 명단에 섞여 있었다.
//
// 🔑 진실 원천은 **enrollments 행 자체**다(스냅샷이 아니라). 세 창구가 전부 이 표에 쓰므로,
//    행에서 도출하면 어느 창구로 만든 예약이든 자동으로 보인다.
//
// 🔴 **전부 "이동"이 아니다.** 실측상 미래 수강 다수가 특강 신규 배정이다. 셋으로 가른다:
//      · move  — 옛 수강 `end_date` == 새 수강 `start_date` ∧ 옛쪽 `is_transferred`
//      · join  — 짝 없는 미래 시작(신규 배정)
//      · leave — 미래 종료인데 짝이 없다(수강 종료 예정)
// 🔴 이 짝짓기는 **문구를 만들기 위한 것**이고, 쓰기(수정·취소)는 언제나 `enrollmentId`로 한다.
//    날짜 인접으로 추론한 관계를 쓰기 대상 선정에 쓰면 남의 행을 건드린다(적대 리뷰 합의 R3).

import { enrollmentPhaseOn } from "./eligibility";
import { DEFAULT_SHEET_LANG, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

export type ScheduledKind = "move" | "join" | "leave";

/** 조회가 넘겨 주는 수강 한 줄(오늘 기준 미래에 걸친 것만). */
export interface ScheduledEnrollmentRow {
  enrollmentId: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  startDate: string;
  endDate: string | null;
  isTransferred: boolean;
  isTransferredIn?: boolean;
}

export interface ScheduledChange {
  kind: ScheduledKind;
  /** 그 일이 일어나는 날(합류·이동은 시작일, 종료는 종료일). */
  date: string;
  studentId: string;
  studentName: string;
  /** 도착지 반(move·join) 또는 떠나는 반(leave). */
  classId: string;
  className: string;
  /** move일 때 출발지 반 이름. */
  fromClassName?: string;
  fromClassId?: string;
  /** 이동 관계가 모호하면 한쪽만 지우지 않고 이유를 보여준다. */
  blockedReason?: string;
  /**
   * 🔑 **쓰기 대상.** move·join = 새로 생길 수강, leave = 끝나는 수강.
   * 화면·서버가 이 값만 쓴다(관계 추론으로 대상을 고르지 않는다).
   */
  enrollmentId: string;
  /** move일 때 짝인 옛 수강 — 취소가 종료일을 되돌릴 대상. */
  pairedEnrollmentId?: string;
  /**
   * `leave`가 **반 이동 때문**인가(짝은 다른 반이라 이 화면에 없다).
   * 🔴 반 상세에서 이걸 구분하지 않으면 **전출하는 학생을 "수강 종료"라고 부른다** — 옮겨 가는 아이를
   *    그만두는 아이로 읽게 만드는 거짓 문장이다.
   */
  viaTransfer?: boolean;
  /**
   * 취소 버튼을 붙여도 되는가.
   * 🔴 `leave`는 **false** — 짝(도착지 수강)이 이 조회 범위 밖이라 여기서 되돌리면 **한쪽만** 풀린다.
 *    전출이 아닌 종료는 아예 **퇴원 예정**이라 되살리면 없던 재원생이 생긴다. 반 상세도 반대편 수강을
 *    함께 조회해서 명확한 짝이 있을 때 move로 묶어 수정·취소한다.
   */
  canCancel: boolean;
}

/** "9/1" — 배너 한 줄에 들어가는 짧은 표기(올해면 연도 생략). */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  const md = `${Number(m)}/${Number(d)}`;
  return y === today.slice(0, 4) ? md : `${y.slice(2)}. ${md}`;
}

/**
 * 배너에 그대로 찍히는 한 줄. ⚠️ 영문 키·enum이 새지 않게 여기서만 문장을 만든다.
 * ⚠️ **인자를 안 주면 한국어** — 아직 안 배선된 호출부는 한 글자도 안 바뀐다.
 */
export function scheduledChangeLabel(
  c: ScheduledChange,
  today: string,
  lang: SheetLang = DEFAULT_SHEET_LANG,
): string {
  const when = shortDate(c.date, today);
  const name = c.className;
  if (c.kind === "move")
    return sheetTf(lang, "sched.move", { when, from: c.fromClassName ?? "?", to: name });
  if (c.kind === "join") return sheetTf(lang, "sched.join", { when, name });
  // 전출은 "그만둠"이 아니라 "다른 반으로 옮겨감"이다 — 같은 말로 쓰면 반 상세가 거짓말을 한다.
  if (c.viaTransfer) return sheetTf(lang, "sched.transferOut", { when, name });
  return sheetTf(lang, "sched.leave", { when, name });
}

/**
 * 미래에 걸친 수강 행들 → 예약 목록.
 *
 * ⚠️ 같은 학생의 이동 짝은 **(학생, 날짜)** 로 맞춘다 — 같은 날 두 반을 동시에 옮기는 경우가 있어
 *    (실측 권민서A·김동리가 9/1에 두 반) 날짜만으로는 어느 짝인지 모른다. 출발·도착 후보가
 *    서로 하나일 때만 이동으로 묶고, 모호한 전입은 한쪽만 취소하지 못하게 한다.
 */
export function classifyScheduled(
  rows: readonly ScheduledEnrollmentRow[],
  today: string,
): ScheduledChange[] {
  const upcoming = rows.filter((r) => enrollmentPhaseOn(r, today) === "upcoming");
  const leaving = rows.filter((r) => r.endDate != null && r.endDate > today);

  const matches = (from: ScheduledEnrollmentRow, to: ScheduledEnrollmentRow) =>
    from.studentId === to.studentId && from.endDate === to.startDate && from.isTransferred &&
    from.enrollmentId !== to.enrollmentId && from.classId !== to.classId &&
    to.isTransferredIn !== false;

  const usedLeaving = new Set<string>();
  const out: ScheduledChange[] = [];

  for (const u of upcoming) {
    // 짝 후보 = 같은 학생 · 종료일이 이 시작일과 같음 · 반이동 표식.
    const mates = leaving.filter((l) => matches(l, u));
    if (mates.length === 1 && upcoming.filter((to) => matches(mates[0]!, to)).length === 1) {
      const from = mates[0]!;
      usedLeaving.add(from.enrollmentId);
      out.push({
        kind: "move",
        date: u.startDate,
        studentId: u.studentId,
        studentName: u.studentName,
        classId: u.classId,
        className: u.className,
        fromClassName: from.className,
        fromClassId: from.classId,
        enrollmentId: u.enrollmentId,
        pairedEnrollmentId: from.enrollmentId,
        canCancel: !u.isTransferred,
        ...(u.isTransferred ? { blockedReason: sheetT(DEFAULT_SHEET_LANG, "sched.cancelLaterFirst") } : {}),
      });
    } else {
      out.push({
        kind: "join",
        date: u.startDate,
        studentId: u.studentId,
        studentName: u.studentName,
        classId: u.classId,
        className: u.className,
        enrollmentId: u.enrollmentId,
        canCancel: !u.isTransferredIn && mates.length === 0 && !u.isTransferred,
        ...(u.isTransferredIn || mates.length > 0 || u.isTransferred
          ? { blockedReason: sheetT(DEFAULT_SHEET_LANG, u.isTransferred ? "sched.cancelLaterFirst" : "sched.missingPrevious") }
          : {}),
      });
    }
  }

  for (const l of leaving) {
    if (usedLeaving.has(l.enrollmentId)) continue;
    out.push({
      kind: "leave",
      date: l.endDate!,
      studentId: l.studentId,
      studentName: l.studentName,
      classId: l.classId,
      className: l.className,
      enrollmentId: l.enrollmentId,
      viaTransfer: l.isTransferred,
      // 🔴 짝이 안 보이는 자리에서 한쪽만 되돌리지 않는다(위 canCancel 주석).
      canCancel: false,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.studentName.localeCompare(b.studentName, "ko"));
}

/** 출발 반·도착 반 어디서 보든 같은 예약 id와 이전 수강 id로 처리한다. */
export function scheduledChangesForClass(changes: ScheduledChange[], classId: string): ScheduledChange[] {
  return changes.filter((change) => change.classId === classId || change.fromClassId === classId);
}
