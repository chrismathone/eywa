/**
 * **퇴원 + 수강종료 한 목록** — 순수 규칙(IO 없음, Vitest).
 *
 * 원장 2026-09-28: *"퇴원관리에 수강종료도 포함시켜야될거같은데. 그리고 따로 라벨처리하거나 상단 필터에도
 * 추가하도록 해야겠고, 기간필터도 원하는 기간 커스터마이징가능하게"* — 시간표 상단 '퇴원 8'(이 과목 수업이 끝난
 * 학생 = 퇴원 + 한 과목만 끊은 수강종료)과 퇴원관리 '퇴원 6'(학원을 그만둔 학생)이 달라 헷갈린 것이 발단이다.
 *
 * 🔑 한 줄 = **이탈 한 건**: 퇴원은 학생 한 줄, 수강종료는 **학생 × 끊은 과목** 한 줄(과목마다 끊은 날이 다르다).
 * 🔑 퇴원의 과목 = **마지막 종료일 무렵(14일 안)에 끝난 수강의 과목 전부** — 마지막 반 하나로만 정하면 수학·영어를
 *    같은 날 끊은 학생이 과목 필터에서 한 과목에만 잡힌다(김도연 9/1, 실측 2026-09-28).
 * 🔑 사유 = 퇴원은 퇴원 사유, 수강종료는 **그 과목 마지막 수강의 종료 사유**(`enrollments.withdrawal_reason`) — 원장
 *    2026-09-28 *"우측에도 상위 퇴원 및 수강종료 사유로"*. 비었으면 둘 다 '미기재'.
 * ⚠️ 사후상담은 **퇴원에만** 있다 — 상담 필터를 걸면 수강종료 줄은 빠진다(모르는 것을 '미완료'로 세지 않는다).
 */

import { inWithdrawalWindow, recentExitWindow } from "./window";
export { withdrawalSubjects, WITHDRAW_SUBJECT_SPAN_DAYS } from "./window";
import { normalizeReason, reasonDisplay } from "./types";
import { detailFor } from "./reason-detail";
import { tenureDays } from "./early-exit";

export type ExitKind = "withdrawn" | "subject-ended";

export type ExitRow = {
  /** 목록 키 — 퇴원 = 학생 id, 수강종료 = `학생id|과목`. */
  key: string;
  studentId: string;
  kind: ExitKind;
  name: string;
  school: string | null;
  grade: string | null;
  /** 퇴원일 또는 그 과목 수강이 끝난 날(`YYYY-MM-DD`). 화면에 보이는 날짜. */
  date: string | null;
  /**
   * 기간·달을 판정하는 날짜 — 퇴원은 퇴원월(수강료를 낸 마지막 달, 원장 2026-10-29 · `exit-month.ts`)이 앞 달이면 그 달 말일,
   * 아니면 `date`와 같다. 수강종료는 늘 `date`. 기간 필터·이번 달·월별 추이·올해 카드가 이 값을 본다.
   */
  countDate: string | null;
  /** 과목 키 — 과목 필터·분포가 본다. */
  subjects: string[];
  /** 마지막 반 이름(표시). */
  className: string | null;
  /** 프로그램 판정 재료 — 퇴원은 마지막 반, 수강종료는 그 과목 마지막 반. */
  programSubject: string | null;
  englishTrack: string | null;
  /** 퇴원일이 장부상 일괄 날짜(실제 시점 미상) — 퇴원만. */
  systemBulk: boolean;
  /** 사유 키 — 퇴원은 `metadata.reason`, 수강종료는 종료 사유를 표준 키로 접은 것(자유 텍스트는 '기타'). 없으면 null. */
  reasonKey: string | null;
  /** 사유 표시(사유 키 라벨 또는 옛 수강 사유). */
  reasonLabel: string | null;
  /** 세부 사유 키(2단계 — `reason-detail.ts`) · 그 대분류의 것만(`detailFor`). 없으면 null. */
  detail: string | null;
  /** 사후상담 여부 — 수강종료는 null(해당 없음). */
  consulted: boolean | null;
  /** 메모 원문(실제 사유가 적힌 곳 — '기타'의 속) — 퇴원 = `metadata.memo` · 수강종료 = 그 수강 행의 종료 메모(0367a). */
  memo: string | null;
  /** 장부 정리 일괄 퇴원(`isCleanupWithdrawal`) — 실제 사유가 아니라 사유 통계에서 따로 센다(`breakdown.ts`). 수강종료는 false. */
  cleanup: boolean;
  /**
   * 등록일 → 퇴원일 일수(`early-exit.ts`) — **퇴원만**. 수강종료·시스템 정리(퇴원일 미상)·등록일을 모르는 줄은 null
   * (판정하지 않는다). 퇴원관리 '등록 후' 필터·띠가 본다.
   */
  tenureDays: number | null;
  /** 수강종료 줄 — 아직 다니는 과목(표시). */
  activeSubjects?: string[];
  /** 수강종료 줄 — 학생이 휴원 중. */
  onHold?: boolean;
  /** 퇴원생 관리 차트에만 있는 줄(에이와 학생 연결 없음 — `sheet-exit-rows.ts`). */
  fromSheet?: boolean;
};

