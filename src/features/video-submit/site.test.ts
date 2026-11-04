/** 숙제 영상 올리기 사이트(0330a) — 순수 규칙 + 공개 경로·배선 가드. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLast4, isSiteName, phoneEndsWith, SITE_HOMEWORK_DAYS, SITE_NO_CLASS, siteHomeworkLastDay, siteLinkExpiresAt, siteNameKey, siteNameMatches, siteNoChoiceMessage, uploadLastDay } from "./site";

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

describe("사이트로 올리는 기한 — 숙제일 + 7일(원장 2026-10-03 \"숙제날짜 기준 7일\")", () => {
  it("10/1 숙제는 10/8까지 · 링크는 마지막 날 다음 날 0시(KST)에 끝난다 · 해·달을 넘긴다", () => {
    expect(SITE_HOMEWORK_DAYS).toBe(7);
    expect(siteHomeworkLastDay("2026-10-01")).toBe("2026-10-08");
    expect(siteLinkExpiresAt("2026-10-08")).toBe("2026-10-09T00:00:00+09:00");
    expect(siteHomeworkLastDay("2026-12-28")).toBe("2027-01-04");
    expect(siteLinkExpiresAt("2026-12-31")).toBe("2027-01-01T00:00:00+09:00");
  });
  it("제출 화면의 '언제까지' = 고른 숙제의 기한과 링크가 끝나는 날 중 이른 날 · 숙제가 없으면 링크가 끝나는 날", () => {
    expect(uploadLastDay("2026-10-11T00:00:00+09:00", "2026-10-01")).toBe("2026-10-08"); // 링크는 더 늦은 숙제까지 산다
    expect(uploadLastDay("2026-10-04T00:00:00+09:00", "2026-10-01")).toBe("2026-10-03"); // 예전 규칙(만든 날 + 다음 날)으로 만든 링크
    expect(uploadLastDay("2026-10-10T00:00:00+09:00", null)).toBe("2026-10-09");
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
      expect(body.indexOf("findCandidates(")).toBeLessThan(body.indexOf("pickChoices("));
    }
  });
  it("🔴 고른 숙제일은 주소·요청의 값을 믿지 않는다 — 제출 화면과 업로드 시작이 서버에서 다시 확인한다 · 사이트 링크는 숙제 없이는 못 연다", () => {
    const page = read("src", "app", "(share)", "v", "[token]", "page.tsx");
    expect(page).toContain("isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, picked, kstToday())");
    expect(page).toContain('if (link.origin === "site" && !homeworkDate && !freeUpload) redirect("/v");');
    // 숙제 없이 올리기는 사이트 링크 + 숙제를 고르지 않았을 때만(주소에 숙제일이 있으면 그 숙제가 이긴다)
    expect(page).toContain('const freeUpload = link.origin === "site" && !homeworkDate && !picked && free === "1";');
    const start = read("src", "features", "video-submit", "server", "upload-start.ts");
    expect(start).toContain("isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, input.homeworkDate, kstToday())");
    expect(start).toContain('if (link.origin === "site" && input.homeworkDate != null && !homeworkOk) return fail("invalid", HOMEWORK_GONE);');
    // 숙제 없이 올리면 메모가 있어야 하고 하루 상한을 넣기 전·넣은 뒤 두 번 센다
    expect(start).toContain("if (free && !note) return fail(\"file\", NOTE_NEEDED);");
    expect(start).toContain("if (free && (await freeUploadsToday(db, link)) >= SITE_FREE_UPLOADS_PER_DAY) return fail(\"limit\", FREE_LIMITED);");
    expect(start).toContain("if (free && (await freeUploadsToday(db, link)) > SITE_FREE_UPLOADS_PER_DAY) {");
    // 숙제 확인은 횟수 제한을 지난 뒤, Drive 폴더·세션을 만들기 전에
    expect(start.indexOf("if (await overLimit(1))")).toBeLessThan(start.indexOf("isAssignedHomeworkDate("));
    expect(start.indexOf("isAssignedHomeworkDate(")).toBeLessThan(start.indexOf("ensureLinkTeacherFolder("));
    // 숙제 조회는 전부 그 지점으로 좁힌다(로그인 없는 화면 — admin은 RLS를 우회한다)
    const hw = read("src", "features", "video-submit", "server", "site-homework.ts");
    expect(hw.match(/\.from\(/g)).toHaveLength(4);
    expect(hw.match(/\.eq\("tenant_id", tenantId\)/g)).toHaveLength(4);
  });
  it("🔴 숙제 하나를 올린 뒤 같은 반의 다른 숙제로 바로 간다(같은 링크) — 숙제마다 다시 조회·열기를 하지 않는다(횟수 제한·하루 링크 상한이 숙제 수만큼 들지 않게)", () => {
    const page = read("src", "app", "(share)", "v", "[token]", "page.tsx");
    expect(page).toContain("openHomeworkDates(db, link.tenant_id, [{ studentId: link.student_id, classId: link.class_id }], kstToday())");
    expect(page).toContain(".filter((homework) => homework.date !== homeworkDate)");
    // 올리기 사이트 링크에서만(학생 상세에서 복사한 링크는 숙제를 고르지 않는다)
    expect(page).toContain('otherHomework = link.origin === "site"');
    // 한 숙제에 낼 수 있는 영상을 다 낸 숙제는 더 올리지 않고 숙제 없이 올리기로(원장 2026-10-21 — 그 전엔 영상 1개면 닫았다)
    expect(page).toContain('if (homeworkDate && openDates && !openDates.some((homework) => homework.date === homeworkDate))');
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
  it("🔴 두 로더가 영상 지문(md5·용량)과 들어온 시각 재료를 함께 읽는다 — 빠지면 같은 파일 판정·같은 날 규칙이 조용히 꺼진다(가짜 DB는 select 칸을 안 본다)", () => {
    const ledger = read("src", "features", "video-homework", "server", "ledger-queries.ts");
    const columns = ledger.match(/\.select\("([^"]*post_id[^"]*)"\)/)?.[1].split(",");
    expect(columns).toEqual(expect.arrayContaining(["id", "student_id", "post_id", "posted_at", "created_at", "uploaded_at", "md5", "bytes", "status", "drive_file_id", "class_id:route->>classId", "homework_date:route->>homeworkDate"]));
    expect(ledger).toContain("fingerprint: videoFingerprint(row.md5, row.bytes)");
    // 지난 기간을 봐도 지금 보기와 같은 판정 — 고른 영상을 짝 범위 끝 + 2주까지 읽는다
    // (읽는 학생은 2026-10-22 숙제 0건 반·명단 전체로 넓힘(원장 지시) — homeworkStudents → videoStudents. 잠그는 것은 범위다.)
    // (2026-10-23 반 미정 영상도 읽는다 — '영상 배정 필요함'이 미배정 알림과 같은 판정을 쓰게. 회차·화면에는 반이 정해진 영상만.)
    expect(ledger).toContain("loadClassVideos(tenantId, videoStudents, wideFrom, addDays(wideTo, VIDEO_MATCH_WINDOW_DAYS), true)");
    const site = read("src", "features", "video-submit", "server", "site-homework.ts");
    expect(site).toContain('select("id,student_id,post_id,posted_at,created_at,uploaded_at,md5,bytes,route,drive_file_id")');
    expect(site).toContain("fingerprint: videoFingerprint(row.md5, row.bytes)");
  });
  it("화면은 이름까지 받아 보낸다 · '올릴 숙제 없음'은 오류가 아니라 안내로 보인다", () => {
    const form = read("src", "app", "(share)", "v", "video-site-form.tsx");
    expect(form).toContain('op: "lookup", last4: digits, name');
    expect(form).toContain('op: "open", last4: asked.last4, name: asked.name, choice: id');
    expect(form).toContain('if (res?.code === "no_homework") setNotice(res.error);');
    const route = read("src", "app", "api", "video-submit", "site", "route.ts");
    expect(route).toContain("lookupSite({ last4: body?.last4, name: body?.name, tenant: body?.tenant, ip })");
    expect(route).toContain("openSiteLink({ last4: body.last4, name: body.name, choice: body.choice, tenant: body.tenant, ip })");
  });
  it("🔴 지점은 화면에서 고른다(주소에 넣지 않는다) — 고른 지점을 조회·열기에 함께 보내고, 서버가 다시 고르라면 그 자리에서 고르게 한다", () => {
    const form = read("src", "app", "(share)", "v", "video-site-form.tsx");
    // 조회는 지금 고른 지점으로, 열기는 그 조회와 같은 지점으로
    expect(form).toContain('op: "lookup", last4: digits, name, tenant }');
    expect(form).toContain("choice: id, tenant: asked.tenant }");
    expect(form).toContain('if (res?.code === "branch") return branchNeeded(res);');
    // 기억해 둔 지점은 하이드레이션 뒤에 읽는다(서버 렌더와 첫 클라 렌더가 같아야 한다)
    expect(form).toContain("useSyncExternalStore(subscribeNever, readRemembered, () => null)");
    // 주소로 지점을 받지 않는다 — 공개 화면·폼 어디에도 주소의 지점 값을 읽는 코드가 없다
    const page = read("src", "app", "(share)", "v", "page.tsx");
    for (const code of [form, page]) expect(code).not.toMatch(/searchParams|useSearchParams|location\.search/);
    // 하나뿐이어도 그 지점을 넘긴다(요청을 그 지점에 고정) — 판정하지 못한 지점이 있으면 하나여도 고르게 한다
    expect(page).toContain("const only = directory.sites.length === 1 && !directory.partial ? directory.sites[0]! : null;");
    expect(page).toContain("branches={directory.sites.map((site) => ({ id: site.tenantId, name: site.branchName }))}");
    expect(page).toContain("mustChoose={!only}");
    // 하나뿐일 때 폼은 그 지점에 고정한다 · 서버가 다시 고르라면 지점 수와 무관하게 직접 고르게 한다
    expect(form).toContain(": branchList[0] ?? null;");
    expect(form).toContain("setForceChoose(true);");
    // 서버: 공개 요청의 지점은 한 함수가 정한다 — 조회·열기 둘 다 그 함수를 지난 뒤에만 학생을 찾는다
    const server = read("src", "features", "video-submit", "server", "site.ts");
    expect(server.match(/await resolveSiteRequest\(db, input\.tenant\)/g)).toHaveLength(2);
  });
  it("학생 상세의 사이트 주소 안내는 그 지점이 사이트를 쓸 수 있을 때만 — 로그인한 계정의 지점으로 묻는다", () => {
    const code = read("src", "app", "(shell)", "students", "[id]", "_tabs", "homework-video-links.tsx");
    expect(code).toContain("siteAvailability(undefined, user.tenantId)");
    expect(code).toContain("{siteUrl ? (");
    // 끊긴 링크의 안내도 그 링크의 지점으로 묻는다
    expect(read("src", "app", "(share)", "v", "[token]", "page.tsx")).toContain("siteAvailability(db, link.tenant_id)");
  });
});

describe("고를 줄이 없을 때의 안내 — 까닭을 가린다(원장 2026-11-04)", () => {
  it("🔴 다니는 반이 영상 숙제 대상 밖이면 '반이 없다'고 하지 않는다(학생이 '반 배정이 안 됐다'로 읽었다)", () => {
    const off = siteNoChoiceMessage({ excludedNow: true, nextStart: null });
    expect(off).toContain("지금 다니는 반은 여기서 영상 숙제를 받지 않습니다");
    expect(off).not.toContain("반이 없습니다");
    expect(off).toContain("ClassNote 알림장");
  });
  it("시작 전 반은 그날을 알려 준다 · 대상 밖 반과 함께면 둘 다 말한다", () => {
    expect(siteNoChoiceMessage({ excludedNow: false, nextStart: "2026-11-06" })).toBe(
      "다니는 반 수업이 11/6 (금)에 시작합니다. 그날부터 여기서 올릴 수 있습니다. 그 전에는 숙제 영상을 ClassNote 알림장에 올려 주세요.");
    const both = siteNoChoiceMessage({ excludedNow: true, nextStart: "2026-11-06" });
    expect(both).toContain("지금 다니는 반은 여기서 영상 숙제를 받지 않습니다");
    expect(both).toContain("11/6 (금)에 시작하는 반은 그날부터");
    expect(both).not.toContain("반이 없습니다");
  });
  it("까닭이 없으면(수강 끝 · 휴원 · 숙제 없는 지난 반뿐) 종전 문구", () => {
    expect(siteNoChoiceMessage({ excludedNow: false, nextStart: null })).toBe(SITE_NO_CLASS);
    expect(siteNoChoiceMessage(undefined)).toBe(SITE_NO_CLASS);
    expect(SITE_NO_CLASS).toContain("영상을 올릴 수 있는 반이 없습니다");
  });
});
