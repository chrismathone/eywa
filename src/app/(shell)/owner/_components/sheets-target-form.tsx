"use client";

import { useState } from "react";
import type { NotificationsSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField } from "./fields";

/**
 * 연동 면 — 시간표를 내보낼 대상 구글 시트 ID 편집.
 * 값은 `notifications` 섹션(tenant_settings)에 저장되므로 다른 알림 필드를 보존하기 위해
 * notifications 전체 객체를 state로 들고 googleSheetId만 노출한다(섹션 내부는 머지가 아니라 교체).
 */
export function SheetsTargetForm({ initial }: { initial: NotificationsSettings }) {
  const [n, setN] = useState<NotificationsSettings>(initial);

  return (
    <SectionForm section="notifications" payload={n}>
      <SettingsCard
        title="대상 스프레드시트"
        description="시간표를 내보낼 구글 시트 ID. 비우면 전용 연동(관리자 설정)을 사용합니다."
      >
        <TextField
          label="Google Sheets ID"
          hint="시트 URL의 /d/ 뒤 문자열 · 비우면 전용 연동 사용"
          value={n.googleSheetId}
          onChange={(v) => setN((prev) => ({ ...prev, googleSheetId: v }))}
        />
      </SettingsCard>
    </SectionForm>
  );
}