export type RangeKey = "all" | "month" | "30d" | "90d" | "year" | "custom";

/**
 * 기간 판정 — 전부 **양끝 포함 창**이다. 롤링(`30d`·`90d`·`year`)도 끝이 오늘이다(`recentExitWindow`) — 옛 롤링은 시작만
 * 막아 퇴원 예정일(10/1)이 '최근 30일'에 들어와 시간표 집계와 한 명이 갈렸다(2026-09-28).
 * 시스템 정리(날짜 미상)는 뺀다 — 장부 날짜로 그 기간에 세면 사실이 아니다(시간표엔 수강 이력이 없어 원래 안 선다).
 */
export type RangeWindow = { kind: "all" } | { kind: "between"; from: string; to: string };

const ymd = (v: string | undefined | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * URL 값 → 판정 창. `custom`에서 날짜가 비었거나 틀리면 **최근 30일**(시작) ~ 오늘로 채운다 —
 * '직접 지정'을 막 고른 순간에도 빈 목록이 아니라 뭔가 보이게. 시작·끝이 뒤집혀 오면 바로잡는다.
 */
export function resolveRange(
  range: RangeKey,
  opts: { today: string; month: { from: string; to: string }; from?: string | null; to?: string | null },
): RangeWindow & { custom?: { from: string; to: string } } {
  switch (range) {
    case "month":
      return { kind: "between", ...opts.month };
    case "30d":
      return { kind: "between", ...recentExitWindow(opts.today) };
    case "90d":
      return { kind: "between", ...recentExitWindow(opts.today, 90) };
    case "year":
      return { kind: "between", ...recentExitWindow(opts.today, 365) };
    case "custom": {
      let from = ymd(opts.from) ?? recentExitWindow(opts.today).from;
      let to = ymd(opts.to) ?? opts.today;
      if (from > to) [from, to] = [to, from];
      return { kind: "between", from, to, custom: { from, to } };
    }
    default:
      return { kind: "all" };
  }
}

export function inRange(row: Pick<ExitRow, "countDate" | "systemBulk">, w: RangeWindow): boolean {
  if (w.kind === "all") return true;
  if (!row.countDate) return false;
  // 🔴 양끝 창은 운영실 '퇴원생' 카드와 **같은 함수** — 이번 달 판정이 두 화면에서 갈리지 않게(kpi-wiring 가드).
  //    퇴원은 퇴원월(수강료 기준) 날짜로 판정한다 — 운영실 카드도 같은 날짜(`exitDate`)를 본다.
  return inWithdrawalWindow({ withdrawnAt: row.countDate, systemBulk: row.systemBulk }, w.from, w.to);
}

export type TypeKey = "all" | ExitKind;

export function parseType(v: string | undefined): TypeKey {
  return v === "withdrawn" || v === "subject-ended" ? v : "all";
}

/** 날짜 늦은 순(같으면 이름) — 퇴원과 수강종료가 한 목록에서 섞여도 순서가 결정적이다. */
export function sortExitRows(rows: ExitRow[]): ExitRow[] {
  return rows.sort(
    (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name, "ko") || a.key.localeCompare(b.key),
  );
}

type WithdrawnInput = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 등록일(`students.enrolled_at`) — 조기 퇴원 판정 재료. */
  enrolledAt?: string | null;
  withdrawnAt: string | null;
  /** 기간 판정 날짜(퇴원월 기준) — 없으면 퇴원일. */
  exitDate?: string | null;
  lastClassName: string | null;
  lastClassSubject: string | null;
  lastClassEnglishTrack?: string | null;
  withdrawalReason: string | null;
  metadata: {
    reason?: string | null;
    detail?: string | null;
    consultation?: { adminCalledParent: boolean; teacherCalledParent: boolean; talkedWithStudent: boolean };
  } | null;
  systemBulk: boolean;
  exitSubjects?: string[];
  memoText?: string | null;
  cleanup?: boolean;
};

