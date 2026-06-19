"use client";

import { useState } from "react";
import type { NotificationsSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField } from "./fields";

export function NotificationsSection({ initial }: { initial: NotificationsSettings }) {
  const [n, setN] = useState<NotificationsSettings>(initial);
  const set = (patch: Partial<NotificationsSettings>) => setN((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="notifications" payload={n}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      {/* 폴백 소스: 전용 설정(키오스크 설정·연동 설정)이 비어 있으면 아래 값이 쓰인다(provider.ts·integrations).
          ⚠️ kakaoChannelId(@채널)는 발송 경로(pfId+템플릿)에서 안 쓰여 대응 DB 컬럼이 없으므로 입력 숨김(상태·저장은 보존). */}
      <SettingsCard
        title="알림·연동"
        description="비우면 키오스크 설정·전용 연동의 값을 사용합니다. 입력하면 전용 설정이 비어 있을 때 폴백으로 쓰입니다."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="알림톡 발신프로필 키"
            hint="비우면 키오스크 설정의 발신키 사용"
            value={n.alimtalkSenderKey}
            onChange={(v) => set({ alimtalkSenderKey: v })}
          />
          <TextField
            label="Google Sheets ID"
            hint="비우면 전용 연동 사용 · 시간표 동기화 대상"
            value={n.googleSheetId}
            onChange={(v) => set({ googleSheetId: v })}
          />
        </div>
      </SettingsCard>

      {/* ⚠️ privacyTerms·serviceTerms는 약관 표시 페이지(등록/가입/푸터)가 없어 v1에서 입력 숨김
          (상태·스키마·저장은 보존). 약관 표시 페이지 구현 시 TextAreaField 입력 복원. */}
      <SettingsCard title="인쇄물" description="청구서·성적표 등 인쇄물 상단 머리글.">
        <TextField
          label="인쇄물 머리글"
          hint="청구서·성적표 상단"
          value={n.printHeader}
          onChange={(v) => set({ printHeader: v })}
        />
      </SettingsCard>
      </div>
    </SectionForm>
  );
}
