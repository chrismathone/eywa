import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 원생상담 **읽기 권한** 화면이 쓰기 UI를 그리지 않는지 잠근다(원장 2026-11-05 — 회의록이 '읽기'인데
 * '+ 새 회의록'이 떠서 양식을 다 쓴 뒤에야 "권한이 없습니다"가 떴다. 원생상담도 같은 모양이었다).
 * 판정은 서버 게이트와 같은 `canWriteTenant(…,"consultations")`를 page가 계산해 내린다(src/lib/write-lock.ts).
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const SHELL = "src/app/(shell)/consultations";
const GATE = 'canWriteTenant(user.systemRole, "consultations")';
const VIEWER_GATE = 'canWriteTenant(viewer.systemRole, "consultations")';

describe("원생상담 읽기 권한 — 쓰기 UI", () => {
  it("목록의 '상담 추가'는 쓰기 판정으로만 그린다", () => {
    const src = read(`${SHELL}/page.tsx`);
    expect(src).toContain(GATE);
    expect(src).toContain("{canWrite ? <NewConsultationTrigger /> : null}");
  });

  it("상세의 수정·삭제·후속 완료·AI 분석은 같은 판정을 따른다", () => {
    const src = read(`${SHELL}/[id]/page.tsx`);
    expect(src).toContain(GATE);
    expect(src).toMatch(/\{canWrite \? \(\s*<div[^>]*>\s*<Button/);
    expect(src).toContain("readOnly={!canWrite}");
    expect(src).toContain("canAnalyze={canWrite}");
  });

  it("주소로 바로 여는 작성·수정 양식은 잠그고, 녹음 작성과 삭제는 그리지 않는다", () => {
    const create = read(`${SHELL}/new/page.tsx`);
    expect(create).toContain(VIEWER_GATE);
    expect(create).toMatch(/\{canWrite \? \(\s*<AudioConsultationForm/);
    expect(create).toContain("readOnly={!canWrite}");
    const edit = read(`${SHELL}/[id]/edit/page.tsx`);
    expect(edit).toContain(VIEWER_GATE);
    expect(edit).toMatch(/\{canWrite \? \(\s*<ConsultationDeleteButton/);
    expect(edit).toContain("readOnly={!canWrite}");
  });

  it("양식은 칸을 비활성 + 안내, 저장 단추·초안·'수정중' 표시를 끈다", () => {
    const form = read(`${SHELL}/_components/consultation-form.tsx`);
    expect(form).toContain("<fieldset disabled={readOnly}");
    expect(form).toContain('writeLockedPlaceholder("consultations")');
    expect(form).toContain('writeLockedNote("consultations")');
    expect(form).toContain("enabled: !readOnly");
    expect(form).toContain("scope: readOnly ? undefined : editScope");
    expect(form).toMatch(/\{readOnly \? null : \(\s*<FormActionBar>/);
  });

  it("공용 부품의 새 prop은 기본값이 종전 동작이다(원생 상세 상담 탭 호출이 그대로 산다)", () => {
    expect(read(`${SHELL}/_components/follow-up-toggle.tsx`)).toContain("readOnly = false");
    expect(read(`${SHELL}/_components/recording-panel.tsx`)).toContain("canAnalyze = true");
    expect(read(`${SHELL}/_components/consultation-form.tsx`)).toContain("readOnly = false");
  });
});
