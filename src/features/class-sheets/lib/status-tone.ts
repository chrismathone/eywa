// 상태(마크) 색 톤 — **원본 시트의 색 코딩을 그대로 옮긴 것**이다.
// 실 시트(`중등E_초등 브릿지 A` 7/27-31 탭) 실측:
//   · "완"          → 연녹 #d9ead3   (완료)
//   · "…결석"       → 연분홍 #f4cccc (결석)
//   · "지각해서 …미완" → 연노랑 #fff2cc (주의)
// 강사가 원본에서 색으로 훑던 정보를 eywa에서 회색 글씨로만 보여주면 "가독성이 떨어진다"가 된다.
//
// 상태는 enum이 아니라 **자유 입력**(bulk.ts STATUS_CHIPS는 제안일 뿐)이라 색은 **부분일치**로 정한다.
// 판정 순서가 곧 규칙이다: 결석 > 주의(미완·지각·안침·조퇴·보강) > 완. "미완"이 "완"에 먹히면 안 된다.
export type StatusTone = "done" | "absent" | "warn" | "neutral";

const ABSENT = ["결석", "결과", "무단"];
const WARN = ["미완", "지각", "안침", "조퇴", "보강", "부분", "숙제안"];

export function statusTone(value: string | null | undefined): StatusTone {
  const v = (value ?? "").trim();
  if (v === "") return "neutral";
  if (ABSENT.some((k) => v.includes(k))) return "absent";
  if (WARN.some((k) => v.includes(k))) return "warn";
  if (v.includes("완")) return "done";
  return "neutral";
}

/**
 * 톤 → 셀/칩 클래스. 상태를 보여주는 모든 자리(개별 셀·일괄 입력 칩)가 **같은 색**을 쓰도록 단일 소스.
 * ⚠️ 서버가 import하지 않는 순수 상수 모듈이다("use client" 금지 — gotcha #81의 반대 방향 보호).
 */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  done: "border-green/40 bg-green-soft text-green font-bold",
  absent: "border-danger/40 bg-danger-soft text-danger font-bold",
  warn: "border-amber/40 bg-amber-soft text-amber font-bold",
  neutral: "border-line-strong text-foreground",
};
