// ① 모델 체크리스트 → 코드가 정하는 제안·상태(순수). 모델이 인용한 문장은 근거 글에 그대로 있어야 하고,
// 강사 평가에서 빠지는 사유는 그 사실을 말하는 낱말이 인용 안에 있어야 한다. 기록된 분류와 다른 대분류는 '충돌'로 올린다.
import { REASON_DETAILS } from "@/features/withdrawals/reason-detail";
import { REASON_LABEL, type WithdrawalReason } from "@/features/withdrawals/types";
import { evidenceMap, locateQuote, type WdRecord } from "./card";
import { EXCLUDED_DEFAULT } from "./guideline";
import { recordedCategories, recordedReasons } from "./recorded";

export type Checklist = {
  recorded_category?: string | null;
  reason?: string | null;
  detail?: string | null;
  memo?: string | null;
  evidence?: { src?: string; quote?: string }[];
  conflict?: boolean;
  /** v3 — 규칙 4의 어느 경우인지("1"·"2"·"3"). 코드가 기록된 분류와 맞춰 본다. */
  conflict_case?: string | number | null;
  conflict_note?: string | null;
};
export type Status = "제안" | "충돌" | "근거 부족" | "보류(개인정보)";
export type Proposal = {
  sid: string; status: Status; reason: WithdrawalReason | null; detail: string | null; memo: string | null;
  evidence: { src: string; quote: string }[]; notes: string[]; quoteChecked: number; quoteFailed: number;
};

// 빠지는 사유는 이 낱말이 인용 안에 직접 있어야 한다(규칙 5 — 코드가 다시 본다).
const EXCLUDED_WORDS: Record<string, RegExp> = {
  graduated: /졸업|고3.{0,6}(마지막|끝)|수능/,
  relocation: /이사|전학|이주|이민/,
  illness: /아프|아파|아픈|아팠|병원|병명|병이|질병|수술|입원|질환|건강|우울|치료|진단|몸이|몸 상태|컨디션|다쳐|다친|부상|골절/,
  advised: /권고|퇴원\s*조치|퇴원\s*통보|그만\s*(다니|두)(라|시라|도록\s*권|게\s*하)|나가\s*달라/,
};
const VAGUE_MEMO = /^(기타|모름|없음|퇴원|미상|-|\.)?$/;

export function decide(r: WdRecord, c: Checklist | null): Proposal {
  const p: Proposal = { sid: r.sid, status: "근거 부족", reason: null, detail: null, memo: null, evidence: [], notes: [], quoteChecked: 0, quoteFailed: 0 };
  if (r.held) return { ...p, status: "보류(개인정보)", notes: ["전송 금지 정보 의심 — 보내지 않음"] };
  if (!c) return { ...p, notes: ["모델 응답 없음"] };
  const map = evidenceMap(r);
  if (!map.size) return { ...p, notes: ["이번 퇴원의 근거 자료 없음"] };
  for (const e of c.evidence ?? []) {
    if (!e?.src || !e?.quote) continue;
    p.quoteChecked++;
    const at = locateQuote(map, e.src, e.quote);
    if (at) p.evidence.push({ src: at, quote: e.quote.trim() });
    else { p.quoteFailed++; p.notes.push(`인용 불일치 ${e.src}`); }
  }
  const reason = String(c.reason ?? "").trim();
  const candidate = Object.hasOwn(REASON_LABEL, reason) ? (reason as WithdrawalReason) : null;
  // 충돌은 사유 판정보다 먼저 — 충돌이면 후보 사유를 함께 보이고(적용 대상 아님) 사람이 고른다.
  const rec = recordedReasons(r);
  if (rec.length > 1) return { ...p, status: "충돌", reason: candidate, notes: [...p.notes, `기록된 분류끼리 다름: ${rec.map((x) => REASON_LABEL[x]).join(" ↔ ")}`] };
  // v3: 기록된 분류가 하나라도 있는데 '분류 없이 이유가 둘'(③)이라는 충돌은 성립하지 않는다 → 규칙 3(기록된 분류를 따른다).
  const recordedRaw = recordedCategories(r);
  const caseNo = String(c.conflict_case ?? "").replace(/[^123]/g, "");
  if (c.conflict && caseNo === "3" && rec.length === 1) {
    const hit = recordedRaw.find((x) => x.hit?.reason === rec[0])!;
    p.notes.push(`모델 충돌(③)은 기록된 분류 '${hit.text}'가 있어 성립 안 함 → 기록된 분류를 따름`);
    if (!p.evidence.some((e) => e.src === hit.src)) p.evidence.push({ src: hit.src, quote: hit.text });
    return finish(p, rec[0], c.detail, c.memo ?? hit.hit?.memo ?? null, rec);
  }
  if (c.conflict) {
    if (!p.evidence.length) return { ...p, notes: [...p.notes, "충돌이라 했지만 확인된 근거 문장 없음"] };
    return { ...p, status: "충돌", reason: candidate, notes: [...p.notes, `모델: ${String(c.conflict_note ?? "자료가 서로 다름").slice(0, 80)}`] };
  }
  if (!candidate) return { ...p, notes: [...p.notes, reason && reason !== "unknown" ? `모르는 사유 '${reason}'` : "사유를 알 수 없음"] };
  return finish(p, candidate, c.detail, c.memo, rec);
}

/** 사유가 정해진 뒤의 검사 — 근거 · 세부 소속 · 기타 메모 · 빠지는 사유의 증거 낱말 · 기록된 분류와의 일치. */
function finish(p: Proposal, key: WithdrawalReason, detail: string | null | undefined, memo: string | null | undefined, rec: WithdrawalReason[]): Proposal {
  if (!p.evidence.length) return { ...p, notes: [...p.notes, "확인된 근거 문장 없음"] };
  p.reason = key;
  const det = String(detail ?? "").trim();
  if (det && REASON_DETAILS[key].some((d) => d.key === det)) p.detail = det;
  else if (det && det !== "null") p.notes.push(`세부 '${det}'는 이 대분류가 아님 — 비움`);
  if (key === "other") {
    // 기준 문서의 안내 괄호('(원장 확인 대상)')를 모델이 메모로 옮기는 일이 있다(실측) — 저장되는 메모에 내부 안내가 섞이지 않게 뗀다.
    const m = String(memo ?? "").replace(/\s*\(?\s*원장 확인 대상\s*\)?/g, "").trim();
    if (VAGUE_MEMO.test(m)) return { ...p, reason: null, detail: null, status: "근거 부족", notes: [...p.notes, "'기타'인데 실제 사유가 없음"] };
    p.memo = m.slice(0, 40);
  }
  if (EXCLUDED_DEFAULT.includes(key) && !p.evidence.some((e) => EXCLUDED_WORDS[key].test(e.quote))) {
    return { ...p, reason: null, detail: null, status: "근거 부족", notes: [...p.notes, `'${REASON_LABEL[key]}'를 직접 말하는 문장 없음(강사 평가 제외 사유라 보수적으로)`] };
  }
  if (rec.length === 1 && rec[0] !== key) { p.status = "충돌"; p.notes.push(`기록된 분류(${REASON_LABEL[rec[0]]})와 다름`); return p; }
  p.status = "제안";
  return p;
}
