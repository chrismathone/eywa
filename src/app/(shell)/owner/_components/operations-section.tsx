"use client";

import { useState } from "react";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import {
  HolidayListEditor,
  PeriodListEditor,
  StringListEditor,
  SubjectListEditor,
} from "./list-editors";

export function OperationsSection({ initial }: { initial: OperationsSettings }) {
  const [o, setO] = useState<OperationsSettings>(initial);
  const set = (patch: Partial<OperationsSettings>) => setO((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="operations" payload={o}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <SettingsCard
        title="운영 과목"
        description="목록·시간표·청구의 과목 드롭다운과 라벨 색상에 쓰입니다. key는 내부 식별자(영문 소문자), 라벨은 화면 표시명."
      >
        <SubjectListEditor value={o.subjects} onChange={(v) => set({ subjects: v })} />
      </SettingsCard>

      <SettingsCard title="직급" description="직원 등록·수정의 직급 선택지.">
        <StringListEditor
          value={o.jobTitles}
          onChange={(v) => set({ jobTitles: v })}
          placeholder="강사"
          addLabel="직급 추가"
        />
      </SettingsCard>

      <SettingsCard title="학년 체계" description="학생 학년 선택지.">
        <StringListEditor
          value={o.gradeLevels}
          onChange={(v) => set({ gradeLevels: v })}
          placeholder="중1"
          addLabel="학년 추가"
        />
      </SettingsCard>

      <SettingsCard
        title="평일 교시"
        description="1교시가 언제부터 언제까지인지 등 평일 수업 시간대. 시간표 교시 축에 적용됩니다."
      >
        <PeriodListEditor value={o.weekdayPeriods} onChange={(v) => set({ weekdayPeriods: v })} />
      </SettingsCard>

      <SettingsCard title="주말 교시" description="토·일 수업 시간대.">
        <PeriodListEditor value={o.weekendPeriods} onChange={(v) => set({ weekendPeriods: v })} />
      </SettingsCard>

      {/* ⚠️ 학기(terms)는 소비처가 없어 v1에서 입력 숨김(상태·스키마·저장은 보존).
          성적/상담 학기 셀렉트 등 소비처가 생기면 SettingsCard만 복원. */}

      <SettingsCard title="공휴일·휴원일" description="수강료 계산 시 수업일에서 제외됩니다. 공휴일명을 함께 적으면 견적·공휴일 면에 표시됩니다.">
        <HolidayListEditor value={o.holidays} onChange={(v) => set({ holidays: v })} />
      </SettingsCard>
      </div>
    </SectionForm>
  );
}
