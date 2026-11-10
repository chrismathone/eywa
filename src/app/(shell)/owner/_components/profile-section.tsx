"use client";

import { useState } from "react";
import type { ProfileSettings } from "@/features/owner/settings-types";
import { issueBrandingUploadTicket } from "@/features/owner/server/actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { isBrandColorApplied, DEFAULT_BRAND_COLOR, BRAND_COLOR_OVERRIDDEN_BY_THEME } from "@/lib/color-utils";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField, ColorField } from "./fields";
import { useLockedPlaceholder, useWriteLock } from "./write-lock-context";

export function ProfileSection({ initial, readOnly = false }: { initial: ProfileSettings; readOnly?: boolean }) {
  const [p, setP] = useState<ProfileSettings>(initial);
  const set = (patch: Partial<ProfileSettings>) => setP((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="profile" payload={p} readOnly={readOnly}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
      <SettingsCard title="학원 정보" description="청구서·알림·인쇄물에 쓰이는 학원 기본 정보입니다.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="학원 이름" value={p.name} onChange={(v) => set({ name: v })} placeholder="예: 한빛학원" />
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
            placeholder="예: 홍길동"
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
          <TextField
            label="법인명"
            hint="급여명세서 머리글 · 비우면 학원명"
            value={p.legalName}
            onChange={(v) => set({ legalName: v })}
            placeholder="예: (주) 한빛에듀"
          />
          <TextField
            label="급여명세서 담당자"
            hint="명세서 서명란 '담당' 칸 · 여러 명이면 쉼표"
            value={p.payslipSigners}
            onChange={(v) => set({ payslipSigners: v })}
            placeholder="예: 홍길동, 김철수"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="브랜드" description={BRAND_COLOR_OVERRIDDEN_BY_THEME ? "사이드바 워드마크와 인쇄물 로고·직인." : "사이드바 워드마크·강조 색상과 인쇄물 로고·직인."}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="워드마크"
            hint="사이드바 로고 텍스트"
            value={p.logoText}
            onChange={(v) => set({ logoText: v })}
            placeholder="에이와"
          />
          {/* 앱 색 테마가 브랜드색을 덮는 동안은 숨긴다(저장값은 그대로 · color-utils `BRAND_COLOR_OVERRIDDEN_BY_THEME`). */}
          {BRAND_COLOR_OVERRIDDEN_BY_THEME ? null : (
            <ColorField
              label="브랜드 색상"
              hint="강조색 · hex"
              value={p.brandColor}
              onChange={(v) => set({ brandColor: v })}
              placeholder={DEFAULT_BRAND_COLOR}
              // 주입이 생략되는 값이면 그 사실을 알린다. 단 **왜** 생략되는지에 따라 문구가 갈린다:
              // 저장값이 기본색과 같으면 "어긋남"이 아니라 정상 상태이므로 "적용 안 됨" 경고를 띄우면
              // 사용자가 같은 네이비 스와치를 보면서 문제로 오해한다(2026-07-20 그린→네이비 정리 후 발견).
              // 어긋남(옛 기본색·형식오류·빈값)일 때만 설명형 안내.
              note={
                isBrandColorApplied(p.brandColor)
                  ? undefined
                  : p.brandColor?.trim().toLowerCase() === DEFAULT_BRAND_COLOR
                    ? "기본 팔레트와 같은 색입니다 — 그대로 표시됩니다."
                    : `현재 기본 팔레트(${DEFAULT_BRAND_COLOR})로 표시됩니다 — 위 값은 기본색으로 간주되어 화면에 적용되지 않습니다. 다른 색을 넣으면 그 색이 적용됩니다.`
              }
            />
          )}
          <BrandingField
            label="로고 이미지"
            hint="인쇄물 머리글"
            slot="logo"
            value={p.logoUrl}
            onChange={(v) => set({ logoUrl: v })}
          />
          <BrandingField
            label="직인 이미지"
            hint="인쇄물 하단 직인"
            slot="seal"
            value={p.sealUrl}
            onChange={(v) => set({ sealUrl: v })}
          />
        </div>
      </SettingsCard>
      </div>
    </SectionForm>
  );
}

/**
 * 로고/직인 업로드 필드 — 파일 선택 → GCS 업로드(서버 티켓) → 값을 저장 경로로 set(SectionForm이 저장).
 * 미리보기는 방금 고른 File의 로컬 objectURL(GCS path는 비공개라 직접 <img> 불가 — 인쇄물은 서버가 resolve).
 * 외부 URL 직접 입력도 허용(하위호환). 업로드는 master만(서버 게이트).
 */
export function BrandingField({
  label,
  hint,
  slot,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  slot: "logo" | "seal" | "reportLogo";
  value: string;
  onChange: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // 읽기 권한이면 올리기·제거를 그리지 않는다(쓰기 잠금 — 폼이 세운다).
  const { locked } = useWriteLock();
  const ph = useLockedPlaceholder();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) return setErr("이미지 파일만 업로드할 수 있습니다");
    if (file.size > 5 * 1024 * 1024) return setErr("파일이 너무 큽니다 (최대 5MB)");
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const fd = new FormData();
      fd.set("slot", slot);
      fd.set("ext", ext);
      fd.set("contentType", file.type);
      fd.set("size", String(file.size));
      const tk = await issueBrandingUploadTicket(undefined, fd);
      if (tk?.error || !tk?.ticket) return setErr(tk?.error ?? "업로드 준비 실패");
      await uploadToTicket(tk.ticket, file);
      onChange(tk.ticket.path);
      setLocalPreview(URL.createObjectURL(file));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "업로드 실패");
    } finally {
      setBusy(false);
    }
  }

  const previewSrc = localPreview || (value.startsWith("http") ? value : null);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-text-dim text-xs font-medium">
        {label} <span className="text-text-faint">· {hint}</span>
      </span>
      <div className="flex items-center gap-3">
        <div className="border-line bg-bg-soft flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded border">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- 외부/objectURL 미리보기
            <img src={previewSrc} alt={label} className="h-full w-full object-contain" />
          ) : value ? (
            <span className="text-text-faint text-xs">업로드됨</span>
          ) : (
            <span className="text-text-faint text-xs">없음</span>
          )}
        </div>
        {locked ? null : (
          <label className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition">
            <input type="file" accept="image/*" hidden onChange={onFile} disabled={busy} />
            {busy ? "업로드 중…" : "이미지 업로드"}
          </label>
        )}
        {value && !locked ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setLocalPreview(null);
            }}
            className="text-text-faint hover:text-danger text-xs"
          >
            제거
          </button>
        ) : null}
      </div>
      {err ? <p className="text-danger text-xs">{err}</p> : null}
      <details className="text-text-faint text-xs">
        <summary className="cursor-pointer">URL 직접 입력</summary>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph("https://…/logo.png")}
          className="border-line bg-card mt-1 w-full rounded-md border px-2 py-1 text-xs"
        />
      </details>
    </div>
  );
}
