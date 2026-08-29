import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
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

export async function applyScheduledGroupPlan(
  supabase: Admin,
  tenantId: string,
  plan: ScheduledGroupPlan,
): Promise<ApplyScheduledGroupsResult> {
  const { data: row, error } = await supabase
    .from("tenant_settings")
    .select("data")
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

  // ⚠️ 읽고-고쳐-쓰기다(jsonb 통째 교체) — `saveOwnerSection`도 같은 모양이다. 00:30 cron이라 사람이
  //    동시에 저장할 창이 사실상 없고, 그래도 어긋나면 `shouldApplyGroups`가 다음 날 막는다.
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
  const nextData = {
    ...(data ?? {}),
    operations: { ...((data as { operations?: object }).operations ?? {}), subjects: nextSubjects },
  };

  const { error: writeErr } = await supabase
    .from("tenant_settings")
    .update({ data: nextData })
    .eq("tenant_id", tenantId);
  if (writeErr) return { status: "error", reason: "학원 설정을 저장하지 못했습니다" };
  return { status: "applied", groups: plan.groups.length };
}
