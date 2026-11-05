"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TODAYS_MATH_PRODUCTS, type TodaysMathMenus } from "@/features/integrations/todays-math/branch-menus";
import { loadTodaysMathMenus, saveTodaysMathMenus } from "@/features/integrations/todays-math/server/branch-menus-actions";
import { SettingsCard } from "./settings-card";

/**
 * 학원 설정 → 연동 → 오늘 수학 → '오늘 수학 사용 메뉴'(원장 2026-10-19 · 원장만). 오늘 수학 지점관리의 '사용 메뉴'와 **같은 값**이다 —
 * 여기서 바꾸면 오늘 수학 화면에, 오늘 수학에서 바꾸면 여기에 그대로 보인다(값은 오늘 수학에만 있고 열 때마다 읽는다).
 * 오늘 수학이 열지 않은 메뉴는 켤 수 없다. 모양 = 오늘 수학 시안 H2+H3(촘촘한 표 · 상태 칸 · 켠 줄만 옅은 면).
 * 저장 버튼은 이 카드 안에 있다(학원 설정 저장과 따로 — 바로 오늘 수학에 저장된다).
 */
const FAILED = "오늘 수학에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

/**
 * `canEdit` = 연동 설정 쓰기 — 저장 액션(`saveTodaysMathMenus`)과 같은 판정(integrations-face.tsx가 내린다). 없으면 켜기·끄기·
 * 저장 단추를 그리지 않고 체크칸을 잠근다(원장 2026-11-05). 지금 값은 그대로 보인다.
 */
export function TodaysMathMenusCard({ canEdit = true }: { canEdit?: boolean }) {
  const [saved, setSaved] = useState<TodaysMathMenus | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (data: TodaysMathMenus) => {
    setSaved(data);
    setDraft(new Set(data.items.filter((i) => i.on).map((i) => i.menu)));
  };
  const load = async (message?: string) => {
    setBusy(true);
    try {
      const r = await loadTodaysMathMenus();
      if (r.ok) { apply(r.data); setError(null); setConflict(false); setNotice(message ?? null); }
      else setError(r.message);
    } catch { setError(FAILED); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let alive = true;
    loadTodaysMathMenus().then((r) => {
      if (!alive) return;
      if (r.ok) apply(r.data); else setError(r.message);
    }, () => { if (alive) setError(FAILED); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, []);

  const dirty = useMemo(() => !!saved && saved.items.some((i) => i.open && i.on !== draft.has(i.menu)), [saved, draft]);
  const setMany = (menus: string[], on: boolean) => {
    setNotice(null);
    setDraft((prev) => {
      const next = new Set(prev);
      for (const m of menus) if (on) next.add(m); else next.delete(m);
      return next;
    });
  };
  const save = async () => {
    if (!saved) return;
    setBusy(true); setError(null);
    try {
      const r = await saveTodaysMathMenus({
        menus: saved.items.filter((i) => i.open && draft.has(i.menu)).map((i) => i.menu),
        expectedRevision: saved.revision,
        before: saved,
      });
      if (r.ok) { apply(r.data); setNotice("오늘 수학에 저장했습니다."); }
      else { setError(r.message); setConflict(!!r.conflict); }
    } catch { setError(FAILED); }
    finally { setBusy(false); }
  };

  const onCount = saved ? saved.items.filter((i) => i.open && draft.has(i.menu)).length : 0;
  return (
    <SettingsCard
      title="오늘 수학 사용 메뉴"
      span2
      description="이 지점의 원장·관리자·강사가 오늘 수학에서 쓰는 메뉴입니다. 오늘 수학 지점관리의 '사용 메뉴'와 같은 설정이라 어느 쪽에서 바꿔도 함께 바뀝니다. 오늘 수학에서 열지 않은 메뉴는 켤 수 없습니다."
    >
      {!saved ? (
        <p className={error ? "text-sm text-danger" : "text-sm text-text-dim"} role={error ? "alert" : undefined}>
          {error ?? "불러오는 중…"}
        </p>
      ) : (
        <div className="space-y-3" aria-busy={busy}>
          <div className="grid gap-3 lg:grid-cols-2">
            {TODAYS_MATH_PRODUCTS.map((product) => {
              const items = saved.items.filter((i) => i.product === product.id);
              const open = items.filter((i) => i.open);
              return (
                <div key={product.id} className="overflow-hidden rounded-lg border border-line bg-card">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                    <h4 className="text-sm font-bold">{product.label}</h4>
                    <span className="text-xs text-text-dim tabular-nums">
                      {open.filter((i) => draft.has(i.menu)).length} / 열림 {open.length}
                    </span>
                    {canEdit ? (
                      <span className="ml-auto flex gap-1">
                        <Button type="button" variant="ghost" size="xs" disabled={busy || conflict} onClick={() => setMany(open.map((i) => i.menu), true)}>모두 켜기</Button>
                        <Button type="button" variant="ghost" size="xs" disabled={busy || conflict} onClick={() => setMany(open.map((i) => i.menu), false)}>모두 끄기</Button>
                      </span>
                    ) : null}
                  </div>
                  <table className="w-full table-fixed border-collapse text-sm">
                    <colgroup><col className="w-10" /><col /><col className="w-24" /></colgroup>
                    <tbody>
                      {items.map((item) => {
                        const on = item.open && draft.has(item.menu);
                        const id = `tm-menu-${item.menu}`;
                        return (
                          <tr key={item.menu} className={`border-b border-line last:border-b-0 ${on ? "bg-primary-soft" : ""}`}>
                            <td className="px-3 py-1 text-center">
                              <input id={id} type="checkbox" className="size-4 accent-[var(--primary)]" checked={on}
                                disabled={!canEdit || !item.open || busy || conflict} onChange={(e) => setMany([item.menu], e.target.checked)} />
                            </td>
                            <td className="py-1">
                              <label htmlFor={id} className={item.open ? undefined : "text-text-faint"}>{item.label}</label>
                            </td>
                            <td className={`px-3 py-1 text-right text-xs ${!item.open ? "text-text-faint" : on ? "font-semibold text-primary" : "text-text-dim"}`}>
                              {!item.open ? "열리지 않음" : on ? "사용" : "끔"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {error ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
              {conflict ? <Button type="button" variant="outline" size="sm" onClick={() => load("최신 설정을 불러왔습니다.")}>최신 설정 불러오기</Button> : null}
            </p>
          ) : null}
          {notice ? <p className="rounded-lg bg-green-soft px-3 py-2 text-sm text-green" role="status">{notice}</p> : null}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs text-text-dim" aria-live="polite">
                사용 메뉴 {onCount}개 · {dirty ? "저장하지 않은 변경이 있습니다." : "저장하지 않은 변경 없음"}
              </span>
              <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => { apply(saved); setNotice(null); }}>변경 취소</Button>
              <Button type="button" disabled={busy || !dirty || conflict} onClick={save}>사용 메뉴 저장</Button>
            </div>
          ) : (
            // canEdit=false면 연동 면 전체가 잠긴 것 — 권한 안내는 면 위 한 줄(owner/page.tsx)이 적는다(두 번 뜨지 않게).
            <p className="text-xs text-text-dim">사용 메뉴 {onCount}개</p>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
