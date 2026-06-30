"use client";

import { useState } from "react";
import type { OperationsSettings } from "@/features/owner/settings-types";
import type { ClassroomRow } from "@/features/owner/server/classroom-queries";
import { SectionForm, SettingsCard } from "./section-form";
import { ClassroomManager } from "./classroom-manager";
import {
  HolidayListEditor,
  PeriodListEditor,
  ShuttleEditor,
  StringListEditor,
  SubjectListEditor,
} from "./list-editors";

export function OperationsSection({
  initial,
  classrooms,
}: {
  initial: OperationsSettings;
  classrooms: ClassroomRow[];
}) {
  const [o, setO] = useState<OperationsSettings>(initial);
  const set = (patch: Partial<OperationsSettings>) => setO((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-4">
    <SectionForm section="operations" payload={o}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <SettingsCard
        title="운영 과목"
        description="과목명과 색만 정하면 됩니다. 색은 전 화면의 과목 배지·시간표·엑셀에 적용됩니다. 내부 ID는 데이터 보존용으로 자동 생성·고정(편집 불가)."
      >
        <SubjectListEditor value={o.subjects} onChange={(v) => set({ subjects: v })} />
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

      <SettingsCard title="직급" description="직원 등록·수정의 직급 선택지.">
        <StringListEditor
          value={o.jobTitles}
          onChange={(v) => set({ jobTitles: v })}
          placeholder="강사"
          addLabel="직급 추가"
        />
      </SettingsCard>

      {/* ⚠️ 학기(terms)는 소비처가 없어 v1에서 입력 숨김(상태·스키마·저장은 보존).
          성적/상담 학기 셀렉트 등 소비처가 생기면 SettingsCard만 복원. */}

      <SettingsCard title="공휴일·휴원일" description="수강료 계산 시 수업일에서 제외됩니다. 공휴일명을 함께 적으면 견적·공휴일 면에 표시됩니다.">
        <HolidayListEditor value={o.holidays} onChange={(v) => set({ holidays: v })} />
      </SettingsCard>

      <SettingsCard title="셔틀버스" description="공개 접수(학부모 QR) 폼에 표시되는 셔틀 신청·요금·노선. 표시를 끄면 폼에서 숨겨집니다." span2>
        <ShuttleEditor value={o.shuttle} onChange={(v) => set({ shuttle: v })} />
      </SettingsCard>
      </div>
    </SectionForm>

      {/* 강의실 = 관계형 테이블(classrooms) — jsonb 설정과 달리 자체 CRUD로 즉시 저장(SectionForm 밖). */}
      <ClassroomManager rooms={classrooms} />
    </div>
  );
}
