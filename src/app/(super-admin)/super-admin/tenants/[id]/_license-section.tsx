"use client";

import { useActionState } from "react";
import { upsertTenantLicense, toggleTenantLicense } from "@/features/super-admin/server/actions";
import type { TenantLicenseRow } from "@/features/super-admin/server/queries";

const SEAT_FEATURES = [{ key: "student_seats", label: "재원생 좌석" }];
const TOGGLE_FEATURES = [
  { key: "ai_analysis", label: "AI 분석" },
  { key: "google_sheets", label: "Google Sheets 연동" },
  { key: "meeting_recording", label: "회의 녹음·전사" },
];

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
    <section className="bg-card border-line shadow-card space-y-5 rounded-2xl border p-5">
      <header>
        <p className="micro">라이선스</p>
        <h3 className="text-foreground mt-0.5 text-[15px] font-bold">기능·좌석 관리</h3>
      </header>

      {/* 좌석형 */}
      <div className="space-y-2">
        <p className="text-text-dim text-[11px] font-bold tracking-wide uppercase">좌석 제한</p>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-text-dim border-line border-b">
              <th className="py-1.5 text-left font-bold">기능</th>
              <th className="py-1.5 text-right font-bold">사용 / 최대</th>
              <th className="py-1.5 text-right font-bold">설정</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {SEAT_FEATURES.map((f) => (
              <SeatRow
                key={f.key}
                tenantId={tenantId}
                tenantName={tenantName}
                feature={f.key}
                label={f.label}
                license={byFeature.get(f.key)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* 토글형 */}
      <div className="space-y-2">
        <p className="text-text-dim text-[11px] font-bold tracking-wide uppercase">기능 On / Off</p>
        <ul className="divide-line divide-y">
          {TOGGLE_FEATURES.map((f) => (
            <ToggleRow
              key={f.key}
              tenantId={tenantId}
              tenantName={tenantName}
              feature={f.key}
              label={f.label}
              license={byFeature.get(f.key)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SeatRow({
  tenantId,
  tenantName,
  feature,
  label,
  license,
}: {
  tenantId: string;
  tenantName: string;
  feature: string;
  label: string;
  license?: TenantLicenseRow;
}) {
  const [state, action, pending] = useActionState(upsertTenantLicense, undefined);
  return (
    <tr>
      <td className="text-foreground py-2 font-medium">{label}</td>
      <td className="text-text-dim py-2 text-right tabular-nums">
        {license ? `${license.usedSeats} / ${license.maxSeats ?? "∞"}` : "미설정"}
      </td>
      <td className="py-2 text-right">
        <form action={action} className="inline-flex items-center gap-1.5">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="tenantName" value={tenantName} />
          <input type="hidden" name="feature" value={feature} />
          <input
            type="number"
            name="maxSeats"
            min={0}
            defaultValue={license?.maxSeats ?? ""}
            placeholder="좌석"
            className="border-line w-20 rounded-sm border bg-transparent px-2 py-1 text-right text-xs"
          />
          <button
            type="submit"
            disabled={pending}
            className="bg-primary text-primary-foreground rounded-sm px-2.5 py-1 text-[11px] font-bold disabled:opacity-60"
          >
            {pending ? "…" : "저장"}
          </button>
        </form>
        {state?.error ? <p className="text-danger mt-1 text-[10px]">{state.error}</p> : null}
      </td>
    </tr>
  );
}

function ToggleRow({
  tenantId,
  tenantName,
  feature,
  label,
  license,
}: {
  tenantId: string;
  tenantName: string;
  feature: string;
  label: string;
  license?: TenantLicenseRow;
}) {
  const [, action, pending] = useActionState(toggleTenantLicense, undefined);
  const isOn = license?.isActive ?? false;
  return (
    <li className="flex items-center justify-between py-2.5">
      <span className="text-foreground text-[13px]">{label}</span>
      <form action={action}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="tenantName" value={tenantName} />
        <input type="hidden" name="feature" value={feature} />
        <input type="hidden" name="nextActive" value={(!isOn).toString()} />
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex h-6 w-11 items-center rounded-full px-0.5 transition disabled:opacity-60 ${
            isOn ? "bg-primary justify-end" : "bg-bg-soft border-line border justify-start"
          }`}
          aria-label={`${label} ${isOn ? "끄기" : "켜기"}`}
        >
          <span className="bg-card size-5 rounded-full shadow-sm" />
        </button>
      </form>
    </li>
  );
}
