/**
 * **시간표 X 겹침 — 석 달 퇴원·수강종료** 순수 규칙(IO 없음, Vitest). 원장 2026-10-14 *"시간표에서 x 를 눌러서 퇴원목록을
 * 띄울 수 있는 방법"* → *"오버레이로 마우스 옆에"* · *"현재 기준으로 3개월치 퇴원을 열로 나눠서"* · *"강사별로 색상"* · *"월만 표시"*.
 *
 * 🔑 한 열 = 한 달(퇴원일·수강 종료일이 속한 달 — 퇴원관리 '이번 달'과 같은 창 `withdrawalMonthWindow`).
 * 🔑 줄은 퇴원관리 한 목록과 같은 줄이다(퇴원 = 학생 한 줄 · 수강종료 = 학생 × 끊은 과목 한 줄). 과목 화면이라 수강종료도
 *    **퇴원으로 함께 센다**(원장 2026-10-14 *"합쳐. 퇴원으로"*). '데이터 정리 일괄 퇴원'은 줄에서 뺀다(서버).
 * 🔑 묶음 = **강사평가 퇴원율이 그 퇴원을 넣은 선생님**(그날 담임 + 교시 담당 — 한 줄이 여러 묶음에 설 수 있다). 퇴원율에
 *    안 들어가는 줄은 '선생님 미반영' 한 묶음(`exit-overlay-teachers.ts` — 겹침은 담당을 새로 판정하지 않는다).
 * 🔴 강사 탓이 아닌 사유(원장이 고른 사유 — 기본 이사·질병·권고퇴원·졸업)·세지 않기로 한 수강종료는 줄을 긋고 **건수에서 뺀다** —
 *    강사평가 퇴원율과 같은 설정(`OverlayRules`)·같은 판정(`reason-key.ts`): 줄의 사유 칸(학생 퇴원 사유) · 함께 끝난 수강의 종료
 *    사유 중 하나라도 그 사유면(원장 2026-10-14 *"모든 곳에서"* · 수강종료도 같다).
 * 🔴 휴원은 건수에 넣지 않는다. 휴원 시작일은 저장되지 않아(수강의 '대기' 표시뿐) **이번 달 열에만 '지금 휴원 중'**으로 보인다.
 * ⚠️ 시간표엔 인원 숫자를 두지 않는다는 결정(2026-09-28)의 예외다 — X를 눌렀을 때만, 달을 적고, 퇴원관리와 같은 기준으로.
 */
import { REASON_LABEL, reasonDisplay, type WithdrawalReason } from "./types";
import { excludedReasonOf } from "./reason-key";

export { isExcludedExit, reasonKeyOf } from "./reason-key";

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
  /** 함께 끝난 수강의 종료 사유 — 사유 칸과 함께 강사 탓이 아닌 사유인지 본다. */
  endReasons?: readonly (string | null)[];
  memo: string | null;
  /** 강사평가 퇴원율이 이 퇴원을 넣은 선생님 표시명 — 비면 '선생님 미반영'. */
  teachers: readonly string[];
  /** 퇴원율이 이 퇴원을 셌나(선생님 id 기준 — 이름을 못 찾은 선생님도). 없으면 `teachers`로 본다. */
  counted?: boolean;
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
};

/** `teacher` null = 강사평가 퇴원율에 들어가지 않는 줄 묶음. */
export type OverlayGroup = { teacher: string | null; count: number; rows: OverlayRow[] };

export type OverlayMonth = {
  month: string;
  label: string;
  live: boolean;
  /** 센 퇴원(수강종료 포함, 줄 그은 것 제외) — 한 줄이 여러 묶음에 서도 한 번. */
  count: number;
  groups: OverlayGroup[];
  /** 그 달 이 과목 강사평가 퇴원율이 0인 선생님(가나다순) — 이 겹침에 센 줄이 있는 선생님은 뺀다. */
  zero: string[];
  /** 지금 휴원 중 — 이번 달 열에만(지난 달은 null). */
  holds: OverlayHoldInput[] | null;
};

/** 건수에서 빼는 규칙 — 강사평가 퇴원율 세는 법과 같은 원장 설정(뺄 사유 · 수강종료를 셀지). 서버가 그 설정을 그대로 넘긴다. */
export type OverlayRules = { excludeReasons: readonly string[]; countEnded: boolean };

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
  /** 카드 아래 안내의 세는 법 한 줄(`exclusionNote`). */
  rulesNote: string;
};

