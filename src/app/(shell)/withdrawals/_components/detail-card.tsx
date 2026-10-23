import type { ReactNode } from "react";

/** 퇴원 상세의 카드 껍데기 — 사유·상담 추적·퇴원보고서·콜&상담이 같은 모양을 쓴다. */
export function DetailCard({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-card border-border space-y-3 rounded-2xl border p-5">
      <h3 className="eyebrow inline-flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
