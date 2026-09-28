/**
 * **상담 → 신규생 체크 반자동 연결** — 순수 규칙(IO 없음, Vitest). 0294a.
 *
 * 원장 2026-09-28: *"사용자가 상담 등록할때, 학생을 지정할거 아냐? 그럼 지정된 학생이 90일 관리 학생이면
 * 자동연동되는 방향이 낫겟다. 반자동으로"* → 상담 등록·수정 화면이 그 학생의 **아직 안 한 콜 칸**을 하나 골라
 * 미리 잡아 두고, 사람이 확인(또는 '해당 없음')하고 저장하면 그 칸이 완료된다.
 *
 * 🔑 AI는 부르지 않는다 — 제안은 날짜 규칙뿐이고, **확정은 저장하는 사람**이 한다(원장 선택 1번:
 *    makeedu에서 넘어온 상담은 지금처럼 데스크가 손으로 체크).
 * 🔑 콜 칸만 연결한다 — 첫 수업 안내·OJT는 상담 기록이 아니라 교실에서 하는 일이다.
 * 🔴 **이미 완료된 칸은 제안하지도, 덮어쓰지도 않는다** — 손 체크(데스크가 한 날짜)가 이긴다.
 */
import { ONBOARDING_ITEMS, daysBetween, dueDateOf } from "./onboarding-items";

/** 상담으로 완료할 수 있는 칸 — 전화·면담으로 하는 항목만. */
export const CONSULT_LINK_ITEM_KEYS: readonly string[] = [
  "pre_call",
  "after_first_call",
  "month1_call",
  "month2_call",
  "month3_call",
];

/**
 * 기한보다 이만큼 **이르면** 그 칸을 제안하지 않는다 — 등록 닷새째의 상담을 "1개월 만족도 콜"로 잡으면
 * 정작 한 달 뒤 전화할 칸이 미리 닫힌다. 늦은 쪽엔 제한이 없다(늦게라도 한 콜은 그 칸이다).
 */
export const SUGGEST_EARLY_DAYS = 10;

/** 신규생 한 명의 과목 한 줄 — 신규생 관리 표의 과목 행과 같은 재료. */
export type NewcomerLinkRow = {
  /** 과목 키. 수강이 없으면 null(과목 무관 줄 — 저장은 `''`). */
  subject: string | null;
  enrolledOn: string;
  firstClassOn: string | null;
  /** 항목 키 → 완료일. 없거나 null이면 미완료. */
  checks: Readonly<Record<string, string | null | undefined>>;
  /** 수정 중인 상담으로 이미 체크된 항목 — 다시 열었을 때 그 선택이 그대로 보여야 한다. */
  linked?: readonly string[];
};

export type NewcomerLinkTarget = { studentId: string; rows: NewcomerLinkRow[] };

export type LinkOption = {
  key: string;
  label: string;
  due: string | null;
  /** 다른 경로(손 체크·다른 상담)로 이미 완료 — 고를 수 없다. */
  doneElsewhere: string | null;
};

/** 과목 줄의 연결 후보 — 이 상담으로 이미 체크한 칸은 '완료'가 아니라 고를 수 있는 칸이다. */
export function linkOptionsOf(row: NewcomerLinkRow): LinkOption[] {
  const anchors = { enrolledOn: row.enrolledOn, firstClassOn: row.firstClassOn };
  return ONBOARDING_ITEMS.filter((item) => CONSULT_LINK_ITEM_KEYS.includes(item.key)).map((item) => {
    const done = row.checks[item.key] ?? null;
    return {
      key: item.key,
      label: item.label,
      due: dueDateOf(item, anchors),
      doneElsewhere: done && !row.linked?.includes(item.key) ? done : null,
    };
  });
}

/**
 * 이 상담일에 미리 잡아 둘 칸 — 없으면 `""`('해당 없음').
 * - 수정 중인 상담으로 이미 체크한 칸이 있으면 그것(사람이 한 번 확정한 것).
 * - 첫 수업 **전**이면(또는 첫 수업일을 모르면) 사전 콜만.
 * - 첫 수업 **후**면 사전 콜을 빼고, 기한이 상담일과 가장 가까운 칸. 기한보다 `SUGGEST_EARLY_DAYS`일 넘게
 *   이른 칸은 뺀다.
 */
export function suggestLinkItem(row: NewcomerLinkRow, consultedOn: string): string {
  const linked = row.linked?.find((key) => CONSULT_LINK_ITEM_KEYS.includes(key));
  if (linked) return linked;
  const open = linkOptionsOf(row).filter((o) => !o.doneElsewhere);
  const beforeFirst = !row.firstClassOn || consultedOn < row.firstClassOn;
  if (beforeFirst) return open.some((o) => o.key === "pre_call") ? "pre_call" : "";
  let best: { key: string; gap: number } | null = null;
  for (const o of open) {
    if (o.key === "pre_call" || !o.due) continue;
    const early = daysBetween(consultedOn, o.due); // 양수 = 기한이 아직 남음
    if (early > SUGGEST_EARLY_DAYS) continue;
    const gap = Math.abs(early);
    if (!best || gap < best.gap) best = { key: o.key, gap };
  }
  return best?.key ?? "";
}

/**
 * 제안을 걸 **과목 줄** — 과목이 하나면 그 줄. 여럿이면 상담의 과목, 그다음 상담자의 담당 과목이 한 줄로
 * 좁혀질 때만. 🔴 못 좁히면 null — 수학 선생님의 전화로 영어 칸이 닫히면 안 된다(사람이 고른다).
 */
export function suggestSubjectRow(
  rows: readonly NewcomerLinkRow[],
  consultSubjectKey: string | null,
  counselorSubjects: readonly string[],
): NewcomerLinkRow | null {
  if (rows.length === 1) return rows[0];
  if (consultSubjectKey) {
    const hit = rows.find((r) => r.subject === consultSubjectKey);
    if (hit) return hit;
  }
  const mine = rows.filter((r) => r.subject && counselorSubjects.includes(r.subject));
  return mine.length === 1 ? mine[0] : null;
}

/** 폼 값 `과목|항목` — 과목 무관 줄은 앞이 빈 글자. */
export function encodeLinkPick(subject: string | null, itemKey: string): string {
  return `${subject ?? ""}|${itemKey}`;
}

export function decodeLinkPick(value: string): { subject: string; itemKey: string } | null {
  const i = value.indexOf("|");
  if (i < 0) return null;
  const subject = value.slice(0, i).trim();
  const itemKey = value.slice(i + 1).trim();
  if (!CONSULT_LINK_ITEM_KEYS.includes(itemKey)) return null;
  if (subject && !/^[a-z][a-z0-9_]{0,31}$/.test(subject)) return null;
  return { subject, itemKey };
}
