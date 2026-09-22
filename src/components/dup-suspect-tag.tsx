import { AlertTriangle } from "@/components/icons/aywa-icon-compat";

/**
 * "동명이인 확인 필요" 배지 — makeedu 동기화가 **이름 충돌로 자동 접미사**(테스트→테스트A)를 붙여 만든
 * 신규 학생(students.dup_suspect, 0078a)에 표시. 확실한 동명이인이 아니라 자동 판정이라, 같은 사람이
 * 정보 부족으로 새로 갈렸을 수도 있어(반대 방향 오류) 사람이 한 번 확인해야 한다.
 * MakeeduOriginTag(↻ 동기화)와 달리 동기화로 안 지워지고, '정상 확인' 또는 병합으로만 해제.
 */
export function DupSuspectTag({ className }: { className?: string }) {
  return (
    <span
      className={`bg-amber/15 text-amber inline-flex items-center gap-0.5 rounded-full px-1 py-[1px] align-middle text-xs font-medium whitespace-nowrap ${className ?? ""}`}
      title="동기화가 이름 겹침으로 자동 구분(접미사)한 학생입니다 — 실제 동명이인인지 확인이 필요합니다."
    >
      <AlertTriangle className="size-2.5" strokeWidth={2.5} aria-hidden />
      의심
    </span>
  );
}
