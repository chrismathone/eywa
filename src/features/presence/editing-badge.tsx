"use client";

import { Pencil } from "@/components/icons/eywa-icon-compat";
import { dedupeEditors } from "./presence-state";
import { useEditingOthers } from "./edit-presence";

/**
 * 목록 행/카드에 인라인으로 붙는 "수정중" 배지 — 그 레코드를 **다른 사람이 지금 편집 중**이면 표시.
 * userId dedupe(같은 사람 여러 탭=1명). 아무도 없으면 렌더 0.
 *
 * 🔴 **꽉 찬 앰버**다(원장 2026-09-01: *"수정중 상태를 더 확실히 티가나게 색깔을 바꿔버려"*).
 *    종전엔 `bg-amber-soft`(연한 틴트) + 10px라 옆의 다른 연한 배지들과 구분이 안 됐다 — 이 배지는
 *    "지금 누가 만지고 있으니 동시에 저장하면 덮어쓴다"는 **경고**라 눈에 걸려야 한다.
 * ⚠️ 색상(앰버)은 그대로 두고 **채도만** 올렸다 — 같은 뜻의 편집 폼 배너(EditingBanner)도 앰버라,
 *    여기만 다른 색으로 바꾸면 같은 사실이 화면마다 다른 색이 된다(의미색 캐논: 색은 뜻마다 하나).
 */
export function EditingBadge({ scope, className }: { scope: string; className?: string }) {
  const others = dedupeEditors(useEditingOthers(scope));
  if (others.length === 0) return null;
  const first = others[0]!.userName || "누군가";
  const label = others.length === 1 ? `수정중 · ${first}` : `수정중 · ${first} 외 ${others.length - 1}명`;
  return (
    <span
      className={`bg-amber inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-[2px] align-middle text-xs font-bold text-white ${className ?? ""}`}
      title={`${others.map((o) => o.userName || "누군가").join(", ")}님이 지금 이 항목을 수정 중입니다`}
    >
      <Pencil className="size-2.5" strokeWidth={2.5} aria-hidden />
      {label}
    </span>
  );
}

/**
 * 편집 폼 상단 경고 배너 — 폼을 열었을 때 이미 **다른 사람이 같은 레코드를 편집 중**이면 표시.
 * soft(둘 다 저장 가능, 마지막이 이김) — 문구로 덮어쓰기 위험을 알린다.
 */
export function EditingBanner({ scope }: { scope: string }) {
  const others = dedupeEditors(useEditingOthers(scope));
  if (others.length === 0) return null;
  const names = others.map((o) => o.userName || "누군가").join(", ");
  return (
    <div className="border-amber/40 bg-amber/5 text-amber flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <Pencil className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} aria-hidden />
      <span>
        <strong className="font-bold">{names}</strong>님이 지금 이 기록을 수정 중입니다 — 동시에 저장하면 서로의 변경이 덮어쓰일 수 있어요.
      </span>
    </div>
  );
}
