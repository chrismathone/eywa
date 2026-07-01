import { RefreshCw } from "lucide-react";

/**
 * 목록 행에서 "이 항목은 **지난 동기화가 새로 추가**했다"를 표시하는 소형 배지.
 * 동기화가 신규 insert한 행(sync_added_at IS NOT NULL)에만 렌더 → **다음 동기화가 성공하면 사라진다**
 * (importer가 다음 실행 시작에 sync_added_at을 클리어). 즉 "이번 동기화로 새로 들어온 것"만 강조된다.
 * 상단 화면-레벨 MakeeduSyncBadge("↻ 동기화 N분 전")와 같은 ↻ 언어를 쓰되, 행마다 눈에 띄게 blue-soft로 대비를 준다.
 */
export function MakeeduOriginTag({ className }: { className?: string }) {
  return (
    <span
      className={`bg-blue-soft text-blue inline-flex items-center gap-0.5 whitespace-nowrap rounded-sm px-1 py-[1px] align-middle text-[10px] font-medium ${className ?? ""}`}
      title="지난 동기화로 새로 추가된 항목입니다 (다음 동기화가 성공하면 사라집니다)"
    >
      <RefreshCw className="size-2.5" strokeWidth={2.5} aria-hidden />
      동기화
    </span>
  );
}
