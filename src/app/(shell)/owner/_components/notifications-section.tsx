"use client";

import { useState } from "react";
import type { NotificationsSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { TextAreaField, TextField } from "./fields";
import { useModuleOn } from "@/features/owner/operations-context";

export function NotificationsSection({ initial, readOnly = false }: { initial: NotificationsSettings; readOnly?: boolean }) {
  const [n, setN] = useState<NotificationsSettings>(initial);
  const set = (patch: Partial<NotificationsSettings>) => setN((prev) => ({ ...prev, ...patch }));
  // 알림톡 발신키는 키오스크(등하원 알림) 기능의 폴백이다 — 키오스크가 꺼진 학원엔 카드가 없다(2026-09-30). 값은 state에 남는다.
  const kioskOn = useModuleOn("kiosk");

  return (
    <SectionForm section="notifications" payload={n} readOnly={readOnly}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      {/* 폴백 소스: 전용 설정(키오스크 설정)이 비어 있으면 아래 값이 쓰인다(provider.ts).
          ⚠️ kakaoChannelId(@채널)는 발송 경로(pfId+템플릿)에서 안 쓰여 대응 DB 컬럼이 없으므로 입력 숨김(상태·저장은 보존).
          ⚠️ 구글 시트 ID는 연동 탭(?tab=sheets)으로 이전 — 여기서 편집하지 않음(연동 설정 단일 홈). */}
      {kioskOn ? (
      <SettingsCard
        title="알림"
        description="비우면 키오스크 설정의 값을 사용합니다. 입력하면 키오스크 설정이 비어 있을 때 폴백으로 쓰입니다."
      >
        <TextField
          label="알림톡 발신프로필 키"
          hint="비우면 키오스크 설정의 발신키 사용"
          value={n.alimtalkSenderKey}
          onChange={(v) => set({ alimtalkSenderKey: v })}
        />
      </SettingsCard>
      ) : null}

      <SettingsCard title="인쇄물" description="등록 상담지·상담 준비 서류 상단에 찍히는 머리글.">
        <TextField
          label="인쇄물 머리글"
          hint="등록 상담지·상담 준비 서류 상단"
          value={n.printHeader}
          onChange={(v) => set({ printHeader: v })}
        />
      </SettingsCard>

      {/* 공개 접수(학부모 QR) 폼의 동의서 문구 — 비우면 해당 동의 블록이 폼에서 숨겨집니다. */}
      <SettingsCard
        title="공개 접수 약관"
        description="학부모 QR 접수 폼에 표시되는 동의 문구. 개인정보 동의는 필수 체크, 환불·학칙 안내는 선택 체크로 노출됩니다."
        span2
      >
        <div className="space-y-4">
          <TextAreaField
            label="개인정보 수집·이용 동의 문구"
            hint="비우면 개인정보 동의 블록 숨김"
            rows={6}
            value={n.privacyTerms}
            onChange={(v) => set({ privacyTerms: v })}
          />
          <TextAreaField
            label="환불·학칙 안내 문구"
            hint="비우면 환불·학칙 동의 블록 숨김"
            rows={8}
            value={n.serviceTerms}
            onChange={(v) => set({ serviceTerms: v })}
          />
        </div>
      </SettingsCard>
      </div>
    </SectionForm>
  );
}
