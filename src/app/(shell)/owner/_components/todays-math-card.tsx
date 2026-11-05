"use client";

import { useState } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { ToggleField } from "./fields";
import type { MenuKey } from "@/lib/permissions";

/**
 * 학원 설정 → 연동 → 오늘 수학(2026-10-17). 지점에 오늘 수학이 켜져 있을 때만 이 탭이 선다(integrations-face.tsx).
 * 개발 중 기능은 여기서 켠 학원만 동작한다(원장 *"원장 설정에서 오늘의 수학 탭에서 토글 온 되어있어야 연동되게"* ·
 * *"같은 탭에 토글로 진행해"*). 값은 보고서 섹션(`report.todaysMath*`)에 산다 — 저장은 다른 설정과 같은 길(saveOwnerSection)로 섹션째.
 */
export function TodaysMathCard({ report, readOnly = false, lockMenu, lockNote = true }: {
  report: ReportSettings;
  /** 보고서 설정 쓰기(저장 액션 = saveOwnerSection(report) → report_settings)가 없거나 연동 면이 잠겼으면 true — 저장 바를 그리지 않는다. */
  readOnly?: boolean;
  /** 읽기 전용 안내에 적을 권한 키(막은 쪽) — integrations-face.tsx가 정한다. */
  lockMenu?: MenuKey;
  /** 폼 위 권한 안내를 적을지 — 연동 면 전체가 잠겼으면(면 위가 이미 적음) false(SectionForm.lockNote). */
  lockNote?: boolean;
}) {
  const [fill, setFill] = useState(report.todaysMathTestFill);
  const [monthly, setMonthly] = useState(report.todaysMathMonthlyFill);
  const [pdf, setPdf] = useState(report.todaysMathReportPdf);
  return (
    <SectionForm section="report" payload={{ ...report, todaysMathTestFill: fill, todaysMathMonthlyFill: monthly, todaysMathReportPdf: pdf }} readOnly={readOnly} lockMenu={lockMenu} lockNote={lockNote}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <SettingsCard
          title="원스크린 시험 칸 채우기"
          description="오늘 수학에서 채점한 일일테스트·확인테스트 결과를 원스크린 수학 행의 빈 시험 칸에 채웁니다. 선생님이 입력한 값은 바꾸지 않고, 결시는 채우지 않습니다. 개발 중인 기능입니다."
        >
          <ToggleField label="원스크린 시험 칸 채우기" hint="끄면 채우지 않습니다" value={fill} onChange={setFill} />
        </SettingsCard>
        <SettingsCard
          title="성적관리 월말평가 채우기"
          description="성적관리에서 수학 월말평가를 열면 '오늘 수학 결과 채우기' 단추가 생깁니다. 누르면 같은 달 오늘 수학 월말평가 점수를 빈 칸에만 넣고, 저장은 평소처럼 직접 누릅니다. 만점이 다른 시험은 채우지 않습니다. 개발 중인 기능입니다."
        >
          <ToggleField label="성적관리 월말평가 채우기" hint="끄면 단추가 없습니다" value={monthly} onChange={setMonthly} />
        </SettingsCard>
        <SettingsCard
          title="월말평가 성적표 보고서 첨부"
          description="오늘 수학에서 확정한 월말평가 성적표(PDF)를 그 학생의 시험일 수학 보고서에 첨부합니다. 아직 보내지 않은 보고서에만 붙습니다. 이미 보낸 보고서는 성적표 없이 나간 것으로 두고, 그날 보고서가 없으면 선생님에게 알립니다. 선생님이 보고서를 보낼 때 그 학생의 성적표를 바로 확인해 함께 붙이고, 한 시간마다 한 번 더 확인합니다. 개발 중인 기능입니다."
        >
          <ToggleField label="월말평가 성적표 보고서 첨부" hint="끄면 붙이지 않습니다" value={pdf} onChange={setPdf} />
        </SettingsCard>
        <SettingsCard
          title="오늘 수학 결과 가져오기"
          description="위 세 기능 중 하나라도 켜져 있을 때만 오늘 수학 채점 결과를 한 시간마다 가져옵니다. 모두 끄면 가져오지 않습니다."
        >
          <p className="text-sm text-text-dim">{fill || monthly || pdf ? "켜진 기능이 있어 가져옵니다." : "모두 꺼져 있어 가져오지 않습니다."}</p>
        </SettingsCard>
      </div>
    </SectionForm>
  );
}
