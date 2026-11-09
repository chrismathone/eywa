import { EyIcon } from "@/components/icons/aywa-icons";

/**
 * 학원 비서 표식 — 금색으로 채운 원 + 흰 별(원장 2026-11-09 *"아이콘을 더 티가 나는걸로"* — 테두리 별 16px는 사이드바에서 잘 안 보였다).
 * 답을 만드는 질문이 있으면(`busy` — 이 화면이 받는 것 + 다른 탭·기기에서 도는 것 · 목록을 읽은 뒤부터) 둘레에 도는 테두리
 * (원장 *"현재 답변중인 질문이 있을 경우에 로딩 테두리를 붙이면 좋을듯"*). 움직임 줄이기 설정이면 멈춘 테두리만.
 * 사이드바·모바일 위쪽 줄 버튼(`AssistantNavButton`)과 런처 버튼이 같이 쓴다.
 * 별 크기는 인라인 style로 — 공용 `Button`의 `[&_svg]:size-[1em]` 규칙이 별을 원만큼 키우지 않게(적대 리뷰 2026-11-09).
 */
export function AssistantBadge({ busy = false, size = 24 }: { busy?: boolean; size?: number }) {
  const star = Math.round(size * 0.62);
  return (
    <span aria-hidden className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {busy ? (
        <span
          data-assistant-busy-ring=""
          className="border-gold/30 border-t-gold absolute -inset-[3px] animate-spin rounded-full border-2 [animation-duration:1.1s] motion-reduce:animate-none"
        />
      ) : null}
      <span className="bg-gold text-background shadow-card flex size-full items-center justify-center rounded-full">
        <EyIcon name="sparkle" size={star} strokeWidth={2.4} style={{ width: star, height: star }} />
      </span>
    </span>
  );
}
