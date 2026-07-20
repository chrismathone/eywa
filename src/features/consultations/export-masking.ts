// 상담 텍스트 외부(AI) 반출용 마스킹 — 순수 함수(Vitest 대상, IO 없음).
// 원칙: 이름은 첫 글자만(김○○), 전화/주민번호/이메일은 패턴 마스킹, 학생 식별은 안정 익명 코드.
// 소비처: /api/exports/consultations (외부 AI 챗봇용 반출 — 원시 PII 필드는 애초에 SELECT 안 함).

/**
 * 안정 익명 코드 — 같은 id면 항상 같은 코드. 외부 AI가 "같은 학생의 상담 흐름"은 추적하되
 * 신원은 알 수 없게 한다(djb2 해시 — 보안 해시는 아니지만 원문 id가 UUID라 역산 무의미).
 */
export function pseudonym(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return `학생#${h.toString(16).padStart(8, "0").slice(0, 6)}`;
}

/** 이름 마스킹: "김철수" → "김○○" (1자 이하/빈 값은 "○○"). 4자 초과분도 ○ 3개로 캡. */
export function maskName(name: string): string {
  const t = name.trim();
  if (t.length < 2) return "○○";
  return t[0] + "○".repeat(Math.min(t.length - 1, 3));
}

/**
 * 본문 마스킹: 알려진 이름(학생·학부모·상담자) 치환 + 주민번호/휴대폰/유선전화/이메일 패턴 제거.
 * ⚠️ 주민번호를 전화보다 먼저 — 뒷자리가 전화 패턴과 겹칠 때 부분 마스킹으로 남지 않게.
 * ⚠️ 상담 본문은 "지안이가"처럼 **성을 뺀 호칭**이 흔해(실데이터 확인) 전체 이름을 먼저 치환한 뒤
 *    이름부(성 제외, 2자+)도 "○○"로 치환한다. 한 글자 토큰은 일반 음절 오탐이 커서 치환 안 함.
 */
export function maskText(text: string, knownNames: readonly (string | null | undefined)[] = []): string {
  let out = text;
  const fulls: string[] = [];
  for (const n of knownNames) {
    const t = (n ?? "").trim();
    if (t.length < 2) continue;
    fulls.push(t);
    out = out.split(t).join(maskName(t));
  }
  for (const t of fulls) {
    const given = t.slice(1); // 성 제외 이름부(예: 김지안 → 지안)
    // 동명이인 구분 접미사("박채원B")가 저장명에 붙는 관행 — 한글 외 꼬리를 뗀 핵심 이름부도 치환.
    const core = given.replace(/[^가-힣]+$/g, "");
    for (const g of new Set([given, core])) {
      if (g.length < 2) continue;
      out = out.split(g).join("○○");
    }
  }
  // 이관(makeedu) 상담일지 서식: 날짜 줄 바로 다음의 **단독 한글 2~4자 줄**은 기록자 이름(실측 —
  // 직원 명단에 없는 옛 상담사명도 등장). 콜론 붙은 항목명("조치사항:")은 순수 한글 매치가 아니라 안전.
  out = out.replace(/(\d{4}년 \d{1,2}월 \d{1,2}일\s*\n)([가-힣]{2,4})(?=\s*(\n|$))/g, "$1○○○");
  out = out.replace(/\d{6}[-\s]?[1-4]\d{6}/g, "******-*******"); // 주민등록번호
  out = out.replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, "010-****-****"); // 휴대폰
  out = out.replace(/0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/g, "0**-***-****"); // 유선전화(구분자 필수 — 계좌 오탐 방지)
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "***@***"); // 이메일
  return out;
}
