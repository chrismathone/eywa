"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons/eywa-icon-compat";
import type { AccountSetting, AccountTargetKey, BillingSettings } from "@/features/owner/settings-types";
import { ACCOUNT_TARGETS } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { NumberField, TextAreaField, TextField } from "./fields";

const EMPTY_ACCOUNT: AccountSetting = { label: "", bank: "", holder: "", number: "", targets: [] };

// ⚠️ taxMode·defaultMethod는 소비처가 없어(세액 계산 미구현·invoices에 결제수단 컬럼 없음) v1에서 입력 숨김.
// 상태·스키마·저장은 보존 — 소비처가 생기면 입력만 복원하면 됨. (CLAUDE.md "학원 설정" orphan 인벤토리 참고)
export function BillingSection({ initial }: { initial: BillingSettings }) {
  const [b, setB] = useState<BillingSettings>(initial);
  const set = (patch: Partial<BillingSettings>) => setB((prev) => ({ ...prev, ...patch }));

  // 계좌 목록 변경 시 레거시 단일 account를 항상 "첫 계좌 미러"로 동기화(저장/검증 일관 + 미이전 소비처 안전).
  const setAccounts = (accounts: AccountSetting[]) =>
    setB((prev) => ({ ...prev, accounts, account: accounts[0] ?? EMPTY_ACCOUNT }));
  const patchAccount = (i: number, patch: Partial<AccountSetting>) =>
    setAccounts(b.accounts.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const addAccount = () => setAccounts([...b.accounts, { ...EMPTY_ACCOUNT, targets: [] }]);
  const removeAccount = (i: number) => setAccounts(b.accounts.filter((_, idx) => idx !== i));
  // 배선 토글 — 한 소비처(target)는 한 계좌에만: 켤 때 다른 계좌에서 같은 target 제거(배타).
  const toggleTarget = (i: number, target: AccountTargetKey, on: boolean) =>
    setAccounts(
      b.accounts.map((a, idx) => {
        if (idx === i) {
          const targets = on
            ? a.targets.includes(target)
              ? a.targets
              : [...a.targets, target]
            : a.targets.filter((t) => t !== target);
          return { ...a, targets };
        }
        return on ? { ...a, targets: a.targets.filter((t) => t !== target) } : a;
      }),
    );

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
        description="교재요청서·수강료 계산기 등에 표시되는 학원 입금 계좌입니다. 여러 개 등록하고, 계좌마다 '사용할 곳'을 지정하면 그 화면이 이 계좌를 자동으로 씁니다(한 화면은 한 계좌에만 배선). 어디에도 지정 안 하면 첫 계좌를 씁니다."
      >
        <div className="space-y-3">
          {b.accounts.length === 0 ? (
            <p className="text-text-dim border-line rounded-md border border-dashed px-3 py-6 text-center text-xs">
              등록된 입금 계좌가 없습니다. 아래 &apos;계좌 추가&apos;로 등록하세요.
            </p>
          ) : (
            b.accounts.map((a, i) => (
              <div key={i} className="border-line bg-bg-soft/40 space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground text-xs font-bold">계좌 {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeAccount(i)}
                    className="text-text-dim hover:text-danger inline-flex items-center gap-1 text-xs transition"
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
                {/* 사용할 곳(배선) — 이 계좌를 기본으로 쓸 화면. 한 화면은 한 계좌에만(배타). */}
                <div className="border-line/70 border-t pt-2.5">
                  <span className="text-foreground text-xs font-bold">사용할 곳</span>
                  <span className="text-text-dim ml-2 text-xs">이 계좌를 기본으로 쓸 화면</span>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                    {ACCOUNT_TARGETS.map((t) => (
                      <label
                        key={t.key}
                        className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={a.targets.includes(t.key)}
                          onChange={(e) => toggleTarget(i, t.key, e.target.checked)}
                          className="accent-primary size-4"
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            onClick={addAccount}
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs transition"
          >
            <Plus className="size-3.5" />
            계좌 추가
          </button>
        </div>
      </SettingsCard>
    </SectionForm>
  );
}
