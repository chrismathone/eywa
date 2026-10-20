import { EmbedLink } from "@/components/embed-link";
import { WindowLink } from "@/components/workspace/window-link";
import type { ReactNode } from "react";
import type { CareCard } from "../types";

const TONE = {
  "집중 관리": "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
  "관찰": "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100",
  "안정": "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100",
  "판단 보류": "border-line bg-bg-soft text-foreground",
} as const;

export function StudentCareCard({ card, action }: { card: CareCard; action?: ReactNode }) {
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-foreground text-lg font-bold">학생 관리 요약</h2>
        <p className="text-text-dim mt-1 text-xs">{card.today} 기준 · 과거 기록과 최근 변화를 함께 확인합니다.</p>
      </div>
      {card.canWriteConsultation ? action : null}
    </header>
    <section className={`rounded-xl border p-4 ${TONE[card.assessment.label]}`} aria-label="지원 검토 등급">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-bold">{card.assessment.label}</h3>
        <span className="text-xs">지원 필요도를 확인하는 시범 규칙 · 퇴원 확률이 아닙니다</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">{card.assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      {card.assessment.missing.length ? <p className="mt-3 text-xs">추가 확인: {card.assessment.missing.join(" · ")}</p> : null}
      <p className="mt-2 text-xs">숙제 변화·결석 기록·후속 상담 기한으로 지원 순서를 제안합니다. 현재 퇴원 의사와 긴급한 요청은 담당자가 직접 확인해 주세요.</p>
    </section>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {card.sections.map((section) => <section key={section.key} aria-label={section.title} className="border-line bg-card min-w-0 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-foreground text-sm font-bold">{section.title}</h3>
          {section.state !== "restricted" ? <EmbedLink href={section.href} prefetch={false} className="text-primary shrink-0 text-xs hover:underline" aria-label={`${section.title} 근거 보기`}>근거 보기</EmbedLink> : null}
        </div>
        <p className={`mt-3 text-sm font-semibold ${section.state === "failed" ? "text-destructive" : "text-foreground"}`} role={section.state === "failed" ? "status" : undefined}>{section.summary}</p>
        <ul className="text-text-dim mt-2 space-y-2 text-xs leading-relaxed">
          {section.details.map((detail, index) => <li className="break-words whitespace-pre-wrap" key={index}>{detail}</li>)}
        </ul>
      </section>)}
    </div>
    <section aria-label="미완료 후속 상담" className="border-line bg-card rounded-xl border p-4">
      <h3 className="text-foreground text-sm font-bold">다음 지원과 후속 상담</h3>
      <p className="text-text-dim mt-1 text-xs">상담에서 담당자와 다음 확인일을 기록하고, 조치 후 숙제·출결·학부모 의견을 다시 확인합니다.</p>
      {card.followupsState !== "ready" ? <p className="text-text-dim mt-3 text-sm">{card.followupsState === "failed" ? "후속 상담 기록을 불러오지 못했습니다." : "후속 상담 기록은 열람 권한이 필요합니다."}</p> : card.followups.length ? <ul className="divide-line mt-3 divide-y">
        {card.followups.map((row) => <li className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm" key={row.id}>
          <div className="min-w-0 flex-1"><p className="break-words">{row.action}</p><p className="text-text-dim mt-1 text-xs">{row.date}{row.overdue ? " · 기한 경과" : " · 예정"}</p></div>
          <WindowLink href={`/consultations/${row.id}`} frameTarget="window" className="text-primary text-xs hover:underline">처리·결과 확인</WindowLink>
        </li>)}
      </ul> : <p className="text-text-dim mt-3 text-sm">현재 열람한 상담 기록에 예정된 미완료 후속조치가 없습니다.</p>}
      <p className="text-text-dim mt-3 text-xs">연락 완료와 문제 개선은 다릅니다. 성적은 다음 비교 가능한 평가에서 확인합니다.</p>
    </section>
  </div>;
}
