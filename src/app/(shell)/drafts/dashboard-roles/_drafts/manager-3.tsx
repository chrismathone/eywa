/** 실장(매니저) 시안 3 — 보드 중심 "결석 · 보강 보드". 어제 결석 → 보강 예약 두 칸. 사유 원문·연락처 없음. */
import { EyIcon } from "@/components/icons/aywa-icons";
import { Panel, Row, ToneBadge } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

export function Manager3({ subject }: DraftProps) {
  const f = subjectFake(subject);
  const waiting = f.absences.filter((a) => a.makeup === "보강 미정");
  const booked = f.absences.filter((a) => a.makeup === "보강 예약됨");
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_auto_1fr]">
      <Panel title="어제 결석 · 보강 미정" count={`${waiting.length}명`}>
        {waiting.map((a) => (
          <Row
            key={a.name}
            name={`${a.name} · ${a.school}`}
            desc={`${a.className} · 결석 ${a.streak}회`}
            right={<ToneBadge tone="critical">보강 잡기</ToneBadge>}
          />
        ))}
      </Panel>
      <div className="hidden self-center lg:block" aria-hidden>
        <EyIcon name="arrowRight" size={24} />
      </div>
      <Panel title="보강 예약됨" count={`${booked.length + 2}건`}>
        {booked.map((a, i) => (
          <Row
            key={a.name}
            name={`${a.name} · ${a.school}`}
            desc={`${i === 0 ? "10월 2일(목) 18:40" : "10월 4일(토) 11:00"} · ${a.className}`}
            right={<ToneBadge tone="special">보강</ToneBadge>}
          />
        ))}
        <Row name="지난 보강 2건" desc="출결 미입력 — 보강일 지남" right={<ToneBadge tone="caution">입력 필요</ToneBadge>} />
      </Panel>
    </div>
  );
}
