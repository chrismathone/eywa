"use client";

import { useEffect, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { startTenantView } from "@/features/super-admin/server/tenant-view-actions";

/** 한 화면에 이 버튼이 둘 선다(머리글 · 안내 패널) — 여는 중인지는 둘이 함께 안다(잇달아 눌러 보기가 두 번 열리지 않게). */
let opening = false;

/**
 * 그 지점의 화면을 **읽기 전용**으로 여는 버튼(운영 콘솔 전용).
 * 누르면 보기 기록 · 감사 로그를 남기고 그 지점의 첫 화면으로 간다. 저장 · 발송은 되지 않는다.
 *
 * 🔴 이동은 **문서 이동**(`window.location.assign`)으로 한다 — 지점이 바뀌는 순간이라 이 탭이 그려 둔 화면 캐시를 통째로
 *    버린다. 서버 액션의 이동에 맡기면 화면만 갈아 끼워져 앞서 본 본인 지점 화면이 남는다([[#102]]).
 */
export function OpenTenantViewButton({ tenantId, variant = "default" }: { tenantId: string; variant?: "default" | "outline" }) {
  const [pending, setPending] = useState(false);

  // 뒤로 가기로 이 화면이 되살아나면(bfcache) '여는 중…'으로 굳어 있지 않게 푼다.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      opening = false;
      setPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const open = async () => {
    if (pending || opening) return;
    opening = true;
    setPending(true);
    let ok = false;
    try {
      ok = (await startTenantView(tenantId)).ok;
    } catch {
      ok = false;
    }
    // 열렸으면 그 지점의 첫 화면으로(서버가 정한다 — `/home`), 아니면 학원 상세로 돌아가 사유를 보여 준다.
    window.location.assign(ok ? "/home" : `/super-admin/tenants/${tenantId}?view=unavailable`);
  };

  return (
    <Button type="button" variant={variant} disabled={pending} onClick={open}>
      <EyIcon name="eye" size={16} strokeWidth={1.8} /> {pending ? "여는 중…" : "원장 화면 열기"}
    </Button>
  );
}
