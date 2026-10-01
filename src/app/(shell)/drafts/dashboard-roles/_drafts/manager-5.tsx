/** 실장(매니저) 시안 5 — 숫자 중심 "오늘 숫자 4칸". 오늘 단위만, 월·6개월 추이와 금액은 없다. */
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Panel, Row, ToneBadge } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

export function Manager5({ subject }: DraftProps) {
  const f = subjectFake(subject);
  const students = f.classes.reduce((a, c) => a + c.students, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat label="오늘 수업" value={f.classes.length} unit="개 반" tone="primary" icon={<EyIcon name="calendar" size={16} />} sub={`학생 ${students}명`} />
        <BigStat label="출석 확인" value={Math.round(students * 0.62)} unit="명" tone="green" icon={<EyIcon name="userCheck" size={16} />} sub="17:40 기준" />
        <BigStat label="어제 결석" value={f.absentToday} unit="명" tone="danger" icon={<EyIcon name="userX" size={16} />} sub="연락 필요 2" />
        <BigStat label="오늘 보강" value={2} unit="건" tone="purple" icon={<EyIcon name="calendarClock" size={16} />} sub="18:40 · 19:50" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="결석 연락 필요" count="2명">
          {f.absences.slice(0, 2).map((a) => (
            <Row key={a.name} name={`${a.name} · ${a.school}`} desc={a.className} right={<ToneBadge tone="critical">연락</ToneBadge>} />
          ))}
        </Panel>
        <Panel title="오늘 보강" count="2건">
          {f.absences.slice(2, 4).map((a, i) => (
            <Row key={a.name} name={`${i === 0 ? "18:40" : "19:50"} · ${a.name}`} desc={a.className} right={<ToneBadge tone="special">보강</ToneBadge>} />
          ))}
        </Panel>
      </div>
    </div>
  );
}
