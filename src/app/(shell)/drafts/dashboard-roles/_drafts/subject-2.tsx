/** 과목 관리자 시안 2 — 할 일 중심 "과목 할 일". 미작성 보고서·보강 미정·살펴볼 학생·입테 반 배정 대기. */
import { Panel, Row, ToneBadge } from "../_components/parts";
import { STUDENTS, subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

export function Subject2({ subject }: DraftProps) {
  const f = subjectFake(subject);
  const unwritten = f.classes.filter((c) => c.reportsDone < c.reportsDue);
  const noMakeup = f.absences.filter((a) => a.makeup === "보강 미정");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="미작성 보고서" count={`${unwritten.length}개 반`} note="마감 22:00">
        {unwritten.map((c) => (
          <Row
            key={c.name}
            name={`${c.name} · ${c.teacher} 선생님`}
            desc={`${c.time} 수업 · ${c.reportsDue}명 중 ${c.reportsDone}명 작성`}
            right={<ToneBadge tone="critical">{c.reportsDue - c.reportsDone}명 남음</ToneBadge>}
          />
        ))}
      </Panel>
      <Panel title="보강 미정" count={`${noMakeup.length}명`}>
        {noMakeup.map((a) => (
          <Row
            key={a.name}
            name={`${a.name} · ${a.school}`}
            desc={`${a.className} · 결석 ${a.streak}회`}
            right={<ToneBadge tone="caution">보강 잡기</ToneBadge>}
          />
        ))}
      </Panel>
      <Panel title="살펴볼 학생" count={`${f.watch.length}명`} note="사유는 분류만">
        {f.watch.map((w) => (
          <Row key={w.name} name={`${w.name} · ${w.school}`} desc={w.reason} right={<ToneBadge tone={w.tone}>{w.tone === "critical" ? "위험" : "주의"}</ToneBadge>} />
        ))}
      </Panel>
      <Panel title="입테 끝 · 반 배정 대기" count="2명">
        <Row name={`${STUDENTS[9]} · 나래중2`} desc="어제 입테 · 추천 반 화목 A반" right={<ToneBadge tone="caution">배정 대기</ToneBadge>} />
        <Row name={`${STUDENTS[11]} · 라온고1`} desc="오늘 15:30 입테 예정" right={<ToneBadge tone="info">입테 예정</ToneBadge>} />
      </Panel>
    </div>
  );
}
