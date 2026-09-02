"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AUDIT_RESULTS, AUDIT_RESULT_LABEL } from "@/features/inventory/audit-result";
import { assetCategoryLabel } from "@/features/inventory/category";
import { setAssetStatus } from "@/features/inventory/server/asset-actions";
import { recordAudit } from "@/features/inventory/server/audit-actions";
import { assetStatusLabel } from "@/features/inventory/status";
import type { AssetOption } from "@/features/inventory/types";
import { DialogShell, FIELD, Field, FormError, SELECT, TEXTAREA, useSubmit } from "./form-bits";

/**
 * 실사 기록 — 자산 + 실사일 + 결과 + 확인위치 + 조치 + 비고. 확인자는 로그인한 사람(서버가 채운다).
 * 🔴 결과가 '미확인'이어도 자산 상태는 **자동으로 안 바뀐다** — 저장 뒤 "분실로 표시할까요?"를 **제안**하고
 *    사람이 누른다(자동 쓰기 금지).
 */
export function AuditDialog({ assets, presetAssetId, today, onClose }: { assets: AssetOption[]; presetAssetId?: string; today: string; onClose: () => void }) {
  const { busy, error, submit } = useSubmit();
  const [assetId, setAssetId] = useState(presetAssetId ?? "");
  const [suggest, setSuggest] = useState(false);
  const candidates = useMemo(() => assets.filter((a) => a.status !== "disposed"), [assets]);
  const picked = candidates.find((a) => a.id === assetId) ?? null;

  async function onSubmit(fd: FormData) {
    const res = await submit(fd, recordAudit, "실사를 기록했습니다");
    if (!res) return;
    if (res.suggestLost) setSuggest(true);
    else onClose();
  }

  async function markLost() {
    const fd = new FormData();
    fd.set("id", assetId);
    fd.set("status", "lost");
    const res = await submit(fd, setAssetStatus, "자산을 분실로 표시했습니다");
    if (res) onClose();
  }

  if (suggest) {
    return (
      <DialogShell title="실사를 기록했습니다" onClose={onClose}>
        <p className="text-[12.5px]">
          <span className="font-mono font-bold">{picked?.assetCode}</span>을(를) <b>미확인</b>으로 기록했습니다. 자산 상태를{" "}
          <b>분실</b>로 표시할까요? (지금 {picked ? assetStatusLabel(picked.status) : ""}) — 자동으로 바뀌지 않습니다.
        </p>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>그대로 두기</Button>
          <Button type="button" disabled={busy} onClick={markLost}>분실로 표시</Button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="실사 기록" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        <Field label="자산">
          <select name="assetId" value={assetId} onChange={(e) => setAssetId(e.target.value)} required disabled={!!presetAssetId} className={SELECT}>
            <option value="">자산을 고르세요</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.assetCode} · {a.model ?? assetCategoryLabel(a.category)} · {assetStatusLabel(a.status)}
              </option>
            ))}
          </select>
          {presetAssetId ? <input type="hidden" name="assetId" value={presetAssetId} /> : null}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="실사일"><input type="date" name="auditedOn" defaultValue={today} required max={today} className={FIELD} /></Field>
          <Field label="결과">
            <select name="result" defaultValue="ok" className={SELECT}>
              {AUDIT_RESULTS.map((r) => (
                <option key={r} value={r}>{AUDIT_RESULT_LABEL[r]}</option>
              ))}
            </select>
          </Field>
          <Field label="확인위치">
            <input key={picked?.id ?? "none"} name="location" defaultValue={picked?.location ?? ""} maxLength={120} placeholder="못 찾았으면 비워 두세요" className={FIELD} />
          </Field>
          <Field label="조치"><input name="action" maxLength={200} placeholder="예: 사용자 연락 · 2층 전수조사 · 재점검" className={FIELD} /></Field>
        </div>
        <Field label="비고"><textarea name="note" maxLength={500} className={TEXTAREA} /></Field>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>기록</Button>
        </div>
      </form>
    </DialogShell>
  );
}
