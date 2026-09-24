"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, fmtNum } from "@/components/super-admin/parts";
import { SEAT_FEATURES, TOGGLE_FEATURES } from "@/features/super-admin/labels";
import { upsertTenantLicense, toggleTenantLicense } from "@/features/super-admin/server/actions";
import type { TenantLicenseRow } from "@/features/super-admin/server/queries";

/**
 * 학원 라이선스 — 좌석 제한(숫자) + 기능 켜기·끄기. 기능 이름은 `labels.ts` 단일 소스(서버 액션 검증과 같은 목록).
 * ⚠️ 켜짐 스위치는 `role="switch"` + `aria-checked` — 색만으로 상태를 말하지 않게 옆에 '켜짐/꺼짐' 글자를 둔다.
 */
export function LicenseSection({
  tenantId,
  tenantName,
  licenses,
}: {
  tenantId: string;
  tenantName: string;
  licenses: TenantLicenseRow[];
}) {
  const byFeature = new Map(licenses.map((l) => [l.feature, l]));

  return (
    <Panel title="라이선스" description="좌석 수와 기능 사용 여부를 정합니다." flush>
      <ul className="divide-line divide-y">
        {SEAT_FEATURES.map((f) => (
          <SeatRow key={f.key} tenantId={tenantId} tenantName={tenantName} feature={f.key} label={f.label} license={byFeature.get(f.key)} />
        ))}
        {TOGGLE_FEATURES.map((f) => (
          <ToggleRow key={f.key} tenantId={tenantId} tenantName={tenantName} feature={f.key} label={f.label} license={byFeature.get(f.key)} />
        ))}
      </ul>
    </Panel>
  );
}

type RowProps = { tenantId: string; tenantName: string; feature: string; label: string; license?: TenantLicenseRow };

function SeatRow({ tenantId, tenantName, feature, label, license }: RowProps) {
  const [state, action, pending] = useActionState(upsertTenantLicense, undefined);
  const usage = license
    ? `${fmtNum(license.usedSeats)} / ${license.maxSeats === null ? "제한 없음" : `${fmtNum(license.maxSeats)}석`}`
    : "미설정";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-bold">{label}</p>
        <p className="num text-foreground text-xs">사용 / 최대: {usage}</p>
      </div>
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="tenantName" value={tenantName} />
        <input type="hidden" name="feature" value={feature} />
        <Input
          type="number"
          name="maxSeats"
          min={0}
          defaultValue={license?.maxSeats ?? ""}
          placeholder="비우면 제한 없음"
          aria-label={`${label} 최대 좌석`}
          className="num h-(--control-h) w-36 text-right"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </form>
      {state?.error ? <p className="text-danger w-full text-right text-xs font-medium">{state.error}</p> : null}
    </li>
  );
}

function ToggleRow({ tenantId, tenantName, feature, label, license }: RowProps) {
  const [state, action, pending] = useActionState(toggleTenantLicense, undefined);
  const isOn = license?.isActive ?? false;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
      <span className="text-foreground text-sm font-bold">{label}</span>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="tenantName" value={tenantName} />
        <input type="hidden" name="feature" value={feature} />
        <input type="hidden" name="nextActive" value={(!isOn).toString()} />
        <span className={`text-sm font-medium ${isOn ? "text-green" : "text-foreground"}`}>{isOn ? "켜짐" : "꺼짐"}</span>
        <button
          type="submit"
          role="switch"
          aria-checked={isOn}
          disabled={pending}
          aria-label={`${label} ${isOn ? "끄기" : "켜기"}`}
          className={`inline-flex h-6 w-11 cursor-pointer items-center rounded-full px-0.5 transition disabled:opacity-60 ${
            isOn ? "bg-green justify-end" : "bg-muted border-line justify-start border"
          }`}
        >
          <span className="bg-card size-5 rounded-full shadow-sm" />
        </button>
      </form>
      {state?.error ? <p className="text-danger w-full text-right text-xs font-medium">{state.error}</p> : null}
    </li>
  );
}
