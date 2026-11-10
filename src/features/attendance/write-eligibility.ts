/**
 * 강사(scoped) 출결 쓰기의 **학생 자격** — 단건·일괄·범위가 함께 쓰는 판정 한 벌(수정 계획 P1-A, 결정 #5).
 *
 * 예전엔 세 경로가 손으로 따로 썼고 이미 어긋나 있었다(단건만 기존 기록·native를 보고, 범위는 수업 나누기도 안 봤다).
 * 같은 칸이 한 칸씩 고치면 되고 드래그·붙여넣기면 막혔다.
 *
 * 규칙:
 *  · **새 행을 만들 수 있는 근거** = 그날 수강 · 보강 예약(서버 표) · 수업 나누기로 들어옴(서버 표) · native 보강 참여(취소 아님)
 *  · **기존 기록**은 근거가 아니라 **정정 허가**다 — 같은 학생·반·날짜에 이미 있는 행을 고치는 것만. 그것만으로 다른 교시의
 *    새 행을 만들지 않는다(보강으로 하루 열어 둔 칸이 다른 교시로 번지지 않게).
 *  · 담당 반·자기 출석부·7일 창은 이 함수 밖(불변조건 — 호출부가 먼저 본다).
 *  · 클라이언트가 보낸 플래그(`allowMakeup`)는 여기 들어오지 않는다 — 서버가 확인한 사실만.
 */
export type WriteEligibilityFacts = {
  /** 그날 수강 중 */
  enrolled: boolean;
  /** 그날 그 반 보강 예약(0264a) */
  reserved: boolean;
  /** 그날 수업 나누기로 이 반에 들어옴(0351a) */
  splitInto: boolean;
  /** 취소되지 않은 native 보강 참여 */
  native: boolean;
  /** 같은 학생·반·날짜에 이미 기록이 있다 */
  hasRecord: boolean;
};

/** `create` = 새 행까지 · `correct` = 있는 행 정정만 · `none` = 쓸 수 없음 */
export type WriteEligibility = "create" | "correct" | "none";

export function writeEligibility(f: WriteEligibilityFacts): WriteEligibility {
  if (f.enrolled || f.reserved || f.splitInto || f.native) return "create";
  if (f.hasRecord) return "correct";
  return "none";
}

/**
 * 정정만 허가된 칸이 쓰기에서 새 행을 만들려 하는가 — 그러면 그 칸은 쓰지 않는다.
 * @param willInsert 이 칸 저장이 새 행을 하나라도 넣는가(고칠 행이 없거나, 다른 교시 행을 새로 만들 때)
 */
export function blockedByCorrectOnly(eligibility: WriteEligibility, willInsert: boolean): boolean {
  return eligibility === "correct" && willInsert;
}

export const CORRECT_ONLY_MESSAGE = "이 반 수강생이 아니어서 새 기록은 만들 수 없습니다 — 이미 있는 기록만 고칠 수 있습니다";
