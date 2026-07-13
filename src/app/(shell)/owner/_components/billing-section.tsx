"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AccountSetting, BillingSettings } from "@/features/owner/settings-types";
import { defaultAccountOf } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { NumberField, TextAreaField, TextField } from "./fields";

const EMPTY_ACCOUNT: AccountSetting = { label: "", bank: "", holder: "", number: "", isDefault: false };

// ⚠️ taxMode·defaultMethod는 소비처가 없어(세액 계산 미구현·invoices에 결제수단 컬럼 없음) v1에서 입력 숨김.
// 상태·스키마·저장은 보존 — 소비처가 생기면 입력만 복원하면 됨. (CLAUDE.md "학원 설정" orphan 인벤토리 참고)
export function BillingSection({ initial }: { initial: BillingSettings }) {
  const [b, setB] = useState<BillingSettings>(initial);
  const set = (patch: Partial<BillingSettings>) => setB((prev) => ({ ...prev, ...patch }));

  // 계좌 목록 변경 시 레거시 단일 account를 항상 "기본 계좌 미러"로 동기화(저장/검증 일관 + 미이전 소비처 안전).
  const setAccounts = (accounts: AccountSetting[]) =>
    setB((prev) => ({ ...prev, accounts, account: defaultAccountOf({ ...prev, accounts }) }));
  const patchAccount = (i: number, patch: Partial<AccountSetting>) =>
    setAccounts(b.accounts.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const addAccount = () =>
    setAccounts([...b.accounts, { ...EMPTY_ACCOUNT, isDefault: b.accounts.length === 0 }]);
  const removeAccount = (i: number) => setAccounts(b.accounts.filter((_, idx) => idx !== i));
  const setDefault = (i: number) => setAccounts(b.accounts.map((a, idx) => ({ ...a, isDefault: idx === i })));

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

      <SettingsCard
        title="입금 계좌"
        description="교재요청서·수강료 계산기 등에 표시되는 학원 입금 계좌입니다. 여러 개 등록할 수 있고, '기본'으로 지정한 계좌가 각 화면의 디폴트값으로 들어갑니다."
      >
        <div className="space-y-3">
          {b.accounts.length === 0 ? (
            <p className="text-text-dim border-line rounded-md border border-dashed px-3 py-6 text-center text-[12px]">
              등록된 입금 계좌가 없습니다. 아래 &apos;계좌 추가&apos;로 등록하세요.
            </p>
          ) : (
            b.accounts.map((a, i) => (
              <div key={i} className="border-line bg-bg-soft/40 space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-foreground inline-flex items-center gap-1.5 text-[12px] font-semibold">
                    <input
                      type="radio"
                      name="billing-default-account"
                      checked={a.isDefault}
                      onChange={() => setDefault(i)}
                      className="accent-primary size-4"
                    />
                    기본 계좌
                  </label>
                  <button
                    type="button"
                    onClick={() => removeAccount(i)}
                    className="text-text-dim hover:text-danger inline-flex items-center gap-1 text-[12px] transition"
                  >
                    <Trash2 className="size-3.5" />
                    삭제
                  </button>
                </div>
                <TextField
                  label="별칭"
                  hint="선택 — 계좌 구분용(예: 메인, 교재비)"
                  placeholder="예: 메인 계좌"
                  value={a.label}
                  onChange={(v) => patchAccount(i, { label: v })}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <TextField
                    label="은행"
                    placeholder="예: 국민은행"
                    value={a.bank}
                    onChange={(v) => patchAccount(i, { bank: v })}
                  />
                  <TextField
                    label="예금주"
                    placeholder="예: 인재원"
                    value={a.holder}
                    onChange={(v) => patchAccount(i, { holder: v })}
                  />
                  <TextField
                    label="계좌번호"
                    placeholder="예: 123-456-789012"
                    value={a.number}
                    onChange={(v) => patchAccount(i, { number: v })}
                  />
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            onClick={addAccount}
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-[12px] transition"
          >
            <Plus className="size-3.5" />
            계좌 추가
          </button>
        </div>
      </SettingsCard>
    </SectionForm>
  );
}
