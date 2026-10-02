/** 숙제 영상 올리기 사이트(0330a) — 순수 규칙 + 공개 경로·배선 가드. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLast4, isSiteName, phoneEndsWith, siteLinkExpiresAt, siteLinkLastDay, siteNameKey, siteNameMatches } from "./site";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("뒷 4자리", () => {
  it("숫자 넷만", () => {
    expect(isLast4("0123")).toBe(true);
    for (const bad of ["123", "12345", "12a4", " 1234", 1234, null, undefined]) expect(isLast4(bad)).toBe(false);
  });
  it("전화번호는 숫자만 남겨 끝자리를 본다 — 하이픈·공백·괄호 무시 · 너무 짧은 번호는 아니다", () => {
    expect(phoneEndsWith("010-1234-5678", "5678")).toBe(true);
    expect(phoneEndsWith("010 1234 5678 ", "5678")).toBe(true);
    expect(phoneEndsWith("(053)123-5678", "5678")).toBe(true);
    expect(phoneEndsWith("010-1234-5679", "5678")).toBe(false);
    expect(phoneEndsWith("5678", "5678")).toBe(false);
    expect(phoneEndsWith(null, "5678")).toBe(false);
  });
});

describe("이름 — 번호와 함께 넣어야 한다(원장 2026-10-03)", () => {
  it("동명이인 구분 글자(한글 이름 뒤의 알파벳 한 글자·숫자)와 공백은 무시한다 — 안 쳐도 맞고 쳐도 맞는다", () => {
    expect(siteNameKey("김지유A")).toBe("김지유");
    expect(siteNameKey(" 김 지유 ")).toBe("김지유");
    expect(siteNameKey("김지유2")).toBe("김지유");
    expect(siteNameKey("김지유a")).toBe("김지유");
    for (const typed of ["김지유", "김지유A", "김 지유", "김지유B"]) expect(siteNameMatches("김지유A", typed), typed).toBe(true);
    expect(siteNameMatches("김지유A", "김지우")).toBe(false);
    expect(siteNameMatches("김지유", "김지")).toBe(false);
    expect(siteNameMatches(null, "김지유")).toBe(false);
  });
  it("로마자 이름은 건드리지 않는다(끝 글자를 떼면 다른 이름이 된다) · 대소문자는 가리지 않는다", () => {
    expect(siteNameKey("Chris")).toBe("chris");
    expect(siteNameMatches("Chris", "chris")).toBe(true);
    expect(siteNameMatches("Chris", "Chri")).toBe(false);
  });
  it("이름 모양 — 두 글자 이상 · 너무 길지 않다(모양이 다르면 DB를 묻지 않는다)", () => {
    for (const ok of ["김지유", "허준", "김지유A", "Chris"]) expect(isSiteName(ok), ok).toBe(true);
    for (const bad of ["", " ", "김", "김A", null, undefined, 123, "가".repeat(41)]) expect(isSiteName(bad), String(bad)).toBe(false);
  });
});

describe("사이트가 만든 링크의 수명 — 만든 날과 다음 날", () => {
  it("끝나는 순간은 이틀 뒤 0시(KST) · 마지막으로 쓸 수 있는 날은 다음 날", () => {
    expect(siteLinkExpiresAt("2026-10-02")).toBe("2026-10-04T00:00:00+09:00");
    expect(siteLinkLastDay("2026-10-02")).toBe("2026-10-03");
    expect(siteLinkExpiresAt("2026-12-31")).toBe("2027-01-02T00:00:00+09:00");
  });
});

describe("배선 가드", () => {
  it("`/v`(올리기 사이트)는 비로그인 통과 경로다 — 막히면 학생이 로그인 화면으로 간다", () => {
    expect(read("src", "lib", "supabase", "proxy.ts")).toContain('pathname === "/v" || pathname.startsWith("/v/")');
  });
  it("화면은 학생 정보를 직접 읽지 않는다 — 조회는 횟수 제한이 걸린 라우트만", () => {
    const page = read("src", "app", "(share)", "v", "page.tsx");
    expect(page).not.toMatch(/from\("students"\)|findCandidates|lookupSite/);
    const route = read("src", "app", "api", "video-submit", "site", "route.ts");
    expect(route).toContain("lookupSite(");
    expect(route).toContain("openSiteLink(");
  });
  it("🔴 조회·열기는 횟수 판정을 지난 뒤에만 후보를 찾는다", () => {
    const code = read("src", "features", "video-submit", "server", "site.ts");
    for (const fn of ["export async function lookupSite", "export async function openSiteLink"]) {
      const body = code.slice(code.indexOf(fn));
      expect(body.indexOf("await admit(")).toBeGreaterThan(0);
      expect(body.indexOf("await admit(")).toBeLessThan(body.indexOf("findCandidates("));
      // 숙제 목록도 횟수 판정·학생 확인을 지난 뒤에만 읽는다
      expect(body.indexOf("findCandidates(")).toBeLessThan(body.indexOf("homeworkChoices("));
    }
  });
  it("🔴 고른 숙제일은 주소·요청의 값을 믿지 않는다 — 제출 화면과 업로드 시작이 서버에서 다시 확인한다 · 사이트 링크는 숙제 없이는 못 연다", () => {
    const page = read("src", "app", "(share)", "v", "[token]", "page.tsx");
    expect(page).toContain("isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, picked, kstToday())");
    expect(page).toContain('if (link.origin === "site" && !homeworkDate) redirect("/v");');
    const start = read("src", "features", "video-submit", "server", "upload-start.ts");
    expect(start).toContain("isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, input.homeworkDate, kstToday())");
    expect(start).toContain('if (link.origin === "site" && !homeworkOk) return fail("invalid", HOMEWORK_GONE);');
    // 숙제 확인은 횟수 제한을 지난 뒤, Drive 폴더·세션을 만들기 전에
    expect(start.indexOf("if (await overLimit(1))")).toBeLessThan(start.indexOf("isAssignedHomeworkDate("));
    expect(start.indexOf("isAssignedHomeworkDate(")).toBeLessThan(start.indexOf("ensureLinkTeacherFolder("));
    // 숙제 조회는 전부 그 지점으로 좁힌다(로그인 없는 화면 — admin은 RLS를 우회한다)
    const hw = read("src", "features", "video-submit", "server", "site-homework.ts");
    expect(hw.match(/\.from\("/g)).toHaveLength(4);
    expect(hw.match(/\.eq\("tenant_id", tenantId\)/g)).toHaveLength(4);
  });
  it("🔴 숙제 하나를 올린 뒤 같은 반의 다른 숙제로 바로 간다(같은 링크) — 숙제마다 다시 조회·열기를 하지 않는다(횟수 제한·하루 링크 상한이 숙제 수만큼 들지 않게)", () => {
    const page = read("src", "app", "(share)", "v", "[token]", "page.tsx");
    expect(page).toContain("openHomeworkDates(db, link.tenant_id, [{ studentId: link.student_id, classId: link.class_id }], kstToday())");
    expect(page).toContain(".filter((date) => date !== homeworkDate)");
    // 올리기 사이트 링크에서만(학생 상세에서 복사한 링크는 숙제를 고르지 않는다)
    expect(page).toContain('if (link.origin === "site" && homeworkDate) {');
    const form = read("src", "app", "(share)", "v", "[token]", "video-submit-form.tsx");
    expect(form).toContain("href={`/v/${props.token}?h=${hw.date}`}");
    // 고른 숙제가 없어졌으면(invalid) 같은 거절을 되풀이하지 않고 새로 고친다 — 페이지가 처음 화면으로 보낸다
    expect(form).toContain('if (started?.code === "expired" || started?.code === "invalid") {');
    // 그 새로고침은 '올리는 중' 닫기 붙잡기(확인창)에 걸리지 않는다 — 취소하면 같은 거절 화면에 그대로 남는다
    expect(form).toContain("leaving.current = true;");
    expect(form).toContain("if (!leaving.current) event.preventDefault();");
    // 뒤로 가기로 되살아난 처음 화면이 '여는 중…'으로 잠겨 있지 않다
    expect(read("src", "app", "(share)", "v", "video-site-form.tsx")).toContain('window.addEventListener("pageshow", back);');
  });
  it("화면은 이름까지 받아 보낸다 · '올릴 숙제 없음'은 오류가 아니라 안내로 보인다", () => {
    const form = read("src", "app", "(share)", "v", "video-site-form.tsx");
    expect(form).toContain('op: "lookup", last4: digits, name');
    expect(form).toContain('op: "open", last4: asked.last4, name: asked.name, choice: id');
    expect(form).toContain('if (res?.code === "no_homework") setNotice(res.error);');
    const route = read("src", "app", "api", "video-submit", "site", "route.ts");
    expect(route).toContain("lookupSite({ last4: body?.last4, name: body?.name, ip })");
    expect(route).toContain("openSiteLink({ last4: body.last4, name: body.name, choice: body.choice, ip })");
  });
  it("학생 상세의 사이트 주소 안내는 그 지점이 사이트를 쓸 수 있을 때만", () => {
    const code = read("src", "app", "(shell)", "students", "[id]", "_tabs", "homework-video-links.tsx");
    expect(code).toContain("site?.ok && site.tenantId === user.tenantId");
    expect(code).toContain("{siteUrl ? (");
  });
});
