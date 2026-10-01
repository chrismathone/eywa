/** 실장(매니저) 시안 2 — 시간 중심 "교시 타임라인". 오늘 내 과목 수업을 위에서 아래로(지금 17:40 기준). */
import { ToneBadge } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

const NOW = 17 * 60 + 40;

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function Manager2({ subject }: DraftProps) {
  const f = subjectFake(subject);
  return (
    <ol className="bg-card shadow-card flex flex-col rounded-2xl px-4 py-2">
      {f.classes.map((c) => {
        const start = minutes(c.time);
        const state = start + 60 <= NOW ? "끝남" : start <= NOW ? "진행 중" : "예정";
        const tone = state === "끝남" ? "inert" : state === "진행 중" ? "info" : "brand";
        return (
          <li key={c.name} className="border-line grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-t py-3 first:border-t-0">
            <span className={`num text-lg font-bold ${state === "진행 중" ? "text-blue" : ""}`}>{c.time}</span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{c.name}</p>
              <p className="truncate text-sm">
                {c.room} · {c.teacher} 선생님 · {c.students}명
                {state === "끝남" ? ` · 보고서 ${c.reportsDone}/${c.reportsDue}` : ""}
              </p>
            </div>
            <ToneBadge tone={tone}>{state}</ToneBadge>
          </li>
        );
      })}
    </ol>
  );
}
