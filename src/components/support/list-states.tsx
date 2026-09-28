import { SUPPORT_NOT_READY } from "@/features/support/missing";

/** 표가 아직 없거나(0294a 미적용) 조회가 실패했을 때 — 원문은 title 툴팁으로만(원문 노출 금지). */
export function SupportNotReady({ error }: { error?: { summary: string; raw: string } }) {
  return (
    <p className="bg-card shadow-card text-foreground rounded-2xl p-5 text-sm font-bold" title={error?.raw}>
      {error?.summary ?? SUPPORT_NOT_READY}
    </p>
  );
}

export function SupportEmpty({ text }: { text: string }) {
  return <p className="bg-card shadow-card text-foreground rounded-2xl p-5 text-sm">{text}</p>;
}
