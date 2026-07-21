/**
 * 발송 PC(워커) 로그 한 줄 → 사람이 읽는 형태로 변환(순수, Vitest).
 *
 * ⚠️ 왜 필요한가(2026-07-21 원장 제보): 하트비트로 올라온 '최근 경고'를 툴팁에 원문 그대로 넣었더니
 * 터미널 제어문자(ANSI `[2m`/`[22m`)·UTC ISO 시각·영문 스택이 뒤섞여 **읽을 수가 없었다**.
 * 화면에 raw 기술 문자열을 그대로 내보내지 않는다는 규칙(UI에 raw 코드 노출 금지) 위반이기도 하다.
 *
 * 변환 3단계: ① ANSI·제어문자 제거 ② 앞머리 `[ISO]` → KST HH:MM ③ 폴러 태그·기술 문구 → 한글.
 * 원문은 버리지 않고 `raw`로 함께 돌려준다(펼쳐 보기용) — 요약이 틀렸을 때 사람이 확인할 수 있어야 한다.
 */
import { sanitizeErrorText } from "@/lib/text/sanitize-error";

export type WorkerLogLine = {
  /** KST "HH:MM" — 시각을 못 읽으면 빈 문자열. */
  time: string;
  /** 폴러 한글 라벨(없으면 빈 문자열). */
  label: string;
  /** 한 줄 한글 요약. */
  summary: string;
  /** 정리된 원문(요약과 같으면 빈 문자열 — 펼칠 게 없다는 뜻). */
  raw: string;
};

/** 워커 로그의 폴러 태그 → 한글. 미등록 태그는 라벨 없이 본문만 보여준다(raw 태그 노출 금지). */
const TAG_LABEL: Readonly<Record<string, string>> = {
  feed: "학부모 글·댓글",
  "읽음": "읽음 동기화",
  provision: "보드 준비",
  notice: "공지 발송",
  queue: "보고서 발송",
};

/** 기술 원문 → 한글 요약. 앞에서부터 먼저 맞는 것을 쓴다(구체적인 것 먼저). */
const PATTERNS: readonly { re: RegExp; to: (m: RegExpExecArray) => string }[] = [
  {
    re: /Timeout\s+(\d+)ms exceeded[\s\S]*?navigating to "([^"]+)"/i,
    to: (m) => `${hostOf(m[2])} 접속이 ${Math.round(Number(m[1]) / 1000)}초 안에 안 끝남 — 다음 차례에 재시도`,
  },
  { re: /Timeout\s+(\d+)ms exceeded/i, to: (m) => `처리가 ${Math.round(Number(m[1]) / 1000)}초를 넘김 — 다음 차례에 재시도` },
  { re: /ERR_NAME_NOT_RESOLVED|ENOTFOUND/i, to: () => "주소를 찾지 못함 — 발송 PC의 주소 설정·인터넷 연결 확인" },
  { re: /ERR_CONNECTION|ECONNREFUSED|ECONNRESET/i, to: () => "연결이 끊김 — 인터넷 연결 확인 후 다음 차례에 재시도" },
  { re: /net::ERR_[A-Z_]+/i, to: () => "네트워크 오류 — 다음 차례에 재시도" },
];

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url.trim());
  if (!m) return "대상 주소";
  return m[1].replace(/^www\./i, "");
}

/** ISO(UTC) → KST "HH:MM". 파싱 실패면 빈 문자열. */
function kstHHMM(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 로그 한 줄 변환. 형식: `[ISO] [태그] 본문` (태그·시각은 없을 수 있음).
 * 요약이 원문과 사실상 같으면 `raw`를 비워 '자세히'를 띄우지 않는다(노이즈 방지).
 */
export function formatWorkerLogLine(line: string): WorkerLogLine {
  const clean = sanitizeErrorText(line);
  if (!clean) return { time: "", label: "", summary: "", raw: "" };

  let rest = clean;
  let time = "";
  const ts = /^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+)\]\s*/.exec(rest);
  if (ts) {
    time = kstHHMM(ts[1]);
    rest = rest.slice(ts[0].length);
  }

  let label = "";
  const tag = /^\[([^\]]+)\]\s*/.exec(rest);
  if (tag) {
    const mapped = TAG_LABEL[tag[1].trim()];
    if (mapped) {
      label = mapped;
      rest = rest.slice(tag[0].length);
    }
    // 미등록 태그는 라벨로 승격하지 않되 본문에서도 떼어낸다(raw 키가 화면에 뜨지 않게).
    else rest = rest.slice(tag[0].length);
  }

  let summary = rest.trim();
  for (const { re, to } of PATTERNS) {
    const m = re.exec(rest);
    if (m) {
      // 앞쪽 한글 도입부("오류(다음 폴에서 재시도):")가 있으면 살려서 맥락을 남긴다.
      const lead = rest.slice(0, m.index).replace(/[:\-—\s]+$/, "").trim();
      summary = lead ? `${lead} — ${to(m)}` : to(m);
      break;
    }
  }
  summary = summary.replace(/\s+/g, " ").trim();
  return { time, label, summary, raw: summary === rest.trim() ? "" : rest.trim() };
}

/** 여러 줄 변환 — 빈 줄은 버린다. */
export function formatWorkerLogLines(lines: readonly string[]): WorkerLogLine[] {
  return lines.map(formatWorkerLogLine).filter((l) => l.summary);
}
