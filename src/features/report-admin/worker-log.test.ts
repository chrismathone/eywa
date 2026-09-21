import { describe, expect, it } from "vitest";
import { formatWorkerLogLine, formatWorkerLogLines, isWorkerLogStale, workerLogAgeLabel } from "./worker-log";

// 실제 발송 PC 로그(2026-07-21 하트비트로 올라온 원문). ANSI 제어문자 포함.
const ESC = String.fromCharCode(27);
const REAL_FEED = `[2026-07-21T05:54:22.881Z] [feed] 오류(다음 폴에서 재시도): page.goto: Timeout 60000ms exceeded.\nCall log:\n${ESC}[2m  - navigating to "https://www.classnote.com/login", waiting until "domcontentloaded"${ESC}[22m`;
const REAL_READ = "[2026-07-21T05:54:38.606Z] [읽음] ⚠️ 후보 576건이 aywa 행과 매칭되지 않음 — edutrix_share_token 임포트 여부 확인 필요";

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

// 🔴 2026-07-22 실측 회귀: 워커가 로그 스탬프를 UTC ISO → **KST 평문**(공백 구분)으로 바꿨는데
// 앱 파서는 ISO만 받고 있었다. 앞머리가 안 잘리니 다음 `[...]`(=`[notice]`)를 시각으로 오인해
// 라벨 변환까지 실패 → 화면에 원시 태그와 UUID가 그대로 나갔다(UI raw 노출 금지 위반).
describe("formatWorkerLogLine — 워커 스탬프 두 형식", () => {
  const KST = (s: string) => Date.parse(`${s}+09:00`);

  it("KST 평문 스탬프를 읽고 태그도 한글 라벨로 바꾼다", () => {
    const r = formatWorkerLogLine("[2026-07-22 13:56:55] [notice] 첨부 준비 중단");
    expect(r.time).toBe("13:56");
    expect(r.at).toBe(KST("2026-07-22T13:56:55"));
    expect(r.label).toBe("공지 발송");
    expect(r.summary).not.toContain("[notice]"); // 원시 태그가 새면 안 된다
  });

  it("옛 ISO(UTC) 스탬프도 계속 읽는다 — 지난 로그가 깨지면 안 된다", () => {
    const r = formatWorkerLogLine("[2026-07-22T04:56:55.000Z] [notice] 첨부 준비 중단");
    expect(r.time).toBe("13:56"); // UTC 04:56 = KST 13:56
    expect(r.at).toBe(Date.parse("2026-07-22T04:56:55.000Z"));
    expect(r.label).toBe("공지 발송");
  });

  it("KST 평문을 실행 환경 타임존으로 읽지 않는다 — Vercel(UTC)에서 9시간 어긋나던 자리", () => {
    const r = formatWorkerLogLine("[2026-07-22 13:56:55] [notice] x");
    expect(r.at).toBe(KST("2026-07-22T13:56:55"));
    expect(r.at).not.toBe(Date.parse("2026-07-22T13:56:55Z"));
  });

  it("스탬프가 없으면 시각 없이 본문만", () => {
    const r = formatWorkerLogLine("[notice] 첨부 준비 중단");
    expect(r.at).toBeNull();
    expect(r.label).toBe("공지 발송");
  });
});

describe("workerLogAgeLabel / isWorkerLogStale", () => {
  const now = Date.parse("2026-07-22T23:00:00+09:00");
  const ago = (min: number) => now - min * 60_000;

  it("경과를 사람 말로", () => {
    expect(workerLogAgeLabel(ago(0), now)).toBe("방금");
    expect(workerLogAgeLabel(ago(12), now)).toBe("12분 전");
    expect(workerLogAgeLabel(ago(70), now)).toBe("1시간 전");
    expect(workerLogAgeLabel(ago(600), now)).toBe("10시간 전");
    expect(workerLogAgeLabel(ago(60 * 25), now)).toBe("어제");
    expect(workerLogAgeLabel(ago(60 * 24 * 3), now)).toBe("3일 전");
  });

  it("시각을 못 읽은 줄은 경과도 표시하지 않는다(추측 금지)", () => {
    expect(workerLogAgeLabel(null, now)).toBe("");
    expect(isWorkerLogStale(null, now)).toBe(false);
  });

  it("2시간이 지나면 '지난 기록'으로 본다 — 원장 문의의 그 10시간짜리가 여기 걸린다", () => {
    expect(isWorkerLogStale(ago(119), now)).toBe(false);
    expect(isWorkerLogStale(ago(121), now)).toBe(true);
    expect(isWorkerLogStale(ago(600), now)).toBe(true);
  });
});
