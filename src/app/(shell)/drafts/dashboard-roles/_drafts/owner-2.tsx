/** 원장 시안 2 — 할 일 중심 "원장 결재함". 결재 대기·이탈 위험·고액 미수·미작성 강사·상담 후속. */
import { Panel, Row, ToneBadge } from "../_components/parts";
import { DESK, STAFF, STUDENTS, won } from "../_data/fake";

const APPROVALS = [
  { kind: "지출결의", what: "교재 인쇄비 · 384,000원", who: STAFF[1], when: "어제 18:20" },
  { kind: "연차", what: "10월 7일~8일(2일)", who: STAFF[2], when: "오늘 09:10" },
  { kind: "환불 요청", what: `${STUDENTS[2]} · 수강료 일부 210,000원`, who: STAFF[4], when: "오늘 11:45" },
];

const RISK = [
  { name: STUDENTS[3], school: "라온고1", reason: "결석 3회 연속 · 상담에서 '진도가 안 맞다'", fee: "월 수강료 38만" },
  { name: STUDENTS[7], school: "나래중3", reason: "테스트 20점 하락 · 보강 두 번 미이행", fee: "월 수강료 32만" },
  { name: STUDENTS[10], school: "가람중2", reason: "학부모 문의 '다른 학원 알아보는 중'", fee: "월 수강료 29만" },
];

export function Owner2() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Panel title="내 결재 대기" count={`${APPROVALS.length}건`}>
          {APPROVALS.map((a) => (
            <Row
              key={a.kind}
              name={`${a.kind} · ${a.what}`}
              desc={`${a.who} 선생님 올림 · ${a.when}`}
              right={<ToneBadge tone="caution">내 차례</ToneBadge>}
            />
          ))}
        </Panel>
        <Panel title="이탈 위험 학생" count={`${RISK.length}명`} note="상담 기록·금액 포함 — 원장 전용">
          {RISK.map((r) => (
            <Row
              key={r.name}
              name={`${r.name} · ${r.school}`}
              desc={r.reason}
              right={
                <>
                  <span className="num text-xs font-bold">{r.fee}</span>
                  <ToneBadge tone="critical">이탈 위험</ToneBadge>
                </>
              }
            />
          ))}
        </Panel>
      </div>
      <div className="flex flex-col gap-4">
        <Panel title="고액 미수" count="상위 4">
          {[...DESK.unpaid]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 4)
            .map((u) => (
              <Row
                key={u.name}
                name={u.name}
                desc={`${u.item} · ${u.days}일 지남`}
                right={<span className="num text-danger text-sm font-bold">{won(u.amount)}</span>}
              />
            ))}
        </Panel>
        <Panel title="보고서 미작성 강사" count="오늘">
          {STAFF.slice(0, 3).map((t, i) => (
            <Row key={t} name={`${t} 선생님`} desc={`미작성 ${3 - i}명 · 마감 22:00`} right={<ToneBadge tone="critical">미작성</ToneBadge>} />
          ))}
        </Panel>
        <Panel title="상담 후속조치" count="2건">
          <Row name={STUDENTS[5]} desc="레벨 조정 결과 학부모에게 회신" right={<ToneBadge tone="critical">기한 지남</ToneBadge>} />
          <Row name={STUDENTS[8]} desc="반 이동 희망 — 담당과 협의" right={<ToneBadge tone="caution">오늘</ToneBadge>} />
        </Panel>
      </div>
    </div>
  );
}
