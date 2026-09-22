import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { DetailsHashOpen } from "./details-hash-open";

/**
 * 운영실 **2차 구역** — 지시서 §4 *"한 화면에서 시선 앵커는 3개 이하 · 나머지는 접거나 2차"*(원장 2026-09-03
 * *"남은 결정사항은 지시서 그대로"*). 1차엔 지표·오늘 브리핑·지금 진행 중 셋만 남기고, 매니저 팀 보고(AI)·
 * 대화형 비서·최근 추세·운영 맥락은 이 접힌 줄 뒤로 내린다.
 *
 * `<details>`라 JS 없이 열리고, 접힌 줄 자체가 **한 줄 요약**(`hint`)을 나른다 — "보고가 있다/없다"처럼 1차에서
 * 알아야 할 사실은 여기 적고, 본문은 열어야 보인다. 열림 상태는 저장하지 않는다(보기 설정이 아니라 펼침이다).
 *
 * 🔴 이 안에 카드 껍데기를 또 두지 말 것(§4 "카드 안의 카드 금지") — 본문은 헤어라인·간격만으로 선다.
 */
export function SecondarySection({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  /** 접힌 줄에 함께 서는 한 줄 요약(보고 제목·기간 등). 문장이 아니라 값. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details id={id} data-help="dash-secondary" className="group border-line border-t">
      {/* 주소 해시(`#<id>`)로 들어오면 펼친다 — 알림 링크의 착지. */}
      <DetailsHashOpen id={id} />
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-1 py-3 select-none [&::-webkit-details-marker]:hidden">
        <EyIcon
          name="chevronDown"
          size={18}
          className="text-text-faint shrink-0 -rotate-90 transition-transform group-open:rotate-0"
        />
        <span className="text-foreground shrink-0 text-base font-bold">{label}</span>
        {hint ? <span className="text-text-dim min-w-0 truncate text-sm">{hint}</span> : null}
      </summary>
      <div className="px-1 pt-1 pb-5">{children}</div>
    </details>
  );
}
