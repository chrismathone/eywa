/**
 * **시간표 X 겹침 — 석 달 퇴원·수강종료** 순수 규칙(IO 없음, Vitest). 원장 2026-10-14 *"시간표에서 x 를 눌러서 퇴원목록을
 * 띄울 수 있는 방법"* → *"오버레이로 마우스 옆에"* · *"현재 기준으로 3개월치 퇴원을 열로 나눠서"* · *"강사별로 색상"* · *"월만 표시"*.
 *
 * 🔑 한 열 = 한 달(퇴원일·수강 종료일이 속한 달 — 퇴원관리 '이번 달'과 같은 창 `withdrawalMonthWindow`).
 * 🔑 줄은 퇴원관리 한 목록과 같은 줄이다(퇴원 = 학생 한 줄 · 수강종료 = 학생 × 끊은 과목 한 줄). 묶음 = **그때 담임**.
 * 🔴 이사·질병·권고퇴원·졸업은 줄을 긋고 **건수에서 뺀다**(강사 탓이 아닌 퇴원 — 강사평가 퇴원율과 같은 네 사유).
 * 🔴 휴원은 건수에 넣지 않는다. 휴원 시작일은 저장되지 않아(수강의 '대기' 표시뿐) **이번 달 열에만 '지금 휴원 중'**으로 보인다.
 * ⚠️ 시간표엔 인원 숫자를 두지 않는다는 결정(2026-09-28)의 예외다 — X를 눌렀을 때만, 달을 적고, 퇴원관리와 같은 기준으로.
 */
import { REASON_LABEL, normalizeReason, reasonDisplay, type WithdrawalReason } from "./types";

export type OverlayKind = "withdrawn" | "subject-ended";

/** 서버가 모은 한 줄(퇴원 = 학생, 수강종료 = 학생 × 과목). */
export type OverlayExitInput = {
  key: string;
  kind: OverlayKind;
  name: string;
  schoolGrade: string;
  /** 퇴원일 또는 그 과목 수강이 끝난 날(`YYYY-MM-DD`). */
  date: string;
  /** 사유 원문 — 표준 키(`relocation`)일 수도, 사람이 적은 글(`이사`·`종강`)일 수도 있다. */
  reasonRaw: string | null;
  memo: string | null;
  /** 그때 담임 표시명 — 못 살리면 null('담임 미상'). */
  teacher: string | null;
  /**
   * 담임 기록이 없어 **추정한** 선생님이면 그 근거(`마지막 보고서 작성자 9/30`) — 기록으로 확인했으면 null.
   * 작성자는 담임이 아니다([[#93]] 대리 작성) → 화면이 '추정'을 밝힌다(학생 상세 '지난 수업'과 같은 근거).
   */
  teacherNote?: string | null;
  /** 수강종료 — 아직 다니는 과목 라벨(마우스를 올리면 보인다). */
  keepSubjects?: string[];
};

export type OverlayHoldInput = { key: string; name: string; schoolGrade: string; teacher: string | null; className: string | null };

export type OverlayRow = {
  key: string;
  kind: OverlayKind;
  name: string;
  schoolGrade: string;
  /** `10/2` */
  dateLabel: string;
  /** 줄에 적는 사유 — 메모가 있으면 메모, 없으면 사유 라벨. */
  reason: string;
  /** 마우스를 올리면 보이는 전체 — `사유 · 메모 · 영어 계속 다님`(조사는 과목 이름에 따라 갈려 붙이지 않는다). */
  reasonTitle: string;
  excluded: boolean;
  /** 선생님을 추정했으면 그 근거(툴팁 카드 끝 줄에도 붙는다). */
  teacherNote: string | null;
};

/** `inferred` = 그 묶음에서 선생님을 추정한 줄 수(머리에 '추정' 표식). */
export type OverlayGroup = { teacher: string | null; count: number; inferred: number; rows: OverlayRow[] };

export type OverlayMonth = {
  month: string;
  label: string;
  live: boolean;
  counts: { withdrawn: number; subjectEnded: number; excluded: number };
  groups: OverlayGroup[];
  /**
   * 그 달 담임 중 센 건수가 0인 선생님(가나다순). **null = 가릴 수 없는 달**(담임 기록 이전 · 기록을 못 읽음 ·
   * 담임을 모르는 퇴원 줄이 있음) — "0명"이라고 단정하지 않는다(강사평가에 쓰이는 화면이라 틀린 0이 가장 나쁘다).
   */
  zero: string[] | null;
  /** 지금 휴원 중 — 이번 달 열에만(지난 달은 null). */
  holds: OverlayHoldInput[] | null;
};

/** 서버가 화면에 넘기는 석 달 묶음(`getExitOverlay`). */
export type ExitOverlayData = {
  subjectLabel: string;
  anchor: string;
  /** 왼쪽부터 anchor · 지난달 · 지지난달. */
  months: OverlayMonth[];
  tints: Record<string, string>;
  canNewer: boolean;
  canOlder: boolean;
  /** 같은 석 달·같은 과목으로 여는 퇴원관리. */
  withdrawalsHref: string;
};

/** 건수에서 빼는 사유 — 강사평가 퇴원율이 빼는 것과 같은 넷(원장 2026-10-13). */
export const EXCLUDED_EXIT_REASONS: ReadonlySet<WithdrawalReason> = new Set(["relocation", "illness", "advised", "graduated"]);

