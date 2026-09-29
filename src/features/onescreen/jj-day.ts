/**
 * 원스크린 영어 행의 **인재원 하루치 상태** — 모양·키·그림 자리 가용성. 순수 모듈(Vitest로 잠금).
 *
 * 카드에서 영어 행을 열거나 자동작성·다시 채우기를 누를 때 서버 액션(`jj-day-actions.ts`)으로 받아 화면 메모리에
 * 둔다(첫 화면에서 전원을 부르지 않는다). 받은 자료는 **미리보기와 글 조립**에만 쓴다 — 학부모 카드의 그림은
 * 저장할 때 서버가 다시 받아 보고서에 묶는다(클라이언트가 가진 JSON을 믿지 않는다, [[#77]]).
 */
import type { IjwExamListItem } from "@/features/ijw/contract";
import { slotAvailability, type JjReportSnapshot } from "@/features/ijw/snapshot";
import { kstDateOf } from "@/lib/date-kst";
import { IMAGE_SLOT_KEYS, type ImageSlotKey } from "@/features/report-templates/image-slots";

export type JjDayState =
  /** `options` = 고를 수 있는 결과지(단어장마다 마지막 제출·최신순, 2026-09-28). 옛 응답엔 없다. */
  | { status: "ok"; snapshot: JjReportSnapshot; options?: IjwExamListItem[] }
  | { status: "unlinked" }
  /**
   * `message` = 한국어 원인(서버 문장) — 화면은 번역된 안내를 쓰고 이것은 툴팁으로만.
   * `unreachable` = **인재원 서버에** 닿지 못했다(시간 초과·연결 실패) — 화면이 잠시 자동 호출을 멈추는 유일한 근거다
   * (권한·미저장 수업외·DB 실패 같은 다른 실패로 멈추면 안 된다, 적대 재리뷰 2026-09-11).
   */
  | { status: "error"; message: string; unreachable?: boolean };

/** (학생, 날짜) → 상태. 날짜를 넘기면 새 화면이라 키에 날짜를 넣는다. */
export type JjDayCache = Readonly<Record<string, JjDayState>>;

export function jjDayKey(studentId: string, date: string): string {
  return `${studentId}|${date}`;
}

/**
 * 그림 자리마다 그릴 게 있는가 — **아는** 경우만 답한다. 아직 안 받았거나 받다 실패했으면 `null`(모름).
 * 🔑 미연결은 "안다"다(그릴 게 없다) — 모름과 섞으면 미연결 학생의 글이 영영 판정 대기로 남는다.
 */
export function jjKnownSlots(state: JjDayState | undefined): Record<ImageSlotKey, boolean> | null {
  if (!state || state.status === "error") return null;
  if (state.status === "unlinked") return Object.fromEntries(IMAGE_SLOT_KEYS.map((k) => [k, false])) as Record<ImageSlotKey, boolean>;
  return slotAvailability(state.snapshot);
}

/** 패널 한 줄 요약 — 오늘 본 시험 수 · 30학습일 동안 푼 문제 수. 자료가 없으면 null. */
export function jjDaySummary(state: JjDayState | undefined): { exams: number; answers: number } | null {
  if (state?.status !== "ok") return null;
  return { exams: state.snapshot.exams.length, answers: state.snapshot.study?.totals.answers ?? 0 };
}

/**
 * 결과지 고르기(2026-09-28 원장 *"어떤 시험인지 선택"*) — 목록 한 줄이 지금 **붙는가**.
 * 고르기가 기본(`null`)이면 "그날(KST 달력 날짜) 낸 시험"이 붙는다(서버의 하루치 규칙과 같다). 고른 값이 있으면 그 목록 그대로.
 */
export function jjOptionChecked(option: IjwExamListItem, pick: readonly string[] | null | undefined, date: string): boolean {
  if (pick) return pick.includes(option.attemptId);
  return kstDateOf(option.submittedAt) === date;
}

/**
 * 한 줄을 켜고 끈 뒤의 고르기 — 기본 상태에서 처음 누르면 **지금 붙어 있는 것**(그날 낸 시험)에서 출발한다.
 * 결과는 늘 명시 배열이다(빈 배열 = 하나도 안 붙임). 순서 = 목록 순서(최신순) — 카드도 그 순서로 그린다.
 */
export function toggleJjPick(
  options: readonly IjwExamListItem[],
  pick: readonly string[] | null | undefined,
  date: string,
  attemptId: string,
): string[] {
  const on = new Set(options.filter((o) => jjOptionChecked(o, pick, date)).map((o) => o.attemptId));
  // 목록에 없는(최신 50개 밖으로 밀린) 고른 응시도 지키고 간다.
  for (const id of pick ?? []) on.add(id);
  if (on.has(attemptId)) on.delete(attemptId);
  else on.add(attemptId);
  const order = options.map((o) => o.attemptId);
  return [...on].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib);
  });
}
