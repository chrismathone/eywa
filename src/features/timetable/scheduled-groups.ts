/**
 * **통합뷰 그룹 배치(줄)의 예약 적용** 규칙 — 순수 함수(Vitest).
 *
 * 원장 2026-08-29: *"그룹설정까지 예약걸면 안되는거야? 시스템 새로 설계해서?"*
 *
 * 🔴 **왜 따로 설계했나 — 그룹 배치엔 시간 축이 없다.** 배치(`class_schedules`)는 `valid_from`으로,
 *    수강은 `start_date`로 그날 저절로 갈리지만, 그룹 배치는 `tenant_settings.data`의
 *    `operations.subjects[key].integrationGroups` **한 벌**뿐이다. 담임·반 이름과 똑같은 모양의 문제라
 *    똑같은 해법을 쓴다 — **스냅샷에 실어 두고 그날 cron이 재생한다**([`due-class-updates.ts`](./due-class-updates.ts)).
 *
 * 🔴 **저장 자리를 새로 파지 않고 배치 스냅샷 안에 넣는 이유**: 취소(×)가 날짜 단위로 스냅샷을 되돌리는데
 *    ([`scheduled-import.ts`](./scheduled-import.ts)), 그룹만 딴 곳에 있으면 "취소하면 아무 일도 없던
 *    것처럼"이 깨진다. 같은 스냅샷에 실으면 되돌린 스냅샷을 cron이 건너뛰므로(restored_at) **취소가
 *    곧 그룹 예약 취소**다 — 게다가 예약은 미래분만 취소되므로 그 시점엔 아직 아무것도 안 바뀌었다.
 *
 * ⚠️ 반은 **id로** 가리킨다(이름 아님) — 9/1엔 반 이름 17건이 함께 바뀌는데, 이름으로 저장했다면
 *    개명 순간 배치가 통째로 어긋난다.
 */

/** 한 줄(그룹). `tenant_settings`의 `integrationGroupSchema`와 같은 모양. */
export type ScheduledGroup = { id: string; title: string; classIds: string[] };

/** 스냅샷 payload의 `apply.integrationGroups`. */
export type ScheduledGroupPlan = {
  /** 과목 키(학원설정). 지금 소비처는 english 하나지만 축은 과목별이다. */
  subject: string;
  /** 그날 적용할 배치. */
  groups: ScheduledGroup[];
  /**
   * **예약 시점의 배치** — 그 사이 사람이 손댔는지 판별하는 기준.
   * 담임(`prevTeacherId`)·반 이름(`prevClassName`)과 같은 규약이다.
   */
  from: ScheduledGroup[];
  /** 어느 줄에도 없는 반을 '기타'로 내릴지. 미지정이면 현재 설정을 그대로 둔다. */
  showOthers?: boolean;
};

/**
 * 배치 비교용 **안정 서명**.
 *
 * ⚠️ 객체를 그대로 `JSON.stringify` 하면 **키 순서**에 걸린다 — 저장본은 jsonb라 Postgres가 키를
 *    재정렬해 돌려주므로 JS 리터럴 순서와 우연히 같지 않으면 "안 바뀐 배치"가 매번 바뀐 걸로 잡힌다.
 *    (같은 함정을 `saveIntegrationGroups`의 프리셋 도장이 이미 겪었다.) 배열로 눕혀 순서를 못박는다.
 * ⚠️ 줄 **순서**와 줄 **안 반 순서**는 화면에 그대로 보이므로 서명에 포함한다(정렬하지 않는다).
 */
export function groupLayoutSignature(groups: unknown): string {
  // jsonb에서 온 값이라 배열이 아닐 수 있다 — 배열이 아니면 "배치 없음"과 같게 본다(throw 금지).
  const list = Array.isArray(groups) ? (groups as ScheduledGroup[]) : [];
  return JSON.stringify(
    list
      // 🔴 제목 없는 줄은 **화면이 이미 버린다**(`integration-groups.ts`가 `title.trim()`으로 거른다).
      //    여기서도 같이 버려야 한다 — 한쪽만 거르면 `from`(파서를 거친 값)과 현재 배치(raw jsonb)의
      //    서명이 영원히 어긋나 예약이 조용히 안 돈다.
      .filter((g) => String(g?.title ?? "").trim() !== "")
      .map((g) => [
        String(g?.id ?? ""),
        String(g?.title ?? ""),
        Array.isArray(g?.classIds) ? [...g.classIds] : [],
      ]),
  );
}

/**
 * 지금 이 배치를 적용해도 되는가 — **현재 배치가 아직 예약 시점 그대로일 때만**.
 *
 * 🔴 담임·반 이름과 같은 규칙이다. 그 사이 원장이 줄을 손봤다면 그 판단이 최신이고, 예약이 그걸
 *    덮으면 사람이 한 일이 조용히 사라진다. 어긋나면 **건너뛰고 로그에 남긴다**(조용히 덮지 않는다).
 * ⚠️ 두 번 돌아도 안전하다 — 한 번 적용되면 현재 ≠ from이 되어 다음엔 false다.
 */
export function shouldApplyGroups(plan: Pick<ScheduledGroupPlan, "from">, current: unknown): boolean {
  return groupLayoutSignature(current) === groupLayoutSignature(plan.from);
}

/** 문자열 배열만 남긴다(jsonb라 무엇이 들어 있을지 모른다). */
function readIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
}

function readGroups(value: unknown): ScheduledGroup[] {
  if (!Array.isArray(value)) return [];
  const out: ScheduledGroup[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as { id?: unknown; title?: unknown; classIds?: unknown };
    const id = typeof g.id === "string" ? g.id : "";
    const title = typeof g.title === "string" ? g.title : "";
    if (!id || !title.trim()) continue; // 제목 없는 줄은 화면이 이미 버린다(빈 섹션 방지)
    out.push({ id, title, classIds: readIds(g.classIds) });
  }
  return out;
}

/**
 * 스냅샷 payload에서 그룹 예약을 **방어적으로** 읽는다.
 *
 * 🔴 `payload->apply->integrationGroups`는 옛 스냅샷엔 아예 없어 PostgREST가 `null`을 돌려준다
 *    ([[#95]] 계열 — 새 키를 있는 것처럼 다루면 전 스냅샷이 깨진다). 모양이 안 맞으면 **null**을 돌려
 *    호출부가 "이 스냅샷엔 그룹 예약이 없다"로 읽게 한다.
 * 🔴 줄이 하나도 없으면 null이다 — 빈 배치를 적용하면 통합뷰가 통째로 '기타' 한 줄이 된다.
 */
export function readScheduledGroupPlan(value: unknown): ScheduledGroupPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { subject?: unknown; groups?: unknown; from?: unknown; showOthers?: unknown };
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (!subject) return null;
  const groups = readGroups(raw.groups);
  if (groups.length === 0) return null;
  return {
    subject,
    groups,
    from: readGroups(raw.from),
    ...(typeof raw.showOthers === "boolean" ? { showOthers: raw.showOthers } : {}),
  };
}
