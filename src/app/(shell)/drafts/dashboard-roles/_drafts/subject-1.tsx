/** 과목 관리자 시안 1 — 숫자 중심 "과목 숫자판". 내 과목 6칸 + 반별 출석률 + 신규·퇴원 건수 추이. 금액 없음. */
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Columns, HBars, Panel } from "../_components/parts";
import { ACADEMY, seedOf, subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

export function Subject1({ subject }: DraftProps) {
  const f = subjectFake(subject);
  const s = seedOf(subject);
  const joins = ACADEMY.months.map((_, i) => 3 + ((s + i * 3) % 7));
  const leaves = ACADEMY.months.map((_, i) => 1 + ((s + i * 5) % 4));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <BigStat label="재원" value={f.enrolled} unit="명" icon={<EyIcon name="users" size={16} />} tone="primary" sub="내 과목" />
        <BigStat label="이번 달 신규" value={f.joined} unit="명" tone="green" icon={<EyIcon name="userPlus" size={16} />} sub="1일~오늘" />
        <BigStat label="이번 달 퇴원" value={f.left} unit="명" tone="neutral" icon={<EyIcon name="userMinus" size={16} />} sub="수만 — 사유는 원장" />
        <BigStat label="어제 결석" value={f.absentToday} unit="명" tone="danger" icon={<EyIcon name="userX" size={16} />} sub="사전 통보 제외" />
        <BigStat label="보강 예정" value={f.makeups} unit="건" tone="purple" icon={<EyIcon name="calendarClock" size={16} />} sub="오늘부터 한 달" />
        <BigStat label="보고서 작성률" value={f.reportRate} unit="%" tone="amber" icon={<EyIcon name="report" size={16} />} sub="이번 주" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="반별 출석률" note="이번 주">
          <HBars
            items={f.classes.map((c) => ({ label: c.name, value: c.attendRate }))}
            barClass="bg-green"
            format={(v) => `${v}%`}
          />
        </Panel>
        <Panel title="신규 · 퇴원 6개월" note="건수만 · 내 과목">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-bold">신규</p>
              <Columns labels={ACADEMY.months} values={joins} barClass="bg-green" height="h-20" />
            </div>
            <div>
              <p className="mb-2 text-xs font-bold">퇴원</p>
              <Columns labels={ACADEMY.months} values={leaves} barClass="bg-neutral-fill" height="h-20" />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
