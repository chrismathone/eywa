"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { Person } from "./followup-model";
import { managerDefaultRows, type ManagerDefaultRow, type ManagerDefaultView } from "./manager-defaults";
import { saveNewcomerDefaultManager } from "./server/manager-defaults-actions";

/**
 * 신규생 **과목 기본 담당 설정**(2026-11-11 · Claude·Codex 합의안 — 원장 위임) — '기본 관리 담당' 띠의 단추로 여는 작은 대화상자.
 * 과목마다 한 줄(학원 설정의 지금 과목 + EiE 줄 — manager-defaults.ts) · 지정·교체만(비우기·삭제 없음) · 줄마다 따로 저장한다.
 * 단추는 `canManage`(신규생 관리 '전체')인 사람에게만 선다 — 서버 액션이 같은 판정을 다시 본다(#77).
 * 🔴 열 때만 마운트한다(닫으면 고르던 값이 사라진다) — 늘 마운트해 두면 저장 뒤 다시 열 때 지난 상태가 남는다(#67).
 */
export function ManagerDefaultsButton({ defaults, staff, className }: { defaults: readonly ManagerDefaultView[]; staff: readonly Person[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>기본 담당 설정</button>
      {open ? <ManagerDefaultsDialog defaults={defaults} staff={staff} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function statusOf(row: ManagerDefaultRow): string {
  if (row.manager) return `지금 ${row.manager.name}`;
  return row.assigned ? "재지정 필요 — 지정했던 담당자가 퇴사했거나 관리 역할이 아닙니다" : "지정 없음";
}

function ManagerDefaultsDialog({ defaults, staff, onClose }: { defaults: readonly ManagerDefaultView[]; staff: readonly Person[]; onClose: () => void }) {
  const { options, labelOf } = useSubjectMaps();
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, string>>({});
  // 방금 저장한 값 — 새 값이 내려오는 동안에만 칸에 보인다(아래 save가 '고른 값'에서는 뺀다).
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // 저장 뒤 화면을 다시 받는 동안에는 줄을 잠근다 — 옛 기준 값(updatedAt)으로 한 번 더 저장하면 충돌로 거절된다.
  const [refreshing, startRefresh] = useTransition();
  const rows = managerDefaultRows(options, defaults, labelOf);
  const choices = staff.map((p) => ({ value: p.id, label: p.name }));
  const locked = busy !== null || refreshing;

  async function save(row: ManagerDefaultRow) {
    const managerId = picked[row.subject];
    if (!managerId || locked) return;
    setBusy(row.subject);
    setErrors((e) => ({ ...e, [row.subject]: "" }));
    // 요청이 아예 실패해도(연결 끊김 등) 단추가 '저장 중'에 굳지 않게 한다.
    const res = await saveNewcomerDefaultManager({ subject: row.subject, managerId, expectedUpdatedAt: row.updatedAt })
      .catch(() => ({ ok: false as const, error: "기본 담당을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }));
    setBusy(null);
    if (!res.ok) {
      setErrors((e) => ({ ...e, [row.subject]: res.error }));
      // 그사이 다른 사람이 바꿨으면 최신 값을 받아 보여 준다(고른 값은 남겨 둔다 — 확인하고 다시 저장할 수 있게).
      if ("conflict" in res && res.conflict) startRefresh(() => router.refresh());
      return;
    }
    // 🔴 저장이 끝난 선택은 '고른 값'에서 뺀다 — 남겨 두면, 그 뒤 다른 사람이 바꾼 줄이 내려왔을 때 옛 선택이 '교체할 것'으로 되살아나
    //    새로 고르지 않았는데도 최신 기준 값으로 저장된다(충돌 검사도 지난다). 충돌한 선택과 다른 줄의 선택은 그대로 둔다.
    setPicked((p) => Object.fromEntries(Object.entries(p).filter(([subject]) => subject !== row.subject)));
    setSaved((v) => ({ ...v, [row.subject]: managerId }));
    toast.success(`${row.label} 기본 담당을 ${staff.find((p) => p.id === managerId)?.name ?? "새 담당자"} 님으로 ${row.assigned ? "바꿨습니다" : "지정했습니다"}`);
    startRefresh(() => router.refresh());
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && busy === null) onClose(); }}>
      <DialogContent className="sm:max-w-xl" showCloseButton={busy === null}>
        <DialogHeader>
          <DialogTitle>과목 기본 담당 설정</DialogTitle>
          <DialogDescription>
            학생·과목마다 직접 지정하지 않은 신규생 전체에 적용됩니다. 직접 지정한 학생의 담당과 지난 기록은 그대로입니다.
          </DialogDescription>
        </DialogHeader>
        {choices.length === 0 ? (
          <p role="alert" className="text-danger text-sm">지정할 수 있는 관리 담당자(재직 중인 관리 역할 직원)가 없습니다.</p>
        ) : null}
        <ul className="divide-line-faint border-line divide-y rounded-lg border">
          {rows.map((row) => {
            // 칸의 값 = 고른 값 → (새 값이 내려오는 동안) 방금 저장한 값 → 지금 담당자.
            const value = picked[row.subject] ?? (refreshing ? saved[row.subject] : undefined) ?? row.manager?.id ?? "";
            const dirty = !!picked[row.subject] && picked[row.subject] !== row.manager?.id;
            return (
              <li key={row.subject} className="space-y-1.5 px-3 py-2.5" data-default-subject={row.subject}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-28">
                    <p className="text-foreground font-bold break-keep">{row.label}</p>
                    <p className={`text-xs break-keep ${row.assigned && !row.manager ? "text-danger" : "text-text-dim"}`}>{statusOf(row)}</p>
                  </div>
                  <SearchableSelect
                    className="w-44 shrink-0"
                    ariaLabel={`${row.label} 기본 담당`}
                    options={choices}
                    value={value}
                    onValueChange={(id) => { if (id) setPicked((p) => ({ ...p, [row.subject]: id })); }}
                    placeholder="담당자 선택"
                    searchPlaceholder="이름 검색"
                    disabled={locked || choices.length === 0}
                    portal
                  />
                  <Button type="button" size="sm" className="shrink-0" disabled={!dirty || locked} onClick={() => void save(row)}>
                    {busy === row.subject ? "저장 중…" : row.assigned ? "교체" : "지정"}
                  </Button>
                </div>
                {row.note ? <p className="text-text-dim text-xs break-keep">{row.note}</p> : null}
                {errors[row.subject] ? <p role="alert" className="text-danger text-xs break-keep">{errors[row.subject]}</p> : null}
              </li>
            );
          })}
        </ul>
        <p className="text-text-dim text-xs break-keep">
          지정·교체만 할 수 있습니다(비우기는 없습니다). 바꾼 내용은 감사로그에 남습니다.
        </p>
      </DialogContent>
    </Dialog>
  );
}
