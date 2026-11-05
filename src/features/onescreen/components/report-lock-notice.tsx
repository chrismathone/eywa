import { EyIcon } from "@/components/icons/aywa-icons";

/**
 * 보고서 칸이 잠긴 **까닭과 할 일**을 그 칸 자리에 글자로 적는다 — 카드·표 같은 부품(원장 2026-11-04 *"원인을 선생님이 알 수
 * 없으니까 곤란해하심"*). 지금 쓰는 곳 = '수업보고서 미발송' 반 줄(문장 = `rowLockNotice` — 나눔 줄이면 "보고서는 원래 반에서",
 * 아니면 report-optout.ts의 미발송 안내 한 문장).
 * 🔴 칸 안의 placeholder·`title`만으로는 안 된다 — 잠긴 칸은 흐리게 그려지고, `title`은 모바일에서 없는 것과 같다.
 * 결석 잠금 안내(카드 머리 아래)와 같은 자리 규약 · 색은 비활성(inert) 톤(왼쪽 색 띠 금지).
 */
export function ReportLockNotice({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p
      role="note"
      data-report-lock-notice=""
      className={`border-line bg-bg-soft text-text-dim flex items-start gap-1 rounded-md border px-2 py-1 text-xs leading-relaxed ${className}`}
    >
      <EyIcon name="info" size={13} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
