"use client";

import { useState } from "react";
import type { BillingSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { NumberField, SelectField, TextAreaField, TextField } from "./fields";

const TAX_OPTIONS = [
  { value: "none", label: "비과세 (학원교습비)" },
  { value: "include", label: "부가세 포함" },
  { value: "exclude", label: "부가세 별도" },
];

export function BillingSection({ initial }: { initial: BillingSettings }) {
  const [b, setB] = useState<BillingSettings>(initial);
  const set = (patch: Partial<BillingSettings>) => setB((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="billing" payload={b}>
      <SettingsCard title="청구 기본값" description="청구서 생성·수강료 계산기의 기본값으로 쓰입니다.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <NumberField
            label="기본 납부 마감일"
            hint="매월 N일"
            value={b.dueDay}
            onChange={(v) => set({ dueDay: v })}
            min={1}
            max={31}
          />
          <SelectField
            label="세금 처리"
            value={b.taxMode}
            onChange={(v) => set({ taxMode: v as BillingSettings["taxMode"] })}
            options={TAX_OPTIONS}
          />
          <TextField
            label="기본 결제수단"
            value={b.defaultMethod}
            onChange={(v) => set({ defaultMethod: v })}
            placeholder="계좌이체"
          />
        </div>
        <div className="mt-4">
          <TextAreaField
            label="연체·환불 정책 안내"
            hint="청구서·안내문에 노출"
            value={b.latePolicy}
            onChange={(v) => set({ latePolicy: v })}
            rows={3}
          />
        </div>
      </SettingsCard>
    </SectionForm>
  );
}
