"use client";

/** 원장 시안 5 — 과목 중심 "과목별 손익". 학원설정 과목을 나란히 — 재원·신규·퇴원·실청구·정산·차액. */
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOLID } from "@/features/owner/subjects";
import { HBars, Panel, SubjectBadge } from "../_components/parts";
import { manwon, subjectFake } from "../_data/fake";

export function Owner5() {
  const maps = useSubjectMaps();
  const cols = maps.options.map((o) => {
    const f = subjectFake(o.value);
    const billed = f.enrolled * 31;
    const payout = Math.round(billed * 0.34);
    return { key: o.value, label: o.label, f, billed, payout };
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cols.map((c) => (
          <section key={c.key} className="bg-card shadow-card flex flex-col gap-2 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <SubjectBadge subject={c.key} />
              <span className="num text-xs">반 {c.f.classes.length}개</span>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              <dt>재원</dt>
              <dd className="num text-right font-bold">{c.f.enrolled}명</dd>
              <dt>이번 달 신규 · 퇴원</dt>
              <dd className="num text-right font-bold">
                <span className="text-green">+{c.f.joined}</span> / <span className="text-danger">−{c.f.left}</span>
              </dd>
              <dt>실청구</dt>
              <dd className="num text-right font-bold">{manwon(c.billed)}</dd>
              <dt>강사 정산</dt>
              <dd className="num text-right font-bold">{manwon(c.payout)}</dd>
            </dl>
            <div className="border-line mt-auto flex items-baseline justify-between border-t pt-2">
              <span className="text-sm font-bold">차액</span>
              <span className="num text-2xl font-bold">{manwon(c.billed - c.payout)}</span>
            </div>
          </section>
        ))}
      </div>
      <Panel title="과목별 실청구" note="단위 만원">
        <HBars
          items={cols.map((c) => ({ label: c.label, value: c.billed, barClass: SUBJECT_SOLID[maps.colorOf(c.key)] }))}
          format={(v) => manwon(v)}
        />
      </Panel>
    </div>
  );
}
