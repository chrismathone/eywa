/** 과목 관리자 시안 3 — 반 중심 "반 현황판". 내 과목 반 카드(인원·담당·출석률·보고서). 수강료·정산 없음. */
import { Meter, ToneBadge } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

export function Subject3({ subject }: DraftProps) {
  const f = subjectFake(subject);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {f.classes.map((c) => {
        const done = c.reportsDone >= c.reportsDue;
        return (
          <section key={c.name} className="bg-card shadow-card flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate text-base font-bold">{c.name}</h4>
                <p className="text-xs">
                  {c.time} · {c.room} · {c.teacher} 선생님
                </p>
              </div>
              <span className="num shrink-0 text-2xl font-bold">
                {c.students}
                <span className="text-xs font-medium">명</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>이번 주 출석률</span>
              <Meter value={c.attendRate} warnBelow={90} />
            </div>
            <div className="border-line mt-auto flex items-center justify-between border-t pt-2 text-sm">
              <span>
                보고서 <span className="num font-bold">{c.reportsDone}</span>/{c.reportsDue}
              </span>
              <ToneBadge tone={done ? "positive" : "caution"}>{done ? "작성 끝" : "작성 중"}</ToneBadge>
            </div>
          </section>
        );
      })}
    </div>
  );
}
