"use client";

import { createContext, useContext } from "react";

/** 셀을 누르면 여는 '간이 페이지'(오버레이 안 iframe) — 원장 2026-11-09 *"누르면 왠만하면 전부 오버레이로 간이 페이지 띄워서 바로 업무 처리"*. */
export type DutyWork = { href: string; title: string };
export const DutyWorkContext = createContext<(work: DutyWork) => void>(() => undefined);
export const useOpenDutyWork = () => useContext(DutyWorkContext);
