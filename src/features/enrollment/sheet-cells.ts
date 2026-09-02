/**
 * 등록상담 **시트형 목록뷰**의 칸 규약 — 순수 함수(Vitest).
 *
 * 원장 2026-09-02: *"우리 칸반뷰를 시트처럼 목록뷰화"* → *"칸반뷰를 목록뷰로 보고 싶은건데, 시트 내용을 넣은거
 * 아닌가?"* → *"상태를 칸반뷰처럼 4단계로 통합"*. 즉 **내용은 칸반 카드**(이름·학교학년·표식·상담사·요약·경과)이고
 * **모양만** 옛 콜앤상담 시트(`2025.6·7월 입학상담` 탭)의 것 — 왼쪽 상태 색 칸 + 위의 색 범례 + 고정 열 제목 + 격자.
 * 🔴 시트의 열(콜일자·수신자·유입경로·주소·결제·비고…)을 DB에서 끌어와 채우지 않는다(한 번 그렇게 만들었다가
 *    걷어냈다 — 지시는 "시트 내용"이 아니라 "칸반을 목록으로"였다).
 *
 * ⚠️ 일반 모듈이어야 한다 — 클라(표)와 테스트가 같이 읽는다(`server-only` 금지, [[#61]]).
 */
import type { PillColor } from "@/components/atoms/pill";
import { BOARD_STAGES, stageOfCard } from "./board-stages";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → "M/D" (시트의 날짜 표기). 날짜 형식이 아니면 null — 없는 날짜를 지어내지 않는다. */
export function sheetDate(ymd: string | null | undefined): string | null {
  if (!ymd || !YMD.test(ymd)) return null;
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
}

/**
 * 상태 범례(시트 1~2행의 색 범례에 해당) — 🔴 **칸반과 같은 4단계**(원장 2026-09-02 *"상태를 칸반뷰처럼 4단계로
 * 통합"* — 처음엔 outcome 원값 7종을 그대로 세웠는데 한 화면에 7색이 서 칸반과 다른 어휘가 됐다). 라벨·색은
 * [board-stages](./board-stages.ts) `BOARD_STAGES` 그대로라 칸 이름·상태 드롭다운과 절대 갈리지 않는다.
 * 반 배정은 상태가 아니라 **표식**(칸반 카드와 같은 `cardMarkOf` 규칙)이라 범례에 없다.
 */
export const SHEET_LEGEND: { label: string; color: PillColor }[] = BOARD_STAGES.map((s) => ({
  label: s.label,
  color: s.color,
}));

/**
 * 상태 칸 — 칸반의 칸 판정 `stageOfCard` 그대로(배정(수강 ≥ 1)이 outcome을 이겨 '등록 완료'). 옛 outcome 원값
 * (예약·노쇼·AI 완료…)은 상세 화면에 남아 있고 여기선 칸으로 접는다.
 */
export function statusCellOf(row: { outcome: string; assignedClassCount: number }): {
  label: string;
  color: PillColor;
} {
  const key = stageOfCard(row);
  const stage = BOARD_STAGES.find((s) => s.key === key) ?? BOARD_STAGES[0]!;
  return { label: stage.label, color: stage.color };
}
