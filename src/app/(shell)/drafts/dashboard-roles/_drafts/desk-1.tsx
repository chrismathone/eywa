/** 경영지원·데스크 시안 1 — 할 일 중심 "연락할 곳". 결석·미납 안내·상담 콜백·보강 확인. 합계·사유 원문 없음. */
import { EyIcon } from "@/components/icons/aywa-icons";
import { Panel, Row, ToneBadge } from "../_components/parts";
import { DESK, STUDENTS } from "../_data/fake";

const WHY_LABEL = { critical: "결석", caution: "미납 안내", info: "콜백", special: "보강" } as const;

export function Desk1() {
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Panel title="오늘 연락할 곳" count={`${DESK.calls.length}건`} note="연락처는 누르면 보인다">
        {DESK.calls.map((c) => (
          <Row
            key={c.who}
            name={c.who}
            desc={c.why}
            right={
              <>
                <ToneBadge tone={c.tone}>{WHY_LABEL[c.tone]}</ToneBadge>
                <span className="border-line inline-flex h-(--control-h) items-center gap-1 rounded-lg border px-2.5 text-sm font-medium">
                  <EyIcon name="send" size={16} />
                  문자
                </span>
              </>
            }
          />
        ))}
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel title="받을 서류" count="2건">
          <Row name={STUDENTS[3]} desc="등록 동의서 · 오늘 등록" right={<ToneBadge tone="caution">미제출</ToneBadge>} />
          <Row name={STUDENTS[11]} desc="교재비 영수증 재발행 요청" right={<ToneBadge tone="info">처리 중</ToneBadge>} />
        </Panel>
        <Panel title="어제 남긴 메모" count="1건">
          <Row name="교재 입고" desc="화목 A반 교재 10권 — 내일 오전 도착" right={<ToneBadge tone="info">확인</ToneBadge>} />
        </Panel>
      </div>
    </div>
  );
}
