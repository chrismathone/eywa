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
const pages = [
  ["시간표", strip(read("src", "app", "(shell)", "timetable", "page.tsx"))],
  ["시간표(dev)", strip(read("src", "app", "(shell)", "timetable-dev", "page.tsx"))],
] as const;

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

describe("미래 주 화면이 그 주에 쓸 줄로 그린다", () => {
  for (const [label, page] of pages) {
    it(`${label}: 예약 배치를 읽어 통합뷰 그룹에 갈아끼운다`, () => {
      expect(page).toMatch(/pickScheduledGroupsForWeek\(\s*await getScheduledGroupPlans\(\)/);
      expect(page).toMatch(/resolveIntegrationGroups\(/);
    });

    it(`${label}: 🔴 배치 편집기엔 미래 배치를 넣지 않는다 — 저장 한 번에 오늘부터 굳는다`, () => {
      // 편집기는 반드시 저장된 값(subjectRow)을 그대로 읽어야 한다.
      expect(page).toMatch(/initialGroups=\{\(subjectRow\?\.integrationGroups \?\? \[\]\)/);
      // 갈아끼운 값은 읽기 뷰가 쓰는 customGroups 한 곳에만 들어간다.
      expect(page).not.toMatch(/initialGroups=\{[^}]*scheduledGroups/);
    });

    it(`${label}: 지나간 주는 조회하지 않는다(왕복 0)`, () => {
      expect(page).toMatch(/weekSundayOf\([A-Za-z]+\) >= today/);
    });
  }
});

describe("🔴 엑셀·시트는 지금 배치 그대로 — 화면과 짝이 맞아야 한다", () => {
  // 화면은 미래 주에 **미래 이름 + 미래 줄**을 함께 쓰고, 내보내기는 **지금 이름 + 지금 줄**을 함께 쓴다.
  // 한쪽만 미래로 가면 "9월 이름이 8월 줄에" 또는 그 반대가 되어 받는 사람이 무엇을 보는지 알 수 없다.
  const excel = strip(read("src", "features", "exports", "english-timetable", "build-buffer.ts"));

  it("엑셀 빌더는 예약 배치를 쓰지 않는다", () => {
    expect(excel).toContain("resolveIntegrationGroups(subjectRow)");
    expect(excel).not.toContain("pickScheduledGroupsForWeek");
    expect(excel).not.toContain("futureNames");
  });
});

