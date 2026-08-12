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
      {/* 폴백 소스: 전용 설정(키오스크 설정)이 비어 있으면 아래 값이 쓰인다(provider.ts).
          ⚠️ kakaoChannelId(@채널)는 발송 경로(pfId+템플릿)에서 안 쓰여 대응 DB 컬럼이 없으므로 입력 숨김(상태·저장은 보존).
          ⚠️ 구글 시트 ID는 연동 탭(?tab=sheets)으로 이전 — 여기서 편집하지 않음(연동 설정 단일 홈). */}
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

      <SettingsCard title="인쇄물" description="청구서·성적표 등 인쇄물 상단 머리글.">
        <TextField
          label="인쇄물 머리글"
          hint="청구서·성적표 상단"
          value={n.printHeader}
          onChange={(v) => set({ printHeader: v })}
        />
      </SettingsCard>

      {/* 공개 접수(학부모 QR) 폼의 동의서 문구 — 비우면 해당 동의 블록이 폼에서 숨겨집니다. */}
      <SettingsCard
        title="동의서 문구"
        description="QR 접수 폼과 등록상담 화면에 표시되는 동의 문구. 개인정보·국외이전·민감정보는 법이 각각 별도 동의를 요구해 세 블록으로 나뉘어 있습니다 — 하나로 합치지 마세요."
        span2
      >
        <div className="space-y-4">
          <TextAreaField
            label="① 개인정보 수집·이용 동의 문구"
            hint="필수 체크. 수집 항목·이용 목적·보유 기간·거부권 4가지는 법정 고지사항이라 빼면 안 됩니다"
            rows={8}
            value={n.privacyTerms}
            onChange={(v) => set({ privacyTerms: v })}
          />
          <TextAreaField
            label="② 개인정보 국외 이전 동의 문구"
            hint="녹음을 쓰려면 필수. 받는 자·국가·시점·방법·항목·목적·기간·거부권 8가지를 모두 적어야 합니다. 비우면 국외이전 동의 블록이 숨겨지고, 녹음 첨부도 막힙니다"
            rows={10}
            value={n.overseasTransferTerms}
            onChange={(v) => set({ overseasTransferTerms: v })}
          />
          <TextAreaField
            label="③ 민감정보 수집·이용 동의 문구"
            hint="선택 체크. 학습 태도·정서 상태 등이 상담에 등장하면 필요합니다. 비우면 해당 블록 숨김"
            rows={8}
            value={n.sensitiveInfoTerms}
            onChange={(v) => set({ sensitiveInfoTerms: v })}
          />
          <TextAreaField
            label="④ 환불·학칙 안내 문구"
            hint="선택 체크. 비우면 환불·학칙 동의 블록 숨김"
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
