"use client";

import { useEffect, useRef } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SYSTEM_ROLES, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import type { PermissionRow, PermissionRowGroup } from "@/features/owner/permission-rows";
import { ACCESS_CLS, ACCESS_LABEL, isCellLocked, ROLE_LABEL } from "./permission-ui";

/**
 * '역할별 메뉴 권한' 표 — 줄은 왼쪽 탭과 그 내부 메뉴의 차례([permission-rows.ts](@/features/owner/permission-rows)),
 * 머리 줄은 아래로 내려도 화면 위에 붙어 있다(원장 2026-10-06 *"스크롤 내렸을때 헤더가 고정되서 아래쪽에서도 누구 권한인지 볼 수 있게"*).
 *
 * 🔴 머리 줄을 **표 밖에 따로** 세운 이유 — 표는 좁은 창에서 가로로 넘쳐 가로 스크롤 상자 안에 있고, 그 상자 안의 칸은
 *    페이지 세로 스크롤에 붙을 수 없다(붙는 기준이 그 상자가 된다). 그래서 머리 줄만 상자 밖에 두어 페이지에 붙이고,
 *    가로 위치는 본문 상자의 스크롤을 따라 맞춘다. 두 표는 같은 칸 폭 규칙(`table-fixed` + 같은 `colgroup`)을 쓴다.
 * ⚠️ 머리 줄은 보이기만 하는 줄이라 보조 기술에는 감춘다 — 대신 칸마다 "메뉴 · 역할: 값"을 이름으로 단다.
 * ⚠️ 붙는 자리는 화면 맨 위가 아니라 **본문 영역의 위 여백만큼 아래**다(셸마다 8~20px). 그 틈으로 아래 줄이 비치지 않게
 *    머리 줄 위쪽을 카드 색으로 가린다(`HEAD_COVER` — 20px). 그래서 표 위에는 늘 20px보다 넓은 빈 자리를 둔다(가림이 위 글자를
 *    덮지 않게 — 아래 `pt-3` + 호출부의 간격 = 24px 이상). 위 테두리도 표 상자가 아니라 머리 줄이 직접 그린다(가림에 덮이지 않게).
 */
const TABLE = "w-full table-fixed border-collapse text-xs";
const LABEL_WIDTH = "17rem";
/** 역할 칸 하나의 최소 폭 — 설정 창의 최소 폭(960px)에서 가로 스크롤이 생기지 않는 값이다. */
const ROLE_MIN_WIDTH = "4rem";
const MIN_WIDTH = `calc(${LABEL_WIDTH} + ${SYSTEM_ROLES.length} * ${ROLE_MIN_WIDTH})`;
/** 붙은 머리 줄 위의 틈을 가리는 띠 — 표 상자의 좌우 선까지 덮도록 1px씩 넓다. */
const HEAD_COVER =
  "before:pointer-events-none before:absolute before:-inset-x-px before:bottom-full before:h-5 before:bg-card before:content-['']";
/** 가로로 밀어도 남는 메뉴 칸의 오른쪽 선 — 붙는 칸은 테두리가 따라오지 않는다([[#71]]). */
const EDGE = "before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-line before:content-['']";

function Columns() {
  return (
    <colgroup>
      <col style={{ width: LABEL_WIDTH }} />
      {SYSTEM_ROLES.map((role) => <col key={role} />)}
    </colgroup>
  );
}

/** 탭 하나가 곧 권한 하나인 묶음(대시보드 · 회의록 · 수납관리 …) — 탭 줄과 권한 줄을 따로 세우면 같은 이름이 두 번 선다. */
function isTabRow(group: PermissionRowGroup): boolean {
  const own = group.rows.filter((row) => !row.inner);
  return own.length === 1 && own[0]!.label === group.label;
}

