/**
 * 진도 컨테이너 — 이벤트 판정 순수함수 (edutrix lib/progress-analytics/container-detector.ts 이식, 규칙 동일).
 * DB 접근 없음. 컨테이너=학생의 연속 진도 "박스", 20개 엔트리(보고서)마다 정상 분할.
 * 판정 우선순위: jump_error > overlap_error > container_full > regression > forward.
 */
import type { Track } from "./curriculum-position";

export const JUMP_ERROR_THRESHOLD = 20; // 직전→신규 위치차 ≥20이면 이상(점프)
export const CONTAINER_CAPACITY = 20; // 컨테이너당 최대 엔트리(보고서) 수

export type EventKind = "forward" | "regression" | "jump_error" | "overlap_error" | "container_full";
export type CloseReason = "jump_error" | "overlap" | "full";

export type DetectInput = {
  lastPosition: number | null; // 활성 컨테이너의 직전 위치(신규면 null)
  newPosition: number; // 이번 보고서 위치
  chapterCount: number; // 이번 반영 **전** 누적 엔트리 수
  aheadStartPosition: number | null; // current 컨테이너일 때만: 활성 ahead 컨테이너 시작 위치
  track: Track;
};

export type DetectResult = {
  kind: EventKind;
  jumpSize: number; // last===null → 0, regression이면 음수 가능
  shouldClose: boolean; // 활성 컨테이너를 닫아야 하는가
  shouldOpen: boolean; // 새 컨테이너를 열어야 하는가
  closeReason: CloseReason | null;
};

/** 점프 이상 — 직전이 있고 위치차 ≥ 임계(20). */
export function detectJumpError(last: number | null, next: number): boolean {
  return last !== null && next - last >= JUMP_ERROR_THRESHOLD;
}

/** 역행(퇴행) — 직전이 있고 신규 < 직전. 에러 아님(로그용). */
export function detectRegression(last: number | null, next: number): boolean {
  return last !== null && next < last;
}

/** 컨테이너 가득 — 누적 엔트리 ≥ 용량(20). count는 이번 건 반영 전 값. */
export function detectContainerFull(count: number): boolean {
  return count >= CONTAINER_CAPACITY;
}

/** 오버랩 이상 — current 컨테이너가 활성 ahead 시작점에 도달(선행/현행 겹침). */
export function detectOverlapError(track: Track, next: number, aheadStart: number | null): boolean {
  return track === "current" && aheadStart !== null && next >= aheadStart;
}

/** 통합 판정 — 우선순위대로 첫 걸림 하나. full=archived, jump/overlap=errored로 닫힘. */
export function detectContainerEvent(input: DetectInput): DetectResult {
  const { lastPosition, newPosition, chapterCount, aheadStartPosition, track } = input;
  const jumpSize = lastPosition === null ? 0 : newPosition - lastPosition;

  if (detectJumpError(lastPosition, newPosition)) {
    return { kind: "jump_error", jumpSize, shouldClose: true, shouldOpen: true, closeReason: "jump_error" };
  }
  if (detectOverlapError(track, newPosition, aheadStartPosition)) {
    return { kind: "overlap_error", jumpSize, shouldClose: true, shouldOpen: true, closeReason: "overlap" };
  }
  if (detectContainerFull(chapterCount)) {
    return { kind: "container_full", jumpSize, shouldClose: true, shouldOpen: true, closeReason: "full" };
  }
  if (detectRegression(lastPosition, newPosition)) {
    return { kind: "regression", jumpSize, shouldClose: false, shouldOpen: false, closeReason: null };
  }
  return { kind: "forward", jumpSize, shouldClose: false, shouldOpen: false, closeReason: null };
}
