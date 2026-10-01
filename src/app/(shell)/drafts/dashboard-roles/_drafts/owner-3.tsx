"use client";

/** 원장 시안 3 — 일정 중심 "오늘 하루". 과목별 수업 띠(시간축) + 오늘 일정 + 어제 결석, 돈은 접는다. */
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { Panel, Row, ToneBadge } from "../_components/parts";
import { ACADEMY, DESK, manwon, subjectFake } from "../_data/fake";

const START = 14 * 60;
const SPAN = 8 * 60;
const HOURS = [14, 15, 16, 17, 18, 19, 20, 21, 22];

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function Owner3() {
  const maps = useSubjectMaps();
  const m = ACADEMY.money;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="오늘 수업 띠" note="지금 17:40 기준">
        <div className="relative ml-20 h-6">
          {HOURS.map((h) => (
            <span key={h} className="num absolute -translate-x-1/2 text-xs" style={{ left: `${((h * 60 - START) / SPAN) * 100}%` }}>
              {h}시
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {maps.options.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <span className="w-18 shrink-0 truncate text-sm font-bold">{o.label}</span>
              <div className="bg-bg-soft relative h-10 flex-1 rounded-lg">
                <span className="bg-danger absolute top-0 bottom-0 w-0.5" style={{ left: `${((17 * 60 + 40 - START) / SPAN) * 100}%` }} />
                {subjectFake(o.value).classes.map((c) => (
                  <span
                    key={c.name}
                    className={`absolute top-1 bottom-1 truncate rounded-md px-1.5 text-xs leading-8 font-bold ${SUBJECT_SOFT[maps.colorOf(o.value)]}`}
                    style={{ left: `${((minutes(c.time) - START) / SPAN) * 100}%`, width: `${(60 / SPAN) * 100}%` }}
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="오늘 일정" count={`${DESK.timeline.length}건`}>
          {DESK.timeline.map((t) => (
            <Row key={t.time} name={`${t.time} · ${t.who}`} desc={t.note} right={<ToneBadge tone="info">{t.kind}</ToneBadge>} />
          ))}
        </Panel>
        <Panel title="어제 결석" count={`${ACADEMY.kpi[6].value}명`}>
          {subjectFake(maps.options[0]?.value ?? "").absences.map((a) => (
            <Row
              key={a.name}
              name={`${a.name} · ${a.school}`}
              desc={a.className}
              right={<ToneBadge tone={a.makeup === "보강 예약됨" ? "special" : "critical"}>{a.makeup}</ToneBadge>}
            />
          ))}
        </Panel>
      </div>
      <details className="bg-card shadow-card rounded-2xl px-4 py-3">
        <summary className="cursor-pointer text-sm font-bold">
          돈 · 직원 (접힘) — 실청구 {manwon(m.billed)} · 미수 {manwon(m.unpaid)} · 정산 예정 {manwon(m.payout)}
        </summary>
        <p className="mt-2 text-sm">펼치면 시안 1의 돈 4칸과 6개월 추이가 들어간다.</p>
      </details>
    </div>
  );
}