export function RoleMatrixTable({ groups, matrix, savedMatrix, onCycle }: {
  groups: readonly PermissionRowGroup[];
  matrix: AccessMatrix;
  /** 마지막으로 저장된 표 — 저장 전에 바꾼 칸을 표시한다. */
  savedMatrix: AccessMatrix;
  onCycle: (menu: MenuKey, role: SystemRole) => void;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 본문을 가로로 밀면 머리 줄도 같은 만큼 민다(스크롤 이벤트는 위로 번지지 않아 잡는 단계에서 듣는다).
  useEffect(() => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;
    const sync = (event: Event) => {
      if (event.target instanceof HTMLElement) head.scrollLeft = event.target.scrollLeft;
    };
    body.addEventListener("scroll", sync, { capture: true, passive: true });
    return () => body.removeEventListener("scroll", sync, { capture: true });
  }, []);

  /** `top` = 표의 맨 첫 줄 — 윗선이 머리 줄의 아랫선과 겹치므로 그리지 않는다. */
  const row = (item: PermissionRow, group: PermissionRowGroup, tab: boolean, top: boolean) => (
    <tr key={item.menu} className={top ? undefined : "border-border border-t"}>
      <td className={`bg-card sticky left-0 z-10 py-1.5 pr-3 ${tab ? "pl-3" : item.inner ? "pl-9" : "pl-6"} ${EDGE}`}>
        <span className="flex min-w-0 items-baseline gap-1.5">
          {item.inner ? <span aria-hidden className="text-text-faint">└</span> : null}
          <span className={`truncate ${tab ? "font-bold" : "font-medium"}`} title={item.label}>{item.label}</span>
          {item.hiddenInMenu || (tab && group.hiddenInMenu) ? <span className="text-text-dim shrink-0">관리자뷰에서 감춤</span> : null}
        </span>
        {item.covers.length > 0 ? (
          // 메뉴 구성에서 이름을 바꾼 화면의 바뀐 이름(그 밖엔 비어 있다 — 줄은 탭 이름 한 줄 · 원장 2026-11-05). 자르지 않고 접어 적는다.
          <span className="text-text-dim block leading-snug">{item.covers.join(" · ")}</span>
        ) : null}
      </td>
      {SYSTEM_ROLES.map((role) => {
        const access = matrix[item.menu][role];
        const saved = savedMatrix[item.menu][role];
        const locked = isCellLocked(item.menu, role);
        const changed = access !== saved;
        return (
          <td key={role} className="px-1.5 py-1.5 text-center">
            <button
              type="button"
              disabled={locked}
              onClick={() => onCycle(item.menu, role)}
              aria-label={`${item.label} · ${ROLE_LABEL[role]}: ${ACCESS_LABEL[access]}`}
              title={locked ? "고정" : changed ? `${ACCESS_LABEL[saved]} → ${ACCESS_LABEL[access]} · 저장 전 변경` : "클릭하여 변경"}
              className={`w-full rounded px-1.5 py-1 text-xs font-medium transition ${ACCESS_CLS[access]} ${changed ? "ring-amber ring-2" : ""} ${
                locked ? "cursor-default opacity-40" : "hover:ring-primary/40 hover:ring-1"
              }`}
            >
              {ACCESS_LABEL[access]}
            </button>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="pt-3">
    <div className="border-border rounded-md border-x border-b">
      <div aria-hidden className={`sticky top-0 z-20 ${HEAD_COVER}`}>
      {/* 좌우 선까지 머리 줄이 직접 그린다(-mx-px) — 표 상자의 선과 겹쳐 둥근 모서리가 끊기지 않는다. 안쪽 폭은 본문 표와 같다. */}
      <div ref={headRef} className="bg-bg-soft border-border -mx-px overflow-hidden rounded-t-md border-x border-t border-b">
        <table className={TABLE} style={{ minWidth: MIN_WIDTH }}>
          <Columns />
          <thead>
            <tr>
              <th className={`bg-bg-soft sticky left-0 z-10 px-3 py-2 text-left font-bold whitespace-nowrap ${EDGE}`}>메뉴</th>
              {SYSTEM_ROLES.map((role) => (
                <th key={role} className="px-2 py-2 text-center font-bold whitespace-nowrap">{ROLE_LABEL[role]}</th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      </div>
      <div ref={bodyRef}>
        <DragScrollArea className="rounded-b-md">
          <table className={TABLE} style={{ minWidth: MIN_WIDTH }}>
            <Columns />
            {groups.map((group, index) => {
              const tab = isTabRow(group);
              return (
                <tbody key={group.id}>
                  {tab ? null : (
                    <tr className={index === 0 ? undefined : "border-border border-t"}>
                      <th scope="rowgroup" colSpan={SYSTEM_ROLES.length + 1} className="bg-bg-soft px-3 py-1.5 text-left">
                        <span className="sticky left-3 inline-block font-bold">{group.label}</span>
                        {group.hiddenInMenu ? <span className="text-text-dim ml-2 font-medium">관리자뷰에서 감춤</span> : null}
                      </th>
                    </tr>
                  )}
                  {group.rows.map((item, at) => row(item, group, tab && !item.inner, index === 0 && tab && at === 0))}
                </tbody>
              );
            })}
          </table>
        </DragScrollArea>
      </div>
    </div>
    </div>
  );
}
