import { describe, expect, it } from "vitest";
import { readMigration } from "@/lib/db/migrations-corpus.mjs";

const sql = readMigration("s2_0028_student_care_commitments.sql");
const intake = readMigration("s2_0029_intake_care_and_sheet_evidence.sql");

describe("약속 저장 SQL 경계(s2_0028)", () => {
  it("관련 두 표와 함수는 브라우저 역할에 열리지 않는다", () => {
    for (const name of ["student_care_commitments", "student_care_events"]) {
      expect(sql).toContain(`alter table public.${name} enable row level security`);
      expect(sql).toContain(`revoke all on public.${name} from anon, authenticated`);
    }
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).not.toMatch(/create policy/i);
  });
  it("동일 테넌트·학생·버전 비교와 감사 이력이 하나의 함수 안에 있다", () => {
    expect(sql).toContain("where id=p_id and tenant_id=p_tenant and student_id=p_student and version=p_expected");
    expect(sql).toContain("insert into public.student_care_events");
    expect(sql).toContain("errcode='40001'");
    expect(sql).toContain("student_id=p_student for share");
    expect(sql).toContain("foreign key (tenant_id, commitment_id)");
  });
  it("한 트랜잭션으로 적용한다", () => {
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;$/m);
  });
});

describe("등록 전 약속·시트 증거 SQL(s2_0029)", () => {
  it("s2_0028 뒤에 적용하며 새 함수도 브라우저 역할에 열리지 않는다", () => {
    expect(intake).toContain("s2_0028 다음에 적용");
    expect(intake).not.toMatch(/create policy/i);
    expect(intake).toContain("revoke all on function public.save_student_care_v2(uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb) from public, anon, authenticated");
    expect(intake).toContain("revoke all on function public.link_intake_care_student() from public, anon, authenticated");
  });
  it("매일 쓰는 상담 표에 트리거를 거는 동안 잠금을 오래 기다리지 않는다", () => {
    expect(intake).toContain("set local lock_timeout = '3s'");
    expect(intake).toContain("after update of student_id on public.enrollment_consultations");
  });
  it("옛 저장 함수는 같은 검증 경로(v2)를 부른다", () => {
    expect(intake).toContain("select public.save_student_care_v2(p_tenant,p_student,null,p_id,p_actor,p_expected,p_kind,p_reason,p_document)");
  });
  it("시트 증거는 수강 기간 안 · 오늘까지 · 진도가 적힌 기록만", () => {
    expect(intake).toContain("e.start_date<=m.mark_date and (e.end_date is null or e.end_date>=m.mark_date)");
    expect(intake).toContain("r.revoked_at is null");
  });
});
