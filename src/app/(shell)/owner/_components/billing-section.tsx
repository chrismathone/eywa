"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons/aywa-icon-compat";
import type { AccountSetting, AccountTargetKey, BillingSettings } from "@/features/owner/settings-types";
import { ACCOUNT_TARGETS } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { NumberField, TextAreaField, TextField } from "./fields";

const EMPTY_ACCOUNT: AccountSetting = { label: "", bank: "", holder: "", number: "", targets: [] };

// ⚠️ taxMode·defaultMethod는 소비처가 없어(세액 계산 미구현·invoices에 결제수단 컬럼 없음) v1에서 입력 숨김.
// 상태·스키마·저장은 보존 — 소비처가 생기면 입력만 복원하면 됨. (CLAUDE.md "학원 설정" orphan 인벤토리 참고)
export function BillingSection({
  initial,
  showEie = true,
  readOnly = false,
}: {
  initial: BillingSettings;
  /** 읽기 권한 — 추가·삭제 단추를 그리지 않고 입력을 잠근다(저장 액션과 같은 판정, page.tsx). */
  readOnly?: boolean;
  /** EiE 월 수강료 카드 — EiE 모듈이 꺼진 학원(새 학원 기본)은 안 보인다. 값은 state에 남아 그대로 저장된다. */
  showEie?: boolean;
}) {
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
    <SectionForm section="billing" payload={b} readOnly={readOnly}>
      <SettingsCard
        title="공통 회당 단가"
        description="수학·영어가 함께 쓰는 회차 확정 드롭다운입니다. 같은 금액은 한 번만 등록하며, 저장하면 반 일괄·학생별 단가 선택에 반영됩니다. 이미 확정한 금액은 유지됩니다."
      >
        <div className="space-y-3">
          {b.sessionPrices.map((row, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
              <NumberField
                label={`회당 단가 ${i + 1}`}
                hint="원"
                value={row.price}
                min={1}
                max={1_000_000_000}
                onChange={(price) => set({ sessionPrices: b.sessionPrices.map((r, j) => j === i ? { ...r, price } : r) })}
              />
              <div className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
                <TextField
                  label={`단가 설명 ${i + 1}`}
                  hint="선택"
                  value={row.label}
                  placeholder="예: 초등 3T · 초등특강"
                  onChange={(label) => set({ sessionPrices: b.sessionPrices.map((r, j) => j === i ? { ...r, label } : r) })}
                />
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`단가 ${i + 1} 삭제`}
                  onClick={() => set({ sessionPrices: b.sessionPrices.filter((_, j) => j !== i) })}
                  className="text-text-dim hover:text-danger col-start-2 row-start-1 flex h-10 items-center gap-1 text-xs sm:col-start-auto sm:row-start-auto"
                >
                  <Trash2 className="size-3.5" />삭제
                </button>
              )}
            </div>
          ))}
          {b.sessionPrices.length === 0 ? <p className="text-text-dim text-sm">등록된 단가가 없습니다. 회차 화면에서 직접 입력할 수도 있습니다.</p> : null}
          {readOnly ? null : (
            <button
              type="button"
              disabled={b.sessionPrices.length >= 100}
              onClick={() => set({ sessionPrices: [...b.sessionPrices, { price: 0, label: "" }] })}
              className="border-line text-text-dim hover:bg-bg-soft flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs disabled:opacity-50"
            >
              <Plus className="size-3.5" />단가 추가
            </button>
          )}
        </div>
      </SettingsCard>

      {showEie ? (
        <SettingsCard title="EiE 월 수강료" description="회차를 곱하지 않는 월 고정 금액입니다. 월 금액을 확정하면 청구·분배에 쓰이고, 수강료 계산기의 EiE 항목에도 적용됩니다.">
          <div className="max-w-xs">
            <NumberField label="EiE 월 고정 금액" hint="원" value={b.eieMonthlyPrice} min={1} max={1_000_000_000} onChange={(eieMonthlyPrice) => set({ eieMonthlyPrice })} />
          </div>
        </SettingsCard>
      ) : null}

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
              {readOnly ? "등록된 입금 계좌가 없습니다." : <>등록된 입금 계좌가 없습니다. 아래 &apos;계좌 추가&apos;로 등록하세요.</>}
            </p>
          ) : (
            b.accounts.map((a, i) => (
              <div key={i} className="border-line bg-bg-soft/40 space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground text-xs font-bold">계좌 {i + 1}</span>
                  {readOnly ? null : (
                    <button
                      type="button"
                      onClick={() => removeAccount(i)}
                      className="text-text-dim hover:text-danger inline-flex items-center gap-1 text-xs transition"
                    >
                      <Trash2 className="size-3.5" />
                      삭제
                    </button>
                  )}
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
                    placeholder="예: 홍길동"
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
          {readOnly ? null : (
            <button
              type="button"
              onClick={addAccount}
              className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs transition"
            >
              <Plus className="size-3.5" />
              계좌 추가
            </button>
          )}
        </div>
      </SettingsCard>
    </SectionForm>
  );
}