/** 카드 아래 안내 — 원장이 고른 세는 법을 그대로 적는다(사유는 사유 표 순서). */
export function exclusionNote(rules: OverlayRules): string {
  const reasons = (Object.keys(REASON_LABEL) as WithdrawalReason[]).filter((k) => rules.excludeReasons.includes(k)).map((k) => REASON_LABEL[k]);
  const off = [...reasons, ...(rules.countEnded ? [] : ["과목만 끊은 수강종료"])];
  return [rules.countEnded ? "과목을 끊은 학생도 퇴원으로 셉니다." : "", off.length ? `줄을 긋고 건수에서 빼는 것: ${off.join(" · ")}.` : ""].filter(Boolean).join(" ");
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

function toRow(e: OverlayExitInput, rules: OverlayRules): OverlayRow {
  const label = reasonDisplay(e.reasonRaw) ?? "미기재";
  const keep = e.kind === "subject-ended" && e.keepSubjects?.length ? `${e.keepSubjects.join("·")} 계속 다님` : null;
  const off = excludedReasonOf([e.reasonRaw, ...(e.endReasons ?? [])], rules.excludeReasons);
  const offLabel = off ? REASON_LABEL[off] : null;
  // 수강종료를 세지 않기로 했어도 퇴원율이 '퇴원'으로 센 줄(선생님이 붙은 줄 — 한 달 넘게 뒤에 다른 과목을 시작)은 긋지 않는다.
  const endedOff = e.kind === "subject-ended" && !rules.countEnded && !(e.counted ?? e.teachers.length > 0);
  return {
    key: e.key, kind: e.kind, name: e.name, schoolGrade: e.schoolGrade, dateLabel: dayLabel(e.date),
    // 제외 줄은 왜 빠졌는지가 보이게 그 사유 라벨을 적는다(메모가 '대전으로'면 이사인지 안 보인다).
    reason: offLabel ?? e.memo ?? label,
    reasonTitle: [label, offLabel !== label ? offLabel : null, e.memo, keep, !off && endedOff ? "수강종료는 세지 않음" : null].filter(Boolean).join(" · "),
    excluded: !!off || endedOff,
  };
}

const byKo = (a: string, b: string) => a.localeCompare(b, "ko");

/** 한 달 열 — 묶음은 센 건수 많은 순(같으면 가나다, 선생님 미반영은 맨 뒤), 줄은 날짜순. */
export function buildOverlayMonth(input: {
  month: string;
  today: string;
  exits: readonly OverlayExitInput[];
  /** 그 달 이 과목 강사평가 퇴원율 0인 선생님(서버가 같은 계산에서 꺼낸 것) — 여기서 묶음에 센 줄이 있는 이름은 한 번 더 뺀다. */
  zeroTeachers: readonly string[];
  holds: readonly OverlayHoldInput[] | null;
  rules: OverlayRules;
}): OverlayMonth {
  const mine = input.exits.filter((e) => e.date.slice(0, 7) === input.month);
  const byTeacher = new Map<string | null, OverlayExitInput[]>();
  for (const e of mine) {
    for (const t of e.teachers.length ? [...new Set(e.teachers)] : [null]) {
      const list = byTeacher.get(t) ?? [];
      list.push(e);
      byTeacher.set(t, list);
    }
  }
  const groups: OverlayGroup[] = [...byTeacher.entries()].map(([teacher, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || byKo(a.name, b.name) || a.key.localeCompare(b.key));
    const rows = sorted.map((e) => toRow(e, input.rules));
    return { teacher, count: rows.filter((r) => !r.excluded).length, rows };
  });
  groups.sort((a, b) => {
    if ((a.teacher == null) !== (b.teacher == null)) return a.teacher == null ? 1 : -1;
    return b.count - a.count || byKo(a.teacher ?? "", b.teacher ?? "");
  });
  const busy = new Set(groups.filter((g) => g.count > 0).map((g) => g.teacher));
  return {
    month: input.month,
    label: monthHeading(input.month, input.today),
    live: input.month === input.today.slice(0, 7),
    count: mine.filter((e) => !toRow(e, input.rules).excluded).length,
    groups,
    zero: [...new Set(input.zeroTeachers)].filter((t) => !busy.has(t)).sort(byKo),
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
