import { describe, expect, it } from "vitest";
import { formatWorkerLogLine, formatWorkerLogLines } from "./worker-log";

// 실제 발송 PC 로그(2026-07-21 하트비트로 올라온 원문). ANSI 제어문자 포함.
const ESC = String.fromCharCode(27);
const REAL_FEED = `[2026-07-21T05:54:22.881Z] [feed] 오류(다음 폴에서 재시도): page.goto: Timeout 60000ms exceeded.\nCall log:\n${ESC}[2m  - navigating to "https://www.classnote.com/login", waiting until "domcontentloaded"${ESC}[22m`;
const REAL_READ = "[2026-07-21T05:54:38.606Z] [읽음] ⚠️ 후보 576건이 eywa 행과 매칭되지 않음 — edutrix_share_token 임포트 여부 확인 필요";

describe("formatWorkerLogLine", () => {
  it("실제 로그: ANSI 제거 + KST 시각 + 한글 요약", () => {
    const r = formatWorkerLogLine(REAL_FEED);
    expect(r.time).toBe("14:54"); // 05:54 UTC = 14:54 KST
    expect(r.label).toBe("학부모 새 글"); // [feed]=새 글 폴러. 댓글은 [comment]로 분리돼 있다
    expect(r.summary).toContain("classnote.com 접속이 60초 안에 안 끝남");
    expect(r.summary).toContain("오류(다음 폴에서 재시도)"); // 맥락 보존
    expect(r.summary).not.toContain(ESC); // 제어문자 제거
    expect(r.summary).not.toContain("[2m");
    expect(r.raw).toContain("page.goto"); // 원문은 펼쳐 볼 수 있게 보존
  });

  it("이미 한글인 줄은 요약하지 않고 태그만 라벨로", () => {
    const r = formatWorkerLogLine(REAL_READ);
    expect(r.time).toBe("14:54");
    expect(r.label).toBe("읽음 동기화");
    expect(r.summary).toContain("후보 576건");
    expect(r.raw).toBe(""); // 요약=원문 → '자세히' 안 띄움
  });

  it("주소를 못 찾는 오류는 조치 문구로", () => {
    const r = formatWorkerLogLine("[2026-07-21T00:00:00.000Z] page.goto: net::ERR_NAME_NOT_RESOLVED");
    expect(r.summary).toContain("주소를 찾지 못함");
    expect(r.summary).toContain("발송 PC의 주소 설정");
  });

  it("시각·태그가 없어도 깨지지 않는다", () => {
    const r = formatWorkerLogLine("처리 완료 — 성공 1 / 실패 0");
    expect(r.time).toBe("");
    expect(r.label).toBe("");
    expect(r.summary).toBe("처리 완료 — 성공 1 / 실패 0");
  });

  it("미등록 태그는 라벨로 올리지 않고 본문에서도 뗀다(raw 키 노출 금지)", () => {
    const r = formatWorkerLogLine("[unknown_poller] 뭔가 실패");
    expect(r.label).toBe("");
    expect(r.summary).toBe("뭔가 실패");
    expect(r.summary).not.toContain("unknown_poller");
  });

  it("빈 줄·공백은 걸러진다", () => {
    expect(formatWorkerLogLines(["", "   ", REAL_READ])).toHaveLength(1);
  });
});
