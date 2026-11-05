"use client";

import { useState } from "react";
import type { ConsultationsSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { ConsultationTemplateEditor } from "./list-editors";

export function ConsultationsSection({ initial, readOnly = false }: { initial: ConsultationsSettings; readOnly?: boolean }) {
  const [c, setC] = useState<ConsultationsSettings>(initial);

  return (
    <SectionForm section="consultations" payload={c} readOnly={readOnly}>
      <SettingsCard
        title="상담 양식"
        description="원생상담 등록 화면에서 요약란에 자동으로 채워지는 양식(뼈대)입니다. 기본양식을 지정하면 새 상담이 그 양식으로 시작하고, 상담사가 다른 양식이나 무양식으로 바꿀 수 있습니다. 뼈대에 {{날짜}}·{{담당}} 같은 치환 태그를 넣으면 등록 시 실제 값으로 자동 입력됩니다."
      >
        <ConsultationTemplateEditor
          value={c.templates}
          onChange={(templates) => setC({ templates })}
        />
      </SettingsCard>
    </SectionForm>
  );
}
