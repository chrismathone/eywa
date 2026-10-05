import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { nextSettingsStamp, settingsRevOf } from "../settings-stamp";
import {
  groupLayoutSignature,
  shouldApplyGroups,
  type ScheduledGroupPlan,
} from "@/features/timetable/scheduled-groups";

/**
 * 예약된 **통합뷰 그룹 배치**를 학원 설정에 반영한다 — cron 전용 단일 진입점.
 *
 * 🔴 **왜 여기(owner) 있나**: CLAUDE.md 규약 = *"기능 코드에서 `tenant_settings`를 직접 SELECT/UPDATE
 *    하지 말 것"*. 화면 저장은 `saveOwnerSection`(master 게이트 + Zod + 감사로그)을 타는데 cron엔
 *    **세션이 없어** 그 문을 못 쓴다. 그래서 문을 하나 더 내되 **owner 안에** 두고, 쓰는 범위를
 *    `operations.subjects[key].integrationGroups` 세 칸으로만 좁힌다.
 *
 * 🔴 **admin 클라이언트 = RLS 우회** → 읽기·쓰기 모두 `tenant_id` 명시 필터. 0080a 트리거는
 *    `auth.uid()`가 null이면(service_role) 통과시키므로 세션 없이도 쓸 수 있다.
 * ⚠️ 캐시 무효화는 **호출부(라우트)**가 한다 — `revalidateTag`는 Route Handler·Server Action에서만
 *    부를 수 있고, 이 모듈은 스크립트에서도 재사용될 수 있어야 한다. 못 비워도 `unstable_cache`의
 *    TTL 백스톱(300초)이 있어 00:30 cron 기준으로는 몇 분 안에 저절로 반영된다.
 */
export type ApplyScheduledGroupsResult = {
  status: "applied" | "skipped" | "no-settings" | "no-subject" | "error";
  /** 사람이 읽는 한 줄 — 로그·응답에 그대로 싣는다(원문 에러 노출 금지). */
  reason?: string;
  groups?: number;
};

type Admin = ReturnType<typeof createAdminClient>;

/** jsonb에서 과목 배열만 안전하게 꺼낸다(무엇이 들어 있을지 모른다). */
function subjectsOf(data: unknown): Record<string, unknown>[] | null {
  if (!data || typeof data !== "object") return null;
  const ops = (data as { operations?: unknown }).operations;
  if (!ops || typeof ops !== "object") return null;
  const subjects = (ops as { subjects?: unknown }).subjects;
  return Array.isArray(subjects) ? (subjects as Record<string, unknown>[]) : null;
}

/** 그사이 설정이 바뀌어 쓰기가 밀렸을 때 **같은 실행 안에서** 다시 읽어 판단하는 횟수. */
const MAX_ATTEMPTS = 3;

/**
 * 🔴 충돌하면 다음 날이 아니라 **지금** 다시 시도한다 — 호출부(cron 라우트)는 그룹 결과가 error여도 그 예약의
 *    완료 표식을 남기고, 다음 실행은 표식이 있는 예약을 통째로 건너뛴다(표식을 안 남기면 이미 끝난 반 이름·담임
 *    변경이 재생된다). 그래서 여기서 못 쓰면 그 예약의 그룹 반영은 자동으로 다시 오지 않는다.
 *    매번 새로 읽어 `shouldApplyGroups`를 다시 묻는다 — 그사이 사람이 그룹을 정했으면 덮지 않고 건너뛴다.
 */
export async function applyScheduledGroupPlan(
  supabase: Admin,
  tenantId: string,
  plan: ScheduledGroupPlan,
): Promise<ApplyScheduledGroupsResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await applyOnce(supabase, tenantId, plan);
    if (result !== "conflict") return result;
  }
  return { status: "error", reason: "설정이 동시에 바뀌어 그룹 배치를 반영하지 못했습니다" };
}

async function applyOnce(
  supabase: Admin,
  tenantId: string,
  plan: ScheduledGroupPlan,
): Promise<ApplyScheduledGroupsResult | "conflict"> {
  const { data: row, error } = await supabase
    .from("tenant_settings")
    .select("data, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { status: "error", reason: "학원 설정을 읽지 못했습니다" };
  if (!row) return { status: "no-settings", reason: "학원 설정 행이 없습니다" };

  const data = row.data as Record<string, unknown> | null;
  const subjects = subjectsOf(data);
  if (!subjects) return { status: "no-settings", reason: "학원 설정에 과목 목록이 없습니다" };

  const idx = subjects.findIndex((s) => s?.key === plan.subject);
  // 🔴 없는 과목을 만들지 않는다 — 설정에 없는 과목 키가 생기면 화면 선택지에 raw 키가 샌다.
  if (idx < 0) return { status: "no-subject", reason: "학원 설정에 없는 과목입니다" };

  // jsonb라 배열이 아닐 수도 있다 — 서명 함수가 방어하지만 의도를 여기서도 드러낸다.
  const current: unknown = subjects[idx]!.integrationGroups;
  if (!shouldApplyGroups(plan, current)) {
    return {
      status: "skipped",
      reason: "예약 뒤에 그룹 배치가 바뀌어 있어 건너뛰었습니다(사람이 정한 값을 덮지 않습니다)",
    };
  }
  // 이미 같은 배치면 쓸 이유가 없다(로그만 남는다).
  if (groupLayoutSignature(current) === groupLayoutSignature(plan.groups)) {
    return { status: "applied", groups: plan.groups.length, reason: "이미 같은 배치였습니다" };
  }

  // ⚠️ 읽고-고쳐-쓰기다(jsonb 통째 교체) — 그래서 **읽은 그대로일 때만** 쓴다(아래 `updated_at` 조건).
  //    읽은 뒤 화면 저장이 끼어들었으면 0행이 되고, 위 루프가 새로 읽어 다시 판단한다(그 저장을 덮지 않는다).
  const nextSubjects = subjects.map((s, i) =>
    i === idx
      ? {
          ...s,
          integrationGroups: plan.groups,
          integrationGroupsEnabled: true,
          ...(plan.showOthers === undefined ? {} : { integrationShowOthers: plan.showOthers }),
        }
      : s,
  );
  const storedOperations = (data as { operations?: Record<string, unknown> }).operations ?? {};
  const nextData = {
    ...(data ?? {}),
    // 운영 섹션을 다시 쓰므로 그 섹션의 저장 순번도 올린다 — 열려 있는 설정 폼이 이 반영보다 먼저 읽힌 값을 가려낸다(settings-stamp.ts).
    operations: { ...storedOperations, rev: settingsRevOf(storedOperations) + 1, subjects: nextSubjects },
  };

  // 🔴 `updated_at`도 함께 갱신한다 — 화면 저장(`saveOwnerSection`)이 같은 값으로 "그사이 바뀌었나"를 본다.
  //    갱신하지 않으면 화면이 이 변경을 못 보고 자기가 읽어 둔 문서로 덮는다.
  const { data: written, error: writeErr } = await supabase
    .from("tenant_settings")
    .update({ data: nextData, updated_at: nextSettingsStamp(row.updated_at) })
    .eq("tenant_id", tenantId)
    .eq("updated_at", row.updated_at)
    .select("tenant_id");
  if (writeErr) return { status: "error", reason: "학원 설정을 저장하지 못했습니다" };
  // 오류 없이 0행 = 읽은 뒤 누군가 먼저 저장했다.
  if (!written?.length) return "conflict";
  return { status: "applied", groups: plan.groups.length };
}
