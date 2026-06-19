"use client";

import { useState } from "react";
import type { BillingSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { NumberField, TextAreaField } from "./fields";

// ⚠️ taxMode·defaultMethod는 소비처가 없어(세액 계산 미구현·invoices에 결제수단 컬럼 없음) v1에서 입력 숨김.
// 상태·스키마·저장은 보존 — 소비처가 생기면 입력만 복원하면 됨. (CLAUDE.md "학원 설정" orphan 인벤토리 참고)
export function BillingSection({ initial }: { initial: BillingSettings }) {
  const [b, setB] = useState<BillingSettings>(initial);
  const set = (patch: Partial<BillingSettings>) => setB((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="billing" payload={b}>
      <SettingsCard title="청구 기본값" description="청구서 생성·수강료 계산기의 기본값으로 쓰입니다.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="기본 납부 마감일"
            hint="매월 N일"
            value={b.dueDay}
            onChange={(v) => set({ dueDay: v })}
            min={1}
            max={31}
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
