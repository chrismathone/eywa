"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { saveRuleBoxCollapsed } from "@/features/teacher-portfolio/server/view-prefs-actions";

/**
 * '점수 기준' 상자 접힘 — 계정 귀속(`ui_prefs.portfolio.ruleCollapsed`). 한 번 접으면 모든 탭·상세 창의 상자가 같이 접힌다.
 * 바꾸는 순간 저장한다([[#90]]). 저장이 실패해도 화면은 바꾼 대로 둔다(다음에 열면 저장된 값으로 돌아온다 — 보기 취향이라 막지 않는다).
 */
type RuleBoxPref = { collapsed: boolean; toggle: () => void };
const Ctx = createContext<RuleBoxPref | null>(null);

export function RuleBoxPrefProvider({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    void saveRuleBoxCollapsed(next).catch(() => undefined);
  };
  return <Ctx.Provider value={{ collapsed, toggle }}>{children}</Ctx.Provider>;
}

/** 프로바이더 밖(시험용 화면 등)이면 저장 없이 이 자리에서만 접는다. */
export function useRuleBoxPref(): RuleBoxPref {
  const ctx = useContext(Ctx);
  const [local, setLocal] = useState(false);
  return ctx ?? { collapsed: local, toggle: () => setLocal((v) => !v) };
}