type SubjectEndedInput = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  activeSubjects: string[];
  endedDetail: {
    subject: string;
    endedAt: string | null;
    /** 달 판정 날짜 — 그 과목 수업료를 낸 마지막 달(`getSubjectEndedStudents`) · 없으면 종료일. */
    countAt?: string | null;
    className: string | null;
    englishTrack: string | null;
    reason?: string | null;
    detail?: string | null;
    memo?: string | null;
  }[];
};

/** 퇴원 목록 + 수강종료 목록 → 한 목록(정렬 전). */
export function toExitRows(withdrawn: readonly WithdrawnInput[], subjectEnded: readonly SubjectEndedInput[]): ExitRow[] {
  const out: ExitRow[] = [];
  for (const r of withdrawn) {
    const c = r.metadata?.consultation;
    out.push({
      key: r.id,
      studentId: r.id,
      kind: "withdrawn",
      name: r.name,
      school: r.school,
      grade: r.grade,
      date: r.withdrawnAt ? r.withdrawnAt.slice(0, 10) : null,
      countDate: r.exitDate ?? (r.withdrawnAt ? r.withdrawnAt.slice(0, 10) : null),
      // 과목을 못 모으면(수강 이력 없음) 마지막 반 과목으로 — 둘 다 없으면 과목 미상.
      subjects: r.exitSubjects?.length ? r.exitSubjects : r.lastClassSubject ? [r.lastClassSubject] : [],
      className: r.lastClassName,
      programSubject: r.lastClassSubject,
      englishTrack: r.lastClassEnglishTrack ?? null,
      systemBulk: r.systemBulk,
      reasonKey: r.metadata?.reason ?? null,
      reasonLabel: r.withdrawalReason,
      detail: detailFor(r.metadata?.reason, r.metadata?.detail),
      consulted: !!c && (c.adminCalledParent || c.teacherCalledParent || c.talkedWithStudent),
      memo: r.memoText ?? null,
      cleanup: r.cleanup ?? false,
      // 시스템 정리는 퇴원일이 장부 날짜라 며칠 만에 그만뒀는지 말할 수 없다.
      tenureDays: r.systemBulk ? null : tenureDays(r.enrolledAt, r.withdrawnAt),
    });
  }
  for (const s of subjectEnded) {
    for (const d of s.endedDetail) {
      out.push({
        key: `${s.id}|${d.subject}`,
        studentId: s.id,
        kind: "subject-ended",
        name: s.name,
        school: s.school,
        grade: s.grade,
        date: d.endedAt ? d.endedAt.slice(0, 10) : null,
        countDate: (d.countAt ?? d.endedAt)?.slice(0, 10) ?? null,
        subjects: [d.subject],
        className: d.className,
        programSubject: d.subject,
        englishTrack: d.englishTrack,
        systemBulk: false,
        reasonKey: normalizeReason(d.reason),
        // 표시는 원문 보존(‘종강’·‘반 폐지’는 그대로, 표준 키·표기 흔들림만 한글로 — reasonDisplay).
        reasonLabel: reasonDisplay(d.reason),
        detail: detailFor(d.reason, d.detail),
        consulted: null,
        memo: d.memo ?? null,
        cleanup: false,
        tenureDays: null,
        activeSubjects: s.activeSubjects,
        onHold: s.status === "on_hold",
      });
    }
  }
  return out;
}
