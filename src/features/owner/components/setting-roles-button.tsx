"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MENU_LABEL } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { SETTINGS_ROLE_GROUPS, type SettingsRoleGroup, type SettingsRoleKey } from "@/lib/settings-role-catalog";
import { SETTING_ROLES, type SettingRoleSelection } from "../setting-roles";
import { saveSettingRoles } from "../server/setting-role-actions";

export function SettingRolesButton({ group, initial, hidden = [] }: { group: SettingsRoleGroup; initial: SettingRoleSelection; hidden?: SettingsRoleKey[] }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const menus = SETTINGS_ROLE_GROUPS[group].filter(menu => !hidden.includes(menu));
  if (!menus.length) return null;
  return <>
    <Button size="sm" variant="outline" onClick={() => { setSelection(initial); setBaseline(JSON.stringify(initial)); setOpen(true); }}>역할 설정</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>설정을 보여줄 직급</DialogTitle>
        <DialogDescription>항목마다 사용할 직급을 선택하세요. 개인별 예외와 기존 조회 전용 권한은 유지됩니다.</DialogDescription>
        <form onSubmit={event => {
          event.preventDefault();
          startTransition(async () => {
            try {
              const result = await saveSettingRoles(group, selection, baseline);
              if (result.error || !result.selection) { toast.error(result.error ?? "저장하지 못했습니다"); return; }
              setSelection(result.selection); setBaseline(JSON.stringify(result.selection));
              setOpen(false); toast.success("역할 설정을 저장했습니다"); router.refresh();
            } catch { toast.error("저장하지 못했습니다. 다시 시도해 주세요."); }
          });
        }} className="space-y-4">
          <fieldset disabled={pending} className="space-y-4">
            {menus.map(menu => <fieldset key={menu} className="border-line rounded-lg border p-3">
              <legend className="px-1 text-sm font-semibold">{MENU_LABEL[menu]}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {SETTING_ROLES.map(role => <label key={role} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`${MENU_LABEL[menu]} · ${ROLE_LABEL[role]}`}
                    checked={selection[menu]?.includes(role) ?? false} disabled={role === "master"}
                    onChange={event => {
                      const checked = event.target.checked;
                      setSelection(previous => ({ ...previous, [menu]: checked
                        ? [...(previous[menu] ?? []), role] : (previous[menu] ?? []).filter(value => value !== role) }));
                    }} />
                  {ROLE_LABEL[role]}
                </label>)}
              </div>
            </fieldset>)}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>취소</Button>
            <Button type="submit" disabled={pending}>{pending ? "저장 중…" : "저장"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
