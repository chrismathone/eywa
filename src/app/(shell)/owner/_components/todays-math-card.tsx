"use client";

import { useState } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { ToggleField } from "./fields";

/**
 * 학원 설정 → 연동 → 오늘 수학(2026-10-17). 지점에 오늘 수학이 켜져 있을 때만 이 탭이 선다(integrations-face.tsx).
 * 개발 중 기능은 여기서 켠 학원만 동작한다(원장 *"원장 설정에서 오늘의 수학 탭에서 토글 온 되어있어야 연동되게"*).
 * 값은 보고서 섹션(`report.todaysMathTestFill`)에 산다 — 저장은 다른 설정과 같은 길(saveOwnerSection)로 섹션째.
 */
export function TodaysMathCard({ report }: { report: ReportSettings }) {
  const [fill, setFill] = useState(report.todaysMathTestFill);
  return (
    <SectionForm section="report" payload={{ ...report, todaysMathTestFill: fill }}>
      <SettingsCard
        title="시험 결과 채우기"
        description="오늘 수학에서 채점한 일일테스트·확인테스트 결과를 원스크린 수학 행의 빈 시험 칸에 채웁니다. 선생님이 입력한 값은 바꾸지 않고, 결시는 채우지 않습니다. 개발 중인 기능입니다."
      >
        <ToggleField
          label="원스크린 시험 칸 채우기"
          hint="끄면 채우지 않습니다"
          value={fill}
          onChange={setFill}
        />
      </SettingsCard>
    </SectionForm>
  );
}
