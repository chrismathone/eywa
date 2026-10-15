// 학생 상태 한글 라벨(순수, 서버/클라 공용) — UI에 raw enum(withdrawn 등) 노출 금지(사용자 반복 지적).
// 새 표시 코드는 이 모듈을 쓸 것: 미지의 코드도 최소한 그대로 노출하지 말고 라벨 폴백을 거친다.
import type { PillColor } from "@/components/atoms/pill";
import { type SemanticTone, toneColor } from "@/lib/design/semantic-color";

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

/**
 * 상태 → 의미(tone). 색은 [`semantic-color.ts`](src/lib/design/semantic-color.ts)가 정한다 —
 * 여기서 PillColor를 직접 고르면 같은 뜻이 화면마다 갈린다.
 * ⚠️ `enrolled`는 v4에서 brand(네이비) → positive(그린)로 바꿨다: 과목 색(수학=blue)과 색상각이
 *    4.8°라 학생목록에서 '재원' 배지와 '수학' 배지가 구분되지 않았고, "정상"은 앱 전역이 그린이다.
 * ⚠️ `prospect`(예비)는 caution이 아니라 info — 아직 아무 문제가 없는 "문의 단계"다(구 amber는
 *    휴원과 같은 색이라 목록에서 둘이 섞였다).
 */
export const STUDENT_STATUS_TONE: Record<string, SemanticTone> = {
  prospect: "info",
  consulted: "info",
  enrolled: "positive",
  on_hold: "caution",
  withdrawn: "inert",
};

/**
 * 같은 상태의 **영어 라벨** — 강사뷰 영어 화면(원장 2026-09-04 *"강사가 접근 가능한 모든 메뉴를 전환"*).
 *
 * 🔴 **한글 맵 바로 옆에 둔다** — 나누면 상태가 늘 때 한쪽만 채워지고 raw enum(`on_hold`)이 샌다.
 * ⚠️ 표시 전용이다 — 저장값·필터 파라미터는 enum 그대로다.
 */
export const STUDENT_STATUS_LABEL_EN: Record<string, string> = {
  prospect: "Prospect",
  consulted: "Consulted",
  enrolled: "Enrolled",
  on_hold: "On hold",
  withdrawn: "Withdrawn",
};

export const STUDENT_STATUS_COLOR: Record<string, PillColor> = Object.fromEntries(
  Object.entries(STUDENT_STATUS_TONE).map(([status, tone]) => [status, toneColor(tone)])
);

/** 상태 코드 → 한글 라벨. 미지의 코드는 raw 반환(디버그 가시성) — 표시 전 매핑 추가가 정석. */
export function studentStatusLabel(
  status: string | null | undefined,
  // 화면 언어 — 안 주면 한국어(기존 호출부는 한 글자도 안 바뀐다).
  lang: "ko" | "en" = "ko",
): string | null {
  if (!status) return null;
  if (lang === "en") return STUDENT_STATUS_LABEL_EN[status] ?? STUDENT_STATUS_LABEL[status] ?? status;
  return STUDENT_STATUS_LABEL[status] ?? status;
}

/**
 * 상태 배지에 필요한 것 한 벌(라벨+색). **학생 상태 배지를 그리는 모든 화면은 이걸 쓴다.**
 *
 * 종전엔 목록(`students/page.tsx`)·상세(`students/[id]/page.tsx`)·요약 카드
 * (`student-summary-view.tsx`)가 저마다 `STATUS_META`를 들고 있었고, 그래서 같은 '재원'이
 * 목록에선 네이비(primary), 상세에선 초록(chart-2)이었다 — 화면을 옮길 때마다 색이 바뀌니
 * 색으로 상태를 익힐 수가 없었다(원장 2026-08-18 리디자인 지시의 배경).
 *
 * ⚠️ 화면 파일에 `STATUS_META`를 다시 만들지 말 것. 상태가 늘면 여기 + `STUDENT_STATUS_TONE`에 더한다.
 */
export function studentStatusMeta(
  status: string | null | undefined,
  lang: "ko" | "en" = "ko",
): { label: string; color: PillColor; tone: SemanticTone } | null {
  if (!status) return null;
  const tone = STUDENT_STATUS_TONE[status] ?? "inert";
  return { label: studentStatusLabel(status, lang)!, color: toneColor(tone), tone };
}
