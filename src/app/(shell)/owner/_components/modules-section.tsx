"use client";

import { useState } from "react";
import { MODULES, MODULE_IDS, type ModuleId } from "@/lib/modules";
import type { ModulesSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { EmbedLink as Link } from "@/components/embed-link";

/**
 * 기능 켜기·끄기(모듈) — 원장 2026-09-22 방향 B(*"'침산'은 그대로 두고 … 새로 시작하는 지점만 일반화"*).
 * 새 학원은 첫 학원의 운영 방식에 묶인 기능을 끈 채 태어나고, 원장이 필요한 것만 여기서 켠다.
 *
 * 🔴 **권한이 아니라 "기능이 있나 없나"다** — 끄면 그 메뉴는 누구에게도 안 보이고(원장 override·개인 예외로도
 *    못 연다) 대시보드 카드·브리핑 신호도 빠진다. 켠 뒤 누가 쓰는지는 '역할·권한' 면이 정한다.
 * ⚠️ 데이터는 지우지 않는다 — 껐다 켜면 그대로 돌아온다.
 */
export function ModulesSection({ initial, readOnly = false }: { initial: ModulesSettings; readOnly?: boolean }) {
  const [disabled, setDisabled] = useState<Set<ModuleId>>(() => new Set(initial.disabled));
  const toggle = (id: ModuleId) =>
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // 저장은 끈 것만, 정의 순서대로(비교·감사로그가 흔들리지 않게).
  const payload: ModulesSettings = {
    disabled: MODULE_IDS.filter((id) => disabled.has(id)),
    known: [...MODULE_IDS],
  };
  const onCount = MODULE_IDS.length - payload.disabled.length;

  return (
    <SectionForm section="modules" payload={payload} readOnly={readOnly}>
      <SettingsCard
        title="기능 켜기·끄기"
        description={`${MODULE_IDS.length}개 중 ${onCount}개 켜짐 · 끄면 그 메뉴와 대시보드 카드가 이 학원에서 사라집니다(데이터는 지우지 않습니다). 켠 기능을 누가 쓰는지는 '역할·권한'에서 정합니다.`}
        span2
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {MODULE_IDS.map((id) => {
            const m = MODULES[id];
            if (id === "makeups") return (
              <li key={id} className="border-line rounded-lg border px-3 py-2">
                {/* 보강 운영은 제 면이다(2026-10-06 — 전에는 운영 체계 면 아래에 있었다). */}
                <Link href="/owner?tab=makeups" className="text-primary underline">보강관리 운영 모드 설정</Link>
                <p className="text-sm">새 접수 중지·기존 업무 처리·종료는 운영 모드에서 변경합니다.</p>
              </li>
            );
            const on = !disabled.has(id);
            return (
              <li key={id} className="border-line flex items-start gap-2 rounded-lg border px-3 py-2">
                <input
                  id={`module-${id}`}
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(id)}
                  className="border-line accent-primary mt-0.5 size-4 shrink-0 rounded"
                />
                <label htmlFor={`module-${id}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className={`block text-sm font-bold ${on ? "text-foreground" : "text-text-faint"}`}>
                    {m.label}
                  </span>
                  <span className="text-text-dim block text-xs">{m.description}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </SectionForm>
  );
}
