/**
 * "중복 병합됨" 배지 — 중복 병합으로 **흡수된 쪽**(mergee)에 표시.
 *
 * 병합은 그 학생의 수강·출결·수납을 살아남은 쪽으로 옮기고 이 행을 퇴원 처리한다. 그래서 집계(퇴원 수·
 * 등록 추이)에서는 빼지만(`students/merged.ts`) **목록에서는 감추지 않는다** — 감추면 데스크가 병합
 * 결과를 확인하거나 잘못된 병합을 되짚을 길이 함께 사라진다.
 *
 * ⚠️ 상태 배지('퇴원')와 **다른 축**이다 — 상태는 여전히 퇴원이고, 이 배지는 그 퇴원의 **사유가 병합**임을
 *    말한다. 그래서 상태 배지를 대체하지 않고 이름 옆에 나란히 선다(DupSuspectTag와 같은 자리).
 */
import { MERGED_STUDENT_LABEL } from "@/features/students/merged";

export function MergedTag({ className }: { className?: string }) {
  return (
    <span
      className={`bg-muted text-text-dim inline-flex items-center rounded-full px-1 py-[1px] align-middle text-xs font-medium whitespace-nowrap ${className ?? ""}`}
      title="중복 병합으로 다른 학생 기록에 통합된 학생입니다 — 수강·출결·수납은 남은 쪽으로 옮겨졌고, 집계(퇴원 수·등록 추이)에서는 제외됩니다."
    >
      {MERGED_STUDENT_LABEL}
    </span>
  );
}
