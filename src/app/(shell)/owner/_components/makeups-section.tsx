"use client";

import { useState } from "react";
import type { MakeupSettings } from "@/features/makeups/config";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SectionForm, SettingsCard } from "./section-form";
import { Input } from "@/components/ui/input";

export function MakeupsSection({ initial, readOnly = false }: { initial: MakeupSettings; readOnly?: boolean }) {
  const [mode, setMode] = useState(initial.mode);
  const subjects = useSubjectMaps();
  const payload: MakeupSettings = { ...initial, mode, allowAdditional: false };
  return (
    <SectionForm section="makeups" payload={payload} readOnly={readOnly}>
      <SettingsCard title="보강관리 운영" description="접수·일정·실시 검토를 별도 장부에서 관리합니다." span2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="block font-medium">운영 모드</span>
            <select className="border-line min-h-10 w-full rounded-md border bg-white px-3" value={mode}
              onChange={e => setMode(e.target.value as MakeupSettings["mode"])}>
              <option value="off">꺼짐</option>
              <option value="on">접수·운영</option>
              <option value="draining">새 접수 중지 · 기존 업무 처리</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="block font-medium">파일럿 과목</span>
            <Input value={initial.pilotSubjects.map(key => subjects.labelOf(key)).join(", ")} readOnly />
          </label>
        </div>
        <p className="mt-3 text-sm">끄기 전에는 열린 보강 건·미처리 대사·기록 반영을 모두 처리해야 합니다.</p>
        <p className="mt-2 text-sm">추가 지도는 출결·수납 기준 확정 후 지원합니다. 예약만으로 완료되거나 시수가 추가되지 않습니다.</p>
      </SettingsCard>
    </SectionForm>
  );
}
