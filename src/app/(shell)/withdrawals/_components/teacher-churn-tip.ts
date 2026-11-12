import { tipProps } from "@/components/hover-tip/tip";
import { SMALL_BASE, rateText, yyMm, type ChurnCell, type ChurnMonth, type ChurnTeacherRow } from "@/features/withdrawals/teacher-churn";
import { tenureBand } from "@/features/withdrawals/teacher-churn-view";

/** "2026-11-10" → "11/10". */
export const md = (ymd: string) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "");

/**
 * 한 강사 · 한 달의 마우스 오버 카드 — 표 칸과 차트 칸이 같은 문구를 쓴다(같은 데이터는 같은 말).
 * 칸이 없으면 까닭(입사 전 · 퇴사 뒤 · 평가 대상 아님), 있으면 퇴원율 · 그만둔 학생 · 지난달 담당 + 상태.
 */
export function churnTip(row: ChurnTeacherRow, month: ChurnMonth, c: ChurnCell | undefined) {
  const title = `${row.name} · ${yyMm(month.month)}`;
  if (!c) {
    const band = tenureBand(row, month.month);
    const why = band === "before"
      ? `입사 ${row.hireDate!.slice(0, 10)} — 퇴원율은 지난달 담당 학생 기준이라 입사 다음 달부터 셉니다`
      : band === "after"
        ? `퇴사 ${row.resignDate!.slice(0, 10)} — 근무한 달까지만 셉니다`
        : "그 달은 강사평가 대상이 아니었습니다(담당 반 없음 등)";
    return tipProps({ title, lines: [why] });
  }
  const small = c.state === "ok" && c.base < SMALL_BASE;
  const open = month.partial || !c.closed;
  return tipProps({
    title,
    meta: month.partial ? `진행 중 · ${md(c.end)}까지 반영` : !c.closed ? "마감 전" : null,
    rows: [
      c.state === "ok" ? ["퇴원율", rateText(c.rate!)] : null,
      c.state !== "unreadable" ? ["그만둔 학생", `${c.counted}명`] : null,
      c.state !== "unreadable" ? ["지난달 담당", `${c.base}명`] : null,
    ],
    lines: [
      c.state === "noBase" ? "지난달 이 강사가 절반 이상 맡은 학생이 없어 퇴원율이 없습니다" : null,
      c.state === "unreadable" ? "저장된 강사평가에서 퇴원율을 읽지 못했습니다 — 직원 포트폴리오에서 확인해 주세요" : null,
      small ? `담당이 ${SMALL_BASE}명 미만이라 한 명이 그만둬도 10%p 넘게 오릅니다` : null,
      open ? "아직 마감 전 — 다음 집계에서 바뀔 수 있습니다" : null,
    ],
  });
}