const LABEL_TO_KEY = new Map(Object.entries(REASON_LABEL).map(([k, v]) => [v, k as WithdrawalReason]));

/**
 * 사유 원문 → 표준 키. 표준 키·표기 흔들림(`moved`)은 그대로, 사람이 **라벨과 같은 글**을 적은 것(`이사`)도 키로 본다.
 * 그 밖의 자유 글(`종강`·`반 이동`)은 키가 아니다(null) — '기타'로 뭉개면 제외 판정이 글자에 따라 흔들린다.
 */
export function reasonKeyOf(raw: string | null | undefined): WithdrawalReason | null {
  const text = raw?.trim();
  if (!text) return null;
  if (text in REASON_LABEL) return text as WithdrawalReason;
  const byLabel = LABEL_TO_KEY.get(text);
  if (byLabel) return byLabel;
  const norm = normalizeReason(text);
  return norm && norm !== "other" ? norm : null;
}

export function isExcludedExit(raw: string | null | undefined): boolean {
  const key = reasonKeyOf(raw);
  return key != null && EXCLUDED_EXIT_REASONS.has(key);
}

/** `2026-10-02` → `10/2`. */
export function dayLabel(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 열 머리 — 올해면 `10월`, 아니면 `2025년 12월`. */
export function monthHeading(month: string, today: string): string {
  const m = `${Number(month.slice(5, 7))}월`;
  return month.slice(0, 4) === today.slice(0, 4) ? m : `${month.slice(0, 4)}년 ${m}`;
}

function toRow(e: OverlayExitInput): OverlayRow {
  const label = reasonDisplay(e.reasonRaw) ?? "미기재";
  const keep = e.kind === "subject-ended" && e.keepSubjects?.length ? `${e.keepSubjects.join("·")} 계속 다님` : null;
  return {
    key: e.key,
    kind: e.kind,
    name: e.name,
    schoolGrade: e.schoolGrade,
    dateLabel: dayLabel(e.date),
    // 제외 줄은 왜 빠졌는지가 보이게 사유 라벨을 적는다(메모가 '대전으로'면 이사인지 안 보인다).
    reason: isExcludedExit(e.reasonRaw) ? label : (e.memo ?? label),
    reasonTitle: [label, e.memo, keep, e.teacherNote ? `선생님 추정 — ${e.teacherNote}` : null].filter(Boolean).join(" · "),
    excluded: isExcludedExit(e.reasonRaw),
    teacherNote: e.teacherNote ?? null,
  };
}

const byKo = (a: string, b: string) => a.localeCompare(b, "ko");

/** 한 달 열 — 묶음은 센 건수 많은 순(같으면 가나다, 담임 미상은 맨 뒤), 줄은 날짜순. */
export function buildOverlayMonth(input: {
  month: string;
  today: string;
  exits: readonly OverlayExitInput[];
  /**
   * '퇴원 0' 후보 — 그 달 담임 중 **자기 반에서 센 퇴원이 없는** 선생님(서버가 반·날짜로 이미 거른 것). 여기서는
   * 이름으로 한 번 더 거른다(묶음에 센 줄이 있는 이름은 빠진다). null = 가릴 수 없는 달.
   */
  homeroomTeachers: readonly string[] | null;
  holds: readonly OverlayHoldInput[] | null;
}): OverlayMonth {
  const mine = input.exits.filter((e) => e.date.slice(0, 7) === input.month);
  const byTeacher = new Map<string | null, OverlayExitInput[]>();
  for (const e of mine) {
    const list = byTeacher.get(e.teacher) ?? [];
    list.push(e);
    byTeacher.set(e.teacher, list);
  }
  const groups: OverlayGroup[] = [...byTeacher.entries()].map(([teacher, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || byKo(a.name, b.name) || a.key.localeCompare(b.key));
    const rows = sorted.map(toRow);
    return { teacher, count: rows.filter((r) => !r.excluded).length, inferred: rows.filter((r) => r.teacherNote).length, rows };
  });
  groups.sort((a, b) => {
    if ((a.teacher == null) !== (b.teacher == null)) return a.teacher == null ? 1 : -1;
    return b.count - a.count || byKo(a.teacher ?? "", b.teacher ?? "");
  });
  const counted = groups.flatMap((g) => g.rows).filter((r) => !r.excluded);
  const busy = new Set(groups.filter((g) => g.count > 0).map((g) => g.teacher));
  return {
    month: input.month,
    label: monthHeading(input.month, input.today),
    live: input.month === input.today.slice(0, 7),
    counts: {
      withdrawn: counted.filter((r) => r.kind === "withdrawn").length,
      subjectEnded: counted.filter((r) => r.kind === "subject-ended").length,
      excluded: groups.flatMap((g) => g.rows).length - counted.length,
    },
    groups,
    zero: input.homeroomTeachers ? [...new Set(input.homeroomTeachers)].filter((t) => !busy.has(t)).sort(byKo) : null,
    holds: input.holds ? [...input.holds].sort((a, b) => byKo(a.teacher ?? "", b.teacher ?? "") || byKo(a.name, b.name)) : null,
  };
}

/** 키 이벤트가 겹침 단축키(X)인가 — 한글 입력 상태의 'ㅌ'도 같은 키 자리라 `code`로 본다. 입력 중·조합키·누르고 있기는 아니다. */
export function isExitOverlayHotkey(e: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}): boolean {
  if (e.code !== "KeyX" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false;
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName;
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable);
}
