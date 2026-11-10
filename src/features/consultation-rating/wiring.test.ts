import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigration } from "@/lib/db/migrations-corpus.mjs";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

/**
 * 원생상담 평점 배선 가드 — 이 기능은 '저장은 되는데 아무도 안 읽는다' · '꺼진 지점에 새어 나간다' · '권한 없는 사람에게 점수가 내려간다'가 한 곳만 빠져도 조용히 깨진다.
 * 표·정책·스위치·cron·화면 게이트가 서로 맞물려 있는지 글자로 잠근다(수업보고서 평점과 같은 구조).
 */
describe("원생상담 평점 배선", () => {
  const sql = readMigration("s2_0044_consultation_ratings.sql");

  it("SQL: 두 표 모두 RLS를 켜고 정책을 만들지 않으며 anon·authenticated 권한을 거둔다(의도적 정책 0개 — #92)", () => {
    for (const table of ["student_consultation_ratings", "student_consultation_rating_queue"]) {
      expect(sql, table).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
      expect(sql, table).toMatch(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
      expect(sql, table).toMatch(new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role`));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/points smallint not null check \(points between 1 and 5\)/); // 처리 실패를 0점·빈 점수로 저장하는 길이 없다
  });

  it("cron이 vercel.json에 등록돼 있고 라우트는 CRON_SECRET이 없거나 틀리면 401이다", () => {
    expect(JSON.parse(read("vercel.json")).crons.map((c: { path: string }) => c.path)).toContain("/api/cron/consultation-ratings");
    const route = read("src/app/api/cron/consultation-ratings/route.ts");
    expect(route).toMatch(/CRON_SECRET/);
    expect(route).toMatch(/status: 401/);
  });

  it("지점 스위치 consult_rating이 라이선스 규칙과 운영 콘솔 목록에 있고, 정기 처리는 그 스위치가 꺼진 지점에서 바로 돌아선다", () => {
    expect(read("src/lib/license/rule.ts")).toContain('"consult_rating"');
    expect(read("src/features/super-admin/labels.ts")).toMatch(/key: "consult_rating"[^}]*defaultOn: false/);
    const cycle = read("src/features/consultation-rating/server/cycle.ts");
    expect(cycle.indexOf("consultationRatingEnabled")).toBeGreaterThan(-1);
    expect(cycle.indexOf("consultationRatingEnabled")).toBeLessThan(cycle.indexOf("enqueueConsultations"));
  });

  it("화면 게이트: 목록·상세 모두 지점 스위치 AND 상담 쓰기 권한이 있을 때만 평점을 읽는다(읽기 권한만으로는 내려보내지 않는다 — #77)", () => {
    // 목록은 쪽의 상담 id를 안 뒤에 읽고(스위치 AND 쓰기 권한), 상세는 상담 조회와 병렬로 읽되(스위치가 꺼진 지점은 읽지 않는다) 내보내기 전에 쓰기 권한을 본다.
    const list = read("src/app/(shell)/consultations/page.tsx");
    expect(list).toContain('isFeatureOptedIn(user.tenantId, "consult_rating")');
    expect(list).toMatch(/ratingSwitch && canWrite \? await loadConsultationRatings/);
    const detail = read("src/app/(shell)/consultations/[id]/page.tsx");
    expect(detail).toMatch(/isFeatureOptedIn\(user\.tenantId, "consult_rating"\)\.then\(\(on\) => \(on \? loadConsultationRatings/);
    expect(detail).toMatch(/ratings && canWrite \? \(ratings\.get\(item\.id\)/);
  });

  it("요청 한 벌: 배치와 즉시 호출이 같은 ratingRequest를 쓰고, 구독 CLI 백필 스크립트도 같은 것을 부른다", () => {
    expect(read("src/features/consultation-rating/server/batch.ts")).toContain("ratingRequest(tenantId, c)");
    expect(read("src/features/consultation-rating/server/rate-now.ts")).toContain("ratingRequest(tenantId, c)");
    expect(read("scripts/_oneoff/consult-rating/rate.ts")).toContain('ratingRequest("cs-local", c)');
    expect(read("src/features/consultation-rating/harness/request.ts")).toContain('keyName: "consultations"');
  });
});
