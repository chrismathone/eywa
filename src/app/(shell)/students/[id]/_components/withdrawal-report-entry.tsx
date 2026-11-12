import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";

/**
 * 원생 화면의 **'퇴원보고서' 입구** — 원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"*. 예전 '퇴원 처리' 자리다.
 * - `request` = 퇴원보고서 창을 이 학생을 고른 채 연다(거기서 강사 작성 요청 / 강사 작성 없이 바로 처리 중 고른다)
 * - `pending` = 진행 중인 보고서가 있다 — 열 수 있으면 그 보고서로, 아니면 글만. 다른 과목 반이 남아 있으면 `requestHref`로
 *   '다른 과목 퇴원보고서'도 함께 선다(과목이 다르면 따로 요청 — s2_0014 · 원장 2026-11-12)
 * - `note` = 요청할 수 없는 사람에게는 할 수 있는 일만 말한다
 * 서버 액션이 직접 퇴원을 거절한다 — 이 입구는 길 안내일 뿐 게이트가 아니다(#77).
 */
export type ReportEntry = { kind: "request"; href: string } | { kind: "pending"; href: string | null; requestHref?: string | null } | { kind: "note" };

export function WithdrawalReportEntry({ entry, inline = false }: { entry: ReportEntry; inline?: boolean }) {
  if (entry.kind === "pending" && entry.requestHref) {
    return (
      <>
        <WithdrawalReportEntry entry={{ kind: "pending", href: entry.href }} inline={inline} />
        <ReportLink href={entry.requestHref} label="다른 과목 퇴원보고서" inline={inline} />
      </>
    );
  }
  if (entry.kind === "note")
    return <p className="text-muted-foreground text-sm">퇴원은 퇴원보고서로 처리합니다. 관리자에게 퇴원보고서를 요청해 주세요.</p>;
  if (entry.kind === "pending" && !entry.href) return <p className="text-muted-foreground text-sm">퇴원보고서가 진행 중입니다.</p>;
  return <ReportLink href={entry.href!} label={entry.kind === "pending" ? "퇴원보고서 진행 중" : "퇴원보고서"} inline={inline} />;
}

function ReportLink({ href, label, inline }: { href: string; label: string; inline: boolean }) {
  return inline ? (
    <WindowLink href={href} title="퇴원보고서">
      <span className="text-primary text-sm font-semibold hover:underline">{label}</span>
    </WindowLink>
  ) : (
    <Button variant="outline" render={<WindowLink href={href} title="퇴원보고서" />}>
      {label}
    </Button>
  );
}
