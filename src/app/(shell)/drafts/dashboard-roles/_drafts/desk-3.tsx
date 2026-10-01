/** 경영지원·데스크 시안 3 — 시간 중심 "접수 타임라인". 오늘 방문 상담·입테·등록을 시간순으로, 일정 원문의 전화번호는 가린다. */
import { Panel, ToneBadge } from "../_components/parts";
import { DESK } from "../_data/fake";

const KIND_TONE = { 상담: "info", 입테: "brand", 등록: "positive" } as const;

export function Desk3() {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Panel title="오늘 접수 일정" count={`${DESK.timeline.length}건`} note="지금 15:10">
        <ol className="relative flex flex-col gap-3 pl-6 before:absolute before:top-2 before:bottom-2 before:left-2 before:w-px before:bg-line-strong">
          {DESK.timeline.map((t, i) => (
            <li key={t.time} className="relative">
              <span className={`absolute top-1.5 -left-6 size-4 rounded-full border-2 ${i < 2 ? "bg-line-strong border-line-strong" : "bg-card border-primary"}`} />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="num text-base font-bold">{t.time}</span>
                <span className="text-base font-bold">{t.who}</span>
                <ToneBadge tone={KIND_TONE[t.kind as keyof typeof KIND_TONE]}>{t.kind}</ToneBadge>
              </div>
              <p className="text-sm">
                {t.note}
                {i === 1 ? " · 일정 원문: '입테 010-••••-••••' (번호 가림)" : ""}
              </p>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="다음 손님" note="16:00">
        <p className="text-xl font-bold">{DESK.timeline[2]?.who}</p>
        <p className="text-sm">{DESK.timeline[2]?.note}</p>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          <li>· 등록 동의서 준비</li>
          <li>· 반 배정 확인(과목 담당에게)</li>
          <li>· 교재 안내문 출력</li>
        </ul>
      </Panel>
    </div>
  );
}
