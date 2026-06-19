"use client";

import { useState } from "react";
import type { NotificationsSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { TextAreaField, TextField } from "./fields";

export function NotificationsSection({ initial }: { initial: NotificationsSettings }) {
  const [n, setN] = useState<NotificationsSettings>(initial);
  const set = (patch: Partial<NotificationsSettings>) => setN((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="notifications" payload={n}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <SettingsCard title="알림·연동" description="카카오 알림톡 발신 정보와 외부 연동 식별자.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="알림톡 발신프로필 키"
            value={n.alimtalkSenderKey}
            onChange={(v) => set({ alimtalkSenderKey: v })}
          />
          <TextField
            label="카카오 채널 ID"
            value={n.kakaoChannelId}
            onChange={(v) => set({ kakaoChannelId: v })}
            placeholder="@인재원"
          />
          <TextField
            label="Google Sheets ID"
            hint="시간표 동기화 대상"
            value={n.googleSheetId}
            onChange={(v) => set({ googleSheetId: v })}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="문서·약관" description="인쇄물 머리글과 개인정보·이용 약관 본문.">
        <div className="space-y-4">
          <TextField
            label="인쇄물 머리글"
            hint="청구서·성적표 상단"
            value={n.printHeader}
            onChange={(v) => set({ printHeader: v })}
          />
          <TextAreaField
            label="개인정보 처리방침"
            value={n.privacyTerms}
            onChange={(v) => set({ privacyTerms: v })}
            rows={5}
          />
          <TextAreaField
            label="이용 약관"
            value={n.serviceTerms}
            onChange={(v) => set({ serviceTerms: v })}
            rows={5}
          />
        </div>
      </SettingsCard>
      </div>
    </SectionForm>
  );
}
