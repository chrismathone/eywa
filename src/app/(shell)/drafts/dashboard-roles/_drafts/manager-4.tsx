/** 실장(매니저) 시안 4 — 학생 중심 "신입 돌보기". 내 과목 입테·첫 수업·90일 체크. 상담 녹음·전환율·수강료 없음. */
import { Panel, Row, ToneBadge } from "../_components/parts";
import { STUDENTS, seedOf } from "../_data/fake";
import type { DraftProps } from "./types";

const STEPS = ["첫 수업", "1주 통화", "교재 확인", "첫 테스트", "4주 상담", "90일 점검"];

export function Manager4({ subject }: DraftProps) {
  const s = seedOf(subject);
  const newcomers = STUDENTS.slice(0, 4).map((name, i) => ({ name, done: 1 + ((s + i * 2) % 5), days: 6 + i * 17 }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="이번 주 입테" count="3명">
        <Row name={`오늘 15:30 · ${STUDENTS[8]}`} desc="라온고1 · 담당 배정됨" right={<ToneBadge tone="info">오늘</ToneBadge>} />
        <Row name={`10월 2일 17:10 · ${STUDENTS[9]}`} desc="나래중3" right={<ToneBadge tone="info">예정</ToneBadge>} />
        <Row name={`10월 4일 11:00 · ${STUDENTS[10]}`} desc="가람중1" right={<ToneBadge tone="info">예정</ToneBadge>} />
      </Panel>
      <Panel title="첫 수업" count="2명">
        <Row name={`오늘 16:20 · ${STUDENTS[6]}`} desc="화목 A반 · 교재 준비 끝" right={<ToneBadge tone="positive">준비 끝</ToneBadge>} />
        <Row name={`10월 6일 15:00 · ${STUDENTS[7]}`} desc="월수 B반 · 교재 미확인" right={<ToneBadge tone="caution">교재 확인</ToneBadge>} />
      </Panel>
      <Panel title="90일 체크" count={`${newcomers.length}명`}>
        {newcomers.map((n) => (
          <div key={n.name} className="border-line flex flex-col gap-1.5 border-t py-2 first:border-t-0">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold">{n.name}</span>
              <span className="num text-xs">등록 {n.days}일째</span>
            </div>
            <div className="flex gap-1" role="img" aria-label={`${STEPS.length}단계 중 ${n.done}단계 끝`}>
              {STEPS.map((st, i) => (
                <span key={st} className={`h-2 flex-1 rounded-full ${i < n.done ? "bg-green" : "bg-bg-soft"}`} />
              ))}
            </div>
            <span className="text-xs">다음: {STEPS[n.done] ?? "끝"}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
