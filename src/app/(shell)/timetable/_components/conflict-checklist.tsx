"use client";

import { AlertTriangle, Check } from "@/components/icons/eywa-icon-compat";
import {
  blocksApply,
  conflictChecklist,
  describeConflict,
  type ScheduleConflict,
} from "@/features/timetable/import/structure/conflicts";

/**
 * 적용 전 **충돌 확인 체크리스트** (원장 2026-08-28: *"체크리스트가 만들어지고, 체크리스트 해제시에만
 * 적용가능하게"* + *"합반의 경우는 경고만 띄우고 적용은 가능해야함"*).
 *
 * 세 묶음이 서로 다른 무게를 갖는다:
 *  ① **확인 필요** — 이번 변경이 만든/건드린 물리적 불가능(한 방에 다른 강사 · 한 강사가 두 방 · 한 반이
 *     두 줄). 하나하나 체크해야 적용 버튼이 열린다.
 *  ② **합반으로 보임** — 같은 강사·같은 방. 실제로 합반이면 정상이라 **막지 않는다**(경고만).
 *  ③ **원래 있던 충돌** — 이번 변경이 손대지 않은 것. 알려는 주되 확인을 요구하지 않는다(매번 같은 걸
 *     체크시키면 체크가 의식이 되고 ①이 묻힌다).
 *
 * ⚠️ 화면에서 버튼을 잠그는 것은 게이트가 아니다 — 서버가 재계산한 ① 목록과 체크한 키가 정확히 같아야
 *    적용된다(`applyStructureImport`). 이 컴포넌트는 그 게이트의 **입력**일 뿐이다([[#77]]).
 */
export function ConflictChecklist({
  conflicts,
  checked,
  onToggle,
  disabled = false,
}: {
  conflicts: readonly ScheduleConflict[];
  /** 확인 완료로 체크된 키. */
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  if (conflicts.length === 0) return null;
  const must = conflictChecklist(conflicts);
  const mustKeys = new Set(must.map((c) => c.key));
  const merged = conflicts.filter((c) => !blocksApply(c.kind));
  const old = conflicts.filter((c) => blocksApply(c.kind) && !mustKeys.has(c.key));
  const done = must.filter((c) => checked.has(c.key)).length;

  return (
    <section className="space-y-2">
      {must.length > 0 ? (
        <div className="border-danger/40 bg-danger-soft rounded-sm border p-2 text-[11px]">
          <p className="text-danger mb-1.5 flex items-center gap-1 font-bold">
            <AlertTriangle className="size-3" aria-hidden="true" />
            적용 전 확인 필요 <span className="num">{done}/{must.length}</span>
          </p>
          <ul className="max-h-40 space-y-1 overflow-auto">
            {must.map((c) => {
              const on = checked.has(c.key);
              return (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-start gap-1.5">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => onToggle(c.key)}
                      className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-current disabled:cursor-default"
                    />
                    <span className={on ? "text-text-faint line-through" : "text-foreground"}>
                      {describeConflict(c)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-text-dim mt-1.5">
            {done === must.length
              ? "확인이 끝났습니다 — 적용할 수 있습니다."
              : "모두 확인해야 적용할 수 있습니다. 잘못된 배치라면 시트를 고쳐 다시 불러오세요."}
          </p>
        </div>
      ) : null}

      {merged.length > 0 ? (
        <div className="bg-amber-soft text-amber rounded-sm p-2 text-[11px]">
          <p className="mb-1 flex items-center gap-1 font-bold">
            <Check className="size-3" aria-hidden="true" /> 합반으로 보임 <span className="num">{merged.length}</span>건 —
            확인만 하세요(적용 가능)
          </p>
          <div className="max-h-20 space-y-0.5 overflow-auto">
            {merged.map((c) => (
              <p key={c.key}>· {describeConflict(c)}</p>
            ))}
          </div>
        </div>
      ) : null}

      {old.length > 0 ? (
        <div className="bg-bg-soft text-text-dim rounded-sm p-2 text-[11px]">
          <p className="mb-1 font-bold">
            원래 있던 충돌 <span className="num">{old.length}</span>건 — 이번 변경과 무관합니다
          </p>
          <div className="max-h-20 space-y-0.5 overflow-auto">
            {old.map((c) => (
              <p key={c.key}>· {describeConflict(c)}</p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
