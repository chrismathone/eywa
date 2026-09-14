"use client";

import { AlertTriangle, Check } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
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
 *
 * ── 변경이 0건일 때는 조용해진다(`changed=false`, 원장 2026-09-14 *"변경이 없는데 마치 오류인것처럼
 * 호도되어보임"*) ──
 * 충돌 검사는 **이번에 뭘 바꾸는가와 무관하게 목표 배치 전체**를 훑는다(`detectScheduleConflicts` 설계).
 * 그래서 "변경 없음"인데도 ②·③이 그대로 서고, 그중 ②는 amber라 의미색 캐논상 *"주의 · 내 차례"*로 읽힌다
 * — 적용할 게 0건이면 그 색 자체가 거짓 재촉이다. 그래서 ②·③을 **접고 무채색으로 내린다**.
 * 🔴 **감추지는 않는다** — 이 박스는 물리적 충돌(같은 방·다른 강사)을 보고하는 유일한 표면이라, 통째로
 *    치우면 "지금 시간표가 괜찮은지" 확인하러 연 사람에게 화면이 조용해진다. 접기는 정보를 남기고 소음만 뺀다.
 * ⚠️ ①은 이 분기를 타지 않는다(건드린 것이 있어야 `touched`가 서므로 변경 0건이면 애초에 비어 있다).
 */
export function ConflictChecklist({
  conflicts,
  checked,
  onToggle,
  disabled = false,
  changed,
}: {
  conflicts: readonly ScheduleConflict[];
  /** 확인 완료로 체크된 키. */
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
  /**
   * 이번 가져오기가 **배치를 바꾸는가**(구조 diff ≥ 1건).
   * 🔴 반이동을 합친 수가 아니라 **배치 변경 수**다 — 충돌은 오직 배치에서 나오므로, 합산으로 판정하면
   *    "배치 0건 + 반이동 3건"일 때 무관한 경고가 그대로 선다.
   */
  changed: boolean;
}) {
  if (conflicts.length === 0) return null;
  const must = conflictChecklist(conflicts);
  const mustKeys = new Set(must.map((c) => c.key));
  const merged = conflicts.filter((c) => !blocksApply(c.kind));
  const old = conflicts.filter((c) => blocksApply(c.kind) && !mustKeys.has(c.key));
  const done = must.filter((c) => checked.has(c.key)).length;
  /** 적용할 게 없으니 ②·③은 재촉이 아니라 참고 — 접고 무채색으로. */
  const quiet = !changed;
  const asideCount = merged.length + old.length;

  const mergedBlock =
    merged.length > 0 ? (
      <div className={quiet ? undefined : "bg-amber-soft text-amber rounded-sm p-2 text-xs"}>
        <p className="mb-1 flex items-center gap-1 font-bold">
          <Check className="size-3" aria-hidden="true" /> 합반으로 보임 <span className="num">{merged.length}</span>건
          {quiet ? null : " — 확인만 하세요(적용 가능)"}
        </p>
        <div className="max-h-20 space-y-0.5 overflow-auto">
          {merged.map((c) => (
            <p key={c.key}>· {describeConflict(c)}</p>
          ))}
        </div>
      </div>
    ) : null;

  const oldBlock =
    old.length > 0 ? (
      <div className={quiet ? undefined : "bg-bg-soft text-text-dim rounded-sm p-2 text-xs"}>
        <p className="mb-1 font-bold">
          원래 있던 충돌 <span className="num">{old.length}</span>건{quiet ? null : " — 이번 변경과 무관합니다"}
        </p>
        <div className="max-h-20 space-y-0.5 overflow-auto">
          {old.map((c) => (
            <p key={c.key}>· {describeConflict(c)}</p>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <section className="space-y-2">
      {must.length > 0 ? (
        <div className="border-danger/40 bg-danger-soft rounded-sm border p-2 text-xs">
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

      {asideCount === 0 ? null : quiet ? (
        <details className="group bg-bg-soft text-text-dim rounded-sm text-xs">
          {/* ⚠️ `flex-wrap` — 다이얼로그는 `w-full max-w-lg`라 폰에선 한 줄(≈348px)이 칸(≈315px)을 넘는다. */}
          <summary className="hover:text-foreground flex cursor-pointer list-none flex-wrap items-center gap-1.5 p-2 select-none [&::-webkit-details-marker]:hidden">
            <EyIcon
              name="chevronDown"
              size={14}
              className="text-text-faint shrink-0 -rotate-90 transition-transform group-open:rotate-0"
              aria-hidden="true"
            />
            <span>
              시간표 점검 <span className="num">{asideCount}</span>건 — 이번 변경과 무관
            </span>
            <span className="text-text-faint group-open:hidden">(펼치기)</span>
          </summary>
          <div className="space-y-1.5 px-2 pb-2">
            {mergedBlock}
            {oldBlock}
          </div>
        </details>
      ) : (
        <>
          {mergedBlock}
          {oldBlock}
        </>
      )}
    </section>
  );
}
