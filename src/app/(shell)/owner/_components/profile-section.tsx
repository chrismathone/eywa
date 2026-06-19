"use client";

import { useState } from "react";
import type { ProfileSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField } from "./fields";

export function ProfileSection({ initial }: { initial: ProfileSettings }) {
  const [p, setP] = useState<ProfileSettings>(initial);
  const set = (patch: Partial<ProfileSettings>) => setP((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="profile" payload={p}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <SettingsCard title="학원 정보" description="청구서·알림·인쇄물에 쓰이는 학원 기본 정보입니다.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="학원 이름" value={p.name} onChange={(v) => set({ name: v })} placeholder="인재원수학" />
          <TextField
            label="지점 표기"
            hint="헤더 부제"
            value={p.branchLabel}
            onChange={(v) => set({ branchLabel: v })}
            placeholder="강남"
          />
          <TextField
            label="대표자명"
            value={p.representativeName}
            onChange={(v) => set({ representativeName: v })}
            placeholder="김수진"
          />
          <TextField label="대표 전화" value={p.phone} onChange={(v) => set({ phone: v })} placeholder="02-000-0000" />
          <TextField label="대표 이메일" value={p.email} onChange={(v) => set({ email: v })} />
          <TextField label="주소" value={p.address} onChange={(v) => set({ address: v })} />
          <TextField
            label="사업자등록번호"
            hint="인쇄물·청구 헤더"
            value={p.bizRegNo}
            onChange={(v) => set({ bizRegNo: v })}
            placeholder="000-00-00000"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="브랜드" description="사이드바 워드마크·강조 색상과 인쇄물 로고·직인.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="워드마크"
            hint="사이드바 로고 텍스트"
            value={p.logoText}
            onChange={(v) => set({ logoText: v })}
            placeholder="EYWA"
          />
          <TextField
            label="브랜드 색상"
            hint="hex"
            value={p.brandColor}
            onChange={(v) => set({ brandColor: v })}
            placeholder="#1a5f3c"
          />
          <TextField
            label="로고 이미지 URL"
            hint="인쇄물 머리글 · 파일 업로드는 추후"
            value={p.logoUrl}
            onChange={(v) => set({ logoUrl: v })}
            placeholder="https://…/logo.png"
          />
          <TextField
            label="직인 이미지 URL"
            hint="인쇄물 하단 직인"
            value={p.sealUrl}
            onChange={(v) => set({ sealUrl: v })}
            placeholder="https://…/seal.png"
          />
        </div>
      </SettingsCard>
      </div>
    </SectionForm>
  );
}
