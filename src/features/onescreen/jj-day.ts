/**
 * 원스크린 영어 행의 **인재원 하루치 상태** — 모양·키·그림 자리 가용성. 순수 모듈(Vitest로 잠금).
 *
 * 카드에서 영어 행을 열거나 자동작성·다시 채우기를 누를 때 서버 액션(`jj-day-actions.ts`)으로 받아 화면 메모리에
 * 둔다(첫 화면에서 전원을 부르지 않는다). 받은 자료는 **미리보기와 글 조립**에만 쓴다 — 학부모 카드의 그림은
 * 저장할 때 서버가 다시 받아 보고서에 묶는다(클라이언트가 가진 JSON을 믿지 않는다, [[#77]]).
 */
import { slotAvailability, type JjReportSnapshot } from "@/features/ijw/snapshot";
import { IMAGE_SLOT_KEYS, type ImageSlotKey } from "@/features/report-templates/image-slots";

export type JjDayState =
  | { status: "ok"; snapshot: JjReportSnapshot }
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
