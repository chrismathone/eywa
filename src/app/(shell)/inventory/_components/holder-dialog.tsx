"use client";

import { Button } from "@/components/ui/button";
import { setAssetHolder } from "@/features/inventory/server/asset-actions";
import { assetStatusLabel } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { DialogShell, FIELD, Field, FormError, useSubmit } from "./form-bits";

/**
 * **사용자(보유자) 지정** — 자산 표의 '사용자' 칸 더블클릭(원장 2026-09-08
 * *"더블클릭해도 사용자 수정을 할 수 없네 … 더블클릭에서 지정할 수 있도록"*).
 *
 * 🔴 **대여 중이면 이 창이 아니라 안내가 뜬다** — 그때의 사용자는 대여자에서 파생된 값이라 여기서
 *    고치면 자산 표와 대여 표가 다른 이름을 말한다(서버도 같은 판정으로 거절한다, [[#77]]).
 * ⚠️ 이름은 **자유 입력**이다 — 실데이터에 `셔틀담당`·`확인필요`처럼 계정이 없는 값이 들어 있다.
 *    비우면 `—`(아무도 안 갖고 있음)로 돌아간다.
 */
export function HolderDialog({
  asset,
  blockedReason,
  onClose,
}: {
  asset: InventoryAsset;
  /** 대여 중 등으로 못 고치는 사유(서버와 같은 순수 규약이 만든 문장). 있으면 안내만 띄운다. */
  blockedReason: string | null;
  onClose: () => void;
}) {
  const { busy, error, submit } = useSubmit();

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, setAssetHolder, "사용자를 저장했습니다");
    if (res) onClose();
  }

  if (blockedReason) {
    return (
      <DialogShell title={`사용자 — ${asset.assetCode}`} onClose={onClose}>
        <p className="text-xs">{blockedReason}</p>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            닫기
          </Button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title={`사용자 지정 — ${asset.assetCode}`}
      description={`${asset.model ?? ""} · ${assetStatusLabel(asset.status)}${asset.location ? ` · ${asset.location}` : ""}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="id" value={asset.id} />
        <Field label="사용자" hint="비우면 '—'(아무도 안 갖고 있음)로 돌아갑니다.">
          <input
            name="holderName"
            defaultValue={asset.holderName ?? ""}
            maxLength={80}
            autoFocus
            placeholder="이름 또는 담당(예: 셔틀담당)"
            className={FIELD}
          />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={busy}>
            저장
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
