/**
 * **통합뷰 그룹 배치 예약이 실제로 배선돼 있는가** — 구조 가드(원장 2026-08-29 *"그룹설정까지 예약"*).
 *
 * 순수 규칙(`scheduled-groups.test.ts`)이 아무리 맞아도, cron이 그 값을 안 읽거나 취소가 안 걸리면
 * "예약했는데 아무 일도 안 일어남"이 된다. 여기서 그 연결선을 잠근다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const cron = strip(read("src", "app", "api", "cron", "apply-due-class-updates", "route.ts"));
const applier = strip(read("src", "features", "owner", "server", "scheduled-groups.ts"));
const due = strip(read("src", "features", "timetable", "due-class-updates.ts"));
const script = strip(read("scripts", "_english_sync", "sync-integration-groups.mts"));

describe("cron이 그룹 예약을 읽고 적용한다", () => {
  it("스냅샷 payload에서 그룹 예약을 함께 조회한다", () => {
    expect(cron).toContain("groups:payload->apply->integrationGroups");
  });

  it("🔴 방어적 파서를 거친다 — 옛 스냅샷은 이 키가 없어 null이 온다", () => {
    expect(cron).toMatch(/readScheduledGroupPlan\(r\.groups\)/);
  });

  it("owner 단일 진입점으로 쓴다(tenant_settings 직접 UPDATE 금지)", () => {
    expect(cron).toMatch(/applyScheduledGroupPlan\(supabase, tenantId, snap\.groups\)/);
    expect(cron).not.toMatch(/from\("tenant_settings"\)/);
  });

  it("🔴 그룹 적용이 실패해도 cron이 죽지 않는다 — 담임·이름 재생 표식이 안 남으면 다음 날 통째로 다시 돈다", () => {
    expect(cron).toMatch(/try \{[\s\S]{0,1600}applyScheduledGroupPlan[\s\S]{0,2000}\} catch/);
  });

  it("적용하면 학원 설정 캐시를 비운다(창마다 캐시된 설정을 읽는다 · B6)", () => {
    expect(cron).toMatch(/revalidateTag\(tenantSettingsTag\(tenantId\), "max"\)/);
  });

  it("적용을 감사로그로 남긴다(누가·언제 배치가 바뀌었는지 남는 유일한 자리)", () => {
    expect(cron).toMatch(/action: "owner_integration_groups_update"/);
  });

  it("표식 로그에 결과를 싣는다(건너뛴 이유를 나중에 읽을 수 있어야 한다)", () => {
    expect(cron).toMatch(/groupResult \? \{ groups: groupResult \}/);
  });
});

describe("할 일 판정에 그룹이 든다", () => {
  it("🔴 담임·이름 없이 그룹만 예약된 스냅샷도 재생 대상이다", () => {
    expect(due).toMatch(/r\.updates\.length > 0 \|\| r\.groups != null/);
  });
});

describe("적용기(owner)가 지켜야 할 것", () => {
  it("사람이 손댄 배치를 덮지 않는다", () => {
    expect(applier).toMatch(/shouldApplyGroups\(plan, current\)/);
  });

  it("🔴 admin 클라이언트라 읽기·쓰기 모두 tenant_id로 좁힌다(RLS 우회)", () => {
    const eqs = applier.match(/\.eq\("tenant_id", tenantId\)/g) ?? [];
    expect(eqs.length).toBeGreaterThanOrEqual(2);
  });

  it("설정에 없는 과목을 만들지 않는다(raw 키가 화면 선택지로 샌다)", () => {
    expect(applier).toMatch(/if \(idx < 0\) return \{ status: "no-subject"/);
  });

  it("다른 과목·다른 섹션을 보존한다(subjects 통째 교체 금지)", () => {
    expect(applier).toMatch(/subjects\.map\(\(s, i\) =>/);
    expect(applier).toMatch(/\.\.\.\(data \?\? \{\}\)/);
  });
});

describe("예약을 싣는 스크립트", () => {
  it("배치 스냅샷의 apply 가지에만 쓴다 — payload.before는 불가침", () => {
    expect(script).toContain("'{apply,integrationGroups}'");
    expect(script).not.toMatch(/\{before[,}]/);
  });

  it("🔴 되돌려진 스냅샷엔 싣지 않는다(이미 취소된 예약은 영영 안 돈다)", () => {
    expect(script).toMatch(/restored_at is not null/);
  });

  it("미래 날짜만 예약한다", () => {
    expect(script).toMatch(/SCHEDULE <= today/);
  });

  it("예약 시점 배치를 from으로 함께 싣는다(사람이 손댔는지 판별 기준)", () => {
    expect(script).toMatch(/from: curGroups/);
  });
});
