import "server-only";
import { getNewcomers } from "@/features/newcomers/server/queries";
import { readsAllNewcomers } from "@/features/newcomers/server/scope";
import { ONBOARDING_ITEMS, daysLeftOf, dueDateOf, newcomerWindowStart, statusOf, type OnboardingItemStatus } from "@/features/newcomers/onboarding-items";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { ExploreCareCheck, ExploreCareChecks } from "../model";
import { settle } from "./shared";

/**
 * 약속·할 일 조각의 '신규생 90일 점검' — 신규생 관리 화면과 **같은 조회·같은 판정**(`getNewcomers` · `statusOf`)에서 이 원생 줄만 뽑는다
 * (원장 2026-11-05 시안 *"90일 점검 = 기존 체크리스트 이름"*). 과목이 여럿이면 과목 줄마다 판정해 가장 급한 상태를 보인다
 * (접은 체크 + 이른 첫 수업일로 판정하면 늦게 시작한 과목의 콜이 기한 전에 '지연'이 된다 — onboarding-items 주석).
 * 🔴 담당자는 저장된 값이 없어 싣지 않는다(지어내지 않는다).
 */
const SEVERITY: Record<OnboardingItemStatus, number> = { overdue: 5, due: 4, upcoming: 3, pending: 2, waived: 1, done: 0 };
const md = (ymd: string) => `${ymd.slice(5, 7)}.${ymd.slice(8, 10)}`;

export async function loadCareChecks(studentId: string, today: string): Promise<ExploreCareChecks> {
  // 신규생 관리가 꺼진 지점이면 점검 칸 자체가 없다(권한 없음 문장도 내지 않는다 — 기능 스위치 규약).
  if (!isModuleEnabled((await getTenantSettings()).modules.disabled, "newcomers")) return { state: "off", enrolledOn: null, items: [] };
  // 🔴 지점 전체로 읽는 계정만('전체' · '읽기') — 이 점검은 그 원생의 **모든 과목 줄**을 접어 보인다. 담당 범위(강사 '담당')는 신규생 관리 화면에서
  //    자기가 담임인 과목 줄만 보므로 여기서 열면 다른 과목의 점검 상태까지 보인다(판정 한 곳 = newcomers/server/scope.ts · 2026-11-11).
  if (!(await readsAllNewcomers())) return { state: "denied", enrolledOn: null, items: [] };
  // 신규생 관리 대상 = 등록일이 창(90일) 안인 원생(`loadNewcomers`와 같은 경계) — 창 밖이면 지점 전체 신규생 조회를 건너뛴다(전환마다 읽던 비용).
  const self = await (await createClient()).from("students").select("enrolled_at").eq("id", studentId).maybeSingle();
  const enrolledAt = self.data?.enrolled_at ? String(self.data.enrolled_at).slice(0, 10) : null;
  if (!self.error && (!enrolledAt || enrolledAt < newcomerWindowStart(today))) return { state: "notNewcomer", enrolledOn: enrolledAt, items: [] };
  const view = await settle("explore.care.newcomers", getNewcomers());
  if (!view.ok) return { state: "error", enrolledOn: null, items: [] };
  const v = view.value;
  if (!v.checksAvailable) return { state: "unavailable", enrolledOn: null, items: [] };
  const subjectRows = v.subjectRows.filter((r) => r.studentId === studentId);
  const folded = v.rows.find((r) => r.studentId === studentId);
  if (!folded || subjectRows.length === 0) return { state: "notNewcomer", enrolledOn: null, items: [] };
  const items: ExploreCareCheck[] = [];
  for (const item of ONBOARDING_ITEMS) {
    // 과목 줄마다 판정 → 가장 급한 상태(모두 완료여야 완료).
    let worst: { status: OnboardingItemStatus; due: string | null; doneOn: string | null; left: number | null } | null = null;
    for (const row of subjectRows) {
      const anchors = { enrolledOn: row.enrolledOn, firstClassOn: row.firstClassOn };
      const doneOn = row.checks[item.key] ?? null;
      const status = statusOf(item, anchors, doneOn, today);
      if (!worst || SEVERITY[status] > SEVERITY[worst.status]) worst = { status, due: dueDateOf(item, anchors), doneOn, left: daysLeftOf(item, anchors, today) };
    }
    if (!worst) continue;
    // '필요시' 항목은 했을 때만 보인다(지연·완료율에서 빠지는 항목 — 신규생 관리 화면과 같은 규칙).
    if (item.optional && worst.status !== "done") continue;
    const when =
      worst.status === "done" ? (worst.doneOn ? md(worst.doneOn) : "완료")
      : worst.status === "pending" ? "첫 수업일 미정"
      : worst.status === "waived" ? "기능 시작 전 기한"
      : !worst.due ? "—"
      : worst.status === "overdue" ? `${md(worst.due)} · 지남`
      : worst.left === 0 ? `${md(worst.due)} · 오늘`
      : worst.status === "due" ? `${md(worst.due)} · ${worst.left}일 내`
      : md(worst.due);
    items.push({ key: item.key, label: item.label, status: worst.status, when });
  }
  return { state: "ready", enrolledOn: folded.enrolledOn, items };
}

/** 조각 안 요약 — '약속 1 · 점검 4/5'(약속 수는 약속·인계가 연결됐을 때만). */
export function careSummary(checks: ExploreCareChecks, openCommitments: number | null): string {
  const parts: string[] = [];
  if (openCommitments !== null) parts.push(`약속 ${openCommitments}`);
  if (checks.state === "ready" && checks.items.length > 0) {
    const required = checks.items.filter((i) => i.status !== "waived");
    parts.push(`점검 ${required.filter((i) => i.status === "done").length}/${required.length}`);
  }
  return parts.join(" · ") || (checks.state === "notNewcomer" || checks.state === "off" ? "할 일 없음" : "연결 전");
}
