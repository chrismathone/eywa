// 수업보고서 글의 '영상첨부' 줄(2026-10-01 → 10-02 두 줄에 이름) — 본문 만들기·일치 판정·앱 문의(실패해도 발송을 막지 않는다).
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchVideoSubmitLine, reportPostContent, sameReportContent } from "./report-video-line.mjs";
import { shareUrlVariants } from "./share-bases.mjs";

vi.mock("@playwright/test", () => ({ chromium: {} }));
const { findChildReportId } = await import("./classnote-admin-core.mjs");
const { crossCheckOthers } = await import("./classnote-class-route.mjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SHARE = "https://www.aywa.co.kr/r/0d6f1c3e-5c1b-4f5e-9a7d-1b2c3d4e5f60";
const TOKEN = "A".repeat(20) + "-_" + "b".repeat(21);
const VIDEO = `https://www.aywa.co.kr/v/${TOKEN}`;

describe("게시 본문", () => {
  it("제출 주소가 없으면 지금과 글자까지 같다", () => {
    expect(reportPostContent(SHARE, null)).toBe(SHARE);
    expect(reportPostContent(SHARE, VIDEO)).toBe(`보고서 : ${SHARE}\n영상첨부 : ${VIDEO}`);
  });
});

describe("본문 일치 — 세 모양 다, 엄격하게", () => {
  it("옛 한 줄 글과 줄이 붙은 글을 같은 보고서로 본다(토큰 값은 재시도마다 달라도)", () => {
    expect(sameReportContent(SHARE, SHARE)).toBe(true);
    expect(sameReportContent(reportPostContent(SHARE, VIDEO), SHARE)).toBe(true);
    // 10-01 ~ 10-02에 이미 나간 글(첫 줄 링크 그대로 + '영상 제출:') — 계속 알아봐야 회수·재시도가 맞는다.
    expect(sameReportContent(`${SHARE}\n영상 제출: ${VIDEO}`, SHARE)).toBe(true);
    expect(sameReportContent(`${SHARE}\r\n영상 제출: https://eywa-alpha.vercel.app/v/${"z".repeat(43)}`, SHARE)).toBe(true);
  });
  it("ClassNote가 줄바꿈을 <br>로 바꾸거나 공백을 붙여 저장해도 알아본다(못 알아보면 같은 글을 또 올린다)", () => {
    expect(sameReportContent(`${SHARE}<br>영상 제출: ${VIDEO}`, SHARE)).toBe(true);
    expect(sameReportContent(`${SHARE}<br />\n영상 제출:${VIDEO}\n`, SHARE)).toBe(true);
    expect(sameReportContent(`${SHARE} \n\n 영상 제출:  ${VIDEO} `, SHARE)).toBe(true);
    expect(sameReportContent(`${SHARE} 영상 제출: ${VIDEO}`, SHARE)).toBe(false); // 줄 구분 없음
  });
  it("이름 붙은 두 줄 — 줄바꿈·빈칸이 바뀌어 저장돼도 알아본다", () => {
    expect(sameReportContent(`보고서 : ${SHARE}\r\n영상첨부 : ${VIDEO}`, SHARE)).toBe(true);
    expect(sameReportContent(`보고서 : ${SHARE}<br>영상첨부 : ${VIDEO}`, SHARE)).toBe(true);
    expect(sameReportContent(`보고서: ${SHARE}<br />\n영상첨부:${VIDEO}\n`, SHARE)).toBe(true);
    expect(sameReportContent(`보고서 : ${SHARE} \n\n 영상첨부&nbsp;:&nbsp;${VIDEO} `, SHARE)).toBe(true);
    expect(sameReportContent(`보고서 : ${SHARE} 영상첨부 : ${VIDEO}`, SHARE)).toBe(false); // 줄 구분 없음
  });
  it("이름 붙은 두 줄 — 한 줄만 있거나 이름이 다르거나 덧붙인 글은 아니다", () => {
    expect(sameReportContent(`보고서 : ${SHARE}`, SHARE)).toBe(false); // 링크가 하나뿐이면 이름을 달지 않는다
    expect(sameReportContent(`보고서 : ${SHARE}\n영상 제출: ${VIDEO}`, SHARE)).toBe(false); // 섞인 모양
    expect(sameReportContent(`${SHARE}\n영상첨부 : ${VIDEO}`, SHARE)).toBe(false);
    expect(sameReportContent(`숙제 : ${SHARE}\n영상첨부 : ${VIDEO}`, SHARE)).toBe(false);
    expect(sameReportContent(`안내\n보고서 : ${SHARE}\n영상첨부 : ${VIDEO}`, SHARE)).toBe(false);
    expect(sameReportContent(`보고서 : ${SHARE}\n영상첨부 : ${VIDEO}\n추가`, SHARE)).toBe(false);
    expect(sameReportContent(`보고서 : ${SHARE}x\n영상첨부 : ${VIDEO}`, SHARE)).toBe(false);
    expect(sameReportContent(reportPostContent(SHARE, VIDEO), SHARE.replace("60", "61"))).toBe(false);
  });
  it("남의 글·다른 보고서·덧붙인 글은 아니다", () => {
    expect(sameReportContent(`${SHARE}x`, SHARE)).toBe(false);
    expect(sameReportContent(`${SHARE}\n영상 제출: ${VIDEO}\n추가`, SHARE)).toBe(false);
    expect(sameReportContent(`${SHARE}\n영상 제출: https://www.aywa.co.kr/v/짧은토큰`, SHARE)).toBe(false);
    expect(sameReportContent(`${SHARE}\n아무 글: ${VIDEO}`, SHARE)).toBe(false);
    expect(sameReportContent(`앞글\n${SHARE}`, SHARE)).toBe(false);
    expect(sameReportContent(reportPostContent(SHARE, VIDEO), SHARE.replace("60", "61"))).toBe(false);
    expect(sameReportContent(null, SHARE)).toBe(false);
  });
  it("🔴 올리기 사이트 안내 줄(`…/v`, 2026-10-03~)도 같은 보고서로 본다 — 못 알아보면 재시도가 같은 글을 또 올리고 회수가 거짓 성공한다", () => {
    const SITE = "https://www.aywa.co.kr/v";
    expect(reportPostContent(SHARE, SITE)).toBe(`보고서 : ${SHARE}\n영상첨부 : ${SITE}`);
    expect(sameReportContent(reportPostContent(SHARE, SITE), SHARE)).toBe(true);
    expect(sameReportContent(`보고서 : ${SHARE}<br>영상첨부 : ${SITE}`, SHARE)).toBe(true);
    expect(sameReportContent(`보고서: ${SHARE}\r\n영상첨부:&nbsp;${SITE} \n`, SHARE)).toBe(true);
    // 꼬리가 사이트 주소·토큰 주소가 아니면 우리 글이 아니다
    for (const tail of [`${SITE}x`, `${SITE}/`, `${SITE}/짧은토큰`, `${SITE}?h=2026-10-01`, "https://www.aywa.co.kr/vv", `${SITE} 추가`])
      expect(sameReportContent(`보고서 : ${SHARE}\n영상첨부 : ${tail}`, SHARE), tail).toBe(false);
    expect(sameReportContent(reportPostContent(SHARE, SITE), SHARE.replace("60", "61"))).toBe(false);
  });
  it("주소의 특수문자를 정규식으로 해석하지 않는다", () => {
    expect(sameReportContent(`https://wwwXaywa.co.kr/r/a\n영상 제출: ${VIDEO}`, "https://www.aywa.co.kr/r/a")).toBe(false);
  });
});

describe("중복 확인·교차 확인·회수가 줄 붙은 글을 알아본다(findChildReportId 한 곳)", () => {
  const page = (list) => ({ evaluate: async () => list });
  const posted = reportPostContent(SHARE, VIDEO);
  it("올리기 사이트 안내 줄이 붙은 글도 재시도 선확인이 찾는다", async () => {
    const site = reportPostContent(SHARE, "https://www.aywa.co.kr/v");
    const r = await findChildReportId(page([{ id: 9, cls: 111, child: 5, content: site }]), 1, { cls: null, child: 5, content: shareUrlVariants(SHARE) });
    expect(r).toEqual({ ok: true, id: 9 });
  });
  it("재시도 선확인(옛·새 주소 후보)이 줄 붙은 글을 찾는다 — 못 찾으면 같은 글을 또 올린다", async () => {
    const r = await findChildReportId(page([{ id: 9, cls: 111, child: 5, content: posted }]), 1, { cls: null, child: 5, content: shareUrlVariants(SHARE) });
    expect(r).toEqual({ ok: true, id: 9 });
  });
  it("사후 확인·회수(링크 하나)도 찾는다", async () => {
    const r = await findChildReportId(page([{ id: 9, cls: 111, child: 5, content: posted }]), 1, { cls: 111, child: 5, content: SHARE });
    expect(r).toEqual({ ok: true, id: 9 });
  });
  it("반별 교차 확인이 다른 원아에게 새어 나간 줄 붙은 글을 잡는다", async () => {
    const cc = await crossCheckOthers(page([{ id: 9, cls: 111, child: 7, content: posted }]), { centerId: 1, boardId: 111, others: [7], contents: shareUrlVariants(SHARE) });
    expect(cc).toEqual({ ok: false, leakedTo: [7], unknown: false });
  });
});

describe("앱 문의 — 실패해도 줄 없이 보낸다", () => {
  const args = { base: "https://www.aywa.co.kr", shareBase: "https://www.aywa.co.kr/", reportId: "r1", secret: "s" };
  it("토큰을 받으면 공유 주소 기준 /v 주소", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ token: TOKEN }) }));
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl })).toBe(VIDEO);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://www.aywa.co.kr/api/internal/video-submit-link");
    expect(init.headers["x-eywa-internal"]).toBe("s");
    expect(JSON.parse(init.body)).toEqual({ reportId: "r1" });
  });
  it("🔴 앱이 사이트 안내(site: true)를 주면 공유 주소 기준 `/v` 한 줄 — 학생마다 토큰은 없다(2026-10-03)", async () => {
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ token: null, site: true }) }) }))
      .toBe("https://www.aywa.co.kr/v");
    // 사이트 안내가 아니면(false·없음) 예전처럼 토큰을 본다
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ token: null, site: false }) }) })).toBeNull();
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ token: null, site: "true" }) }) })).toBeNull();
  });
  it("null 토큰·이상한 토큰·HTTP 오류·네트워크 오류·시크릿 없음은 전부 null", async () => {
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ token: null }) }) })).toBeNull();
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ token: "../x" }) }) })).toBeNull();
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) })).toBeNull();
    expect(await fetchVideoSubmitLine({ ...args, fetchImpl: async () => { throw new Error("down"); } })).toBeNull();
    const never = vi.fn();
    expect(await fetchVideoSubmitLine({ ...args, secret: undefined, fetchImpl: never })).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});

describe("배선 가드 — 발송 코어가 줄을 본문에 넣고, 영상 줄 문의는 게시 직전 한 번", () => {
  const src = fs.readFileSync(path.join(DIR, "classnote-core.mjs"), "utf8");
  it("게시 본문은 reportPostContent로만", () => {
    expect(src).toMatch(/content: reportPostContent\(shareUrl, videoUrl\)/);
    expect(src).not.toMatch(/enrollment: enrollment\.id, content: shareUrl,/);
    expect(src.match(/fetchVideoSubmitLine\(/g)?.length).toBe(1);
  });
});
