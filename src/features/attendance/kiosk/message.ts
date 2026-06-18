// 학부모 등하원 알림 본문 + 화면/로그용 마스킹 — 순수함수.
// ⚠️ 등하원 알림은 '정보성' 메시지(계약 이행)다. 광고/홍보 문구를 섞으면 광고성으로 재분류되어
//    카카오 템플릿 반려 + 사전 수신동의 의무가 생긴다. 본문은 순수 정보성만 유지할 것.
// retention/message.ts(buildParentMessage) 톤을 미러링하되 등하원 1줄 정보 메시지로 단순화.

export type CheckinKind = "checkin" | "checkout";

/** 키오스크 화면/로그에 학생 이름을 부분 가림(가운데 글자 마스킹). 무차별 입력 시 PII 노출 최소화. */
export function maskName(name: string): string {
  const n = (name ?? "").trim();
  if (n.length <= 1) return n;
  if (n.length === 2) return `${n[0]}○`;
  return `${n[0]}${"○".repeat(n.length - 2)}${n[n.length - 1]}`;
}

/** 전화번호 가운데 4자리 마스킹(로그 보관용). 비정규 포맷도 숫자만 추출해 처리. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return "***";
  const head = d.slice(0, d.length - 8 >= 0 ? 3 : Math.max(0, d.length - 4));
  const tail = d.slice(-4);
  return `${head}-****-${tail}`;
}

/** 학부모 알림톡(정보성) 본문. 발송 대상=학부모이므로 자녀 실명을 그대로 사용. */
export function buildAttendanceMessage(opts: {
  studentName: string;
  kind: CheckinKind;
  time: string; // "HH:MM"
  academyName: string;
}): string {
  const academy = opts.academyName || "학원";
  const verb = opts.kind === "checkin" ? "등원" : "하원";
  return `[${academy}] ${opts.studentName} 학생이 ${opts.time}에 ${verb}하였습니다.`;
}
