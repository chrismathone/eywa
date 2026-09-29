// 직원 이메일 판별 헬퍼 — 순수 공유 모듈(서버 액션 "use server" 파일은 non-async export 불가라 분리).
export const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * 임포트 산물 이메일인가 — 형식불량(공백 등, "LAB 김주희@imported.local") 또는 @imported.local
 * 플레이스홀더(POC 이관). 이런 이메일만 직원 수정 화면에서 편집을 허용한다(서버도 동일 기준 이중 검증).
 * 실 로그인 이메일(정상 형식 + 실 도메인)은 잠금 유지 — 계정 정체성 오변경 방지.
 */
export function isImportArtifactEmail(email: string): boolean {
  const e = email.trim();
  return !EMAIL_RE.test(e) || e.toLowerCase().endsWith("@imported.local");
}

/**
 * 이 직원의 로그인 이메일을 직원관리에서 고칠 수 있는가.
 *
 * ① 임포트 산물(형식불량·@imported.local) — 애초에 로그인용이 아니다.
 * ② **아직 한 번도 로그인하지 않은 계정** — 초대할 때 낸 오타(`@gmil.com`)를 고치는 유일한 통로다.
 *    실제로 2026-07-23 신규 직원 초대에 도메인 오타가 나 화면에서 못 고쳤다(원장 "이메일 수정 어케함?").
 *    그 계정으로는 아무도 들어온 적이 없으니 "누구의 로그인인지"가 아직 정해지지 않았다 = 바꿔도 정체성 변경이 아니다.
 *
 * ⚠️ **한 번이라도 로그인한 계정은 계속 잠금** — 그건 그 사람의 실제 로그인 수단이라, 화면에서 갈아끼우면
 * 조용한 계정 탈취 통로가 된다(바꿔야 하면 본인 확인 후 Supabase Auth에서).
 */
export function canEditLoginEmail(email: string, everSignedIn: boolean): boolean {
  return isImportArtifactEmail(email) || !everSignedIn;
}

/** 이메일 편집 기본 도메인 — 학원 계정 대부분이 여기라 새로 만들 땐 이걸 고정으로 쓴다. */
export const DEFAULT_EMAIL_DOMAIN = "gmail.com";

/**
 * **자동 생성** 로그인 이메일의 도메인 — 메일함이 없는 로그인 전용 도메인(관리자 `admin7099@login.aywa.co.kr`와 같은 자리).
 * 🔴 예전엔 `gmail.com`이었다 — `kjh@gmail.com`은 대개 **남이 실제로 쓰는 주소**라, 비밀번호 재설정 메일이 그 사람에게
 *    가면 계정이 통째로 넘어간다(보안 감사 2026-09-29). 아이디(이니셜 규칙)는 그대로, 도메인만 바꾼다.
 *    본인 이메일을 적어 낸 직원은 그 주소를 그대로 쓴다(자동 생성은 비었을 때만).
 */
export const AUTO_STAFF_EMAIL_DOMAIN = "login.aywa.co.kr";

// ── 이름 → 로그인 아이디(이니셜) 자동 생성 ────────────────────────────────
// 원장 지시 2026-08-07: 직원 등록 시 "이메일·비밀번호는 자동 생성". 비밀번호는 INITIAL_STAFF_PASSWORD,
// 이메일은 여기서 만든다. 규칙은 이관 스크립트(create-logins-for-staff.mjs)와 **같은 이니셜 표기**를
// 쓴다 — 그때 만든 30명과 새 직원의 주소 모양이 달라지면 명부가 두 종류로 갈린다.
// ⚠️ 도메인만은 2026-09-29부터 다르다(gmail → AUTO_STAFF_EMAIL_DOMAIN, 위 주석) — 아이디(이니셜) 규칙은 같다.
// 초성 로마자(관용: 김=K, 최=C). ㅇ은 소리가 없어 중성(모음) 첫 글자를 쓴다(육→y, 원→w).
const CHO = ["k", "k", "n", "d", "d", "r", "m", "b", "b", "s", "s", "", "j", "j", "c", "k", "t", "p", "h"];
const JUNG = ["a", "a", "y", "y", "e", "e", "y", "y", "o", "w", "w", "o", "y", "u", "w", "w", "w", "y", "e", "e", "i"];

/** 한글 이름 → 이니셜 소문자("김주현"→"kjh"). 한글이 없으면 영문자만 추려 쓰고, 그래도 없으면 "staff". */
export function initialsOf(name: string): string {
  const letters: string[] = [];
  const chars = [...name.replace(/\s+/g, "")];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      if (/[a-zA-Z]/.test(chars[i])) letters.push(chars[i].toLowerCase());
      continue;
    }
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    // 성씨 '이'는 관용상 L(Lee) — 규칙대로면 i가 되어 알아보기 어렵다.
    if (i === 0 && chars[i] === "이") letters.push("l");
    else letters.push(CHO[cho] || JUNG[jung]);
  }
  return letters.join("") || "staff";
}

/**
 * 이름으로 만들 로그인 이메일 후보 — 이미 쓰는 주소(taken)를 피해 `kjh`, `kjh2`, `kjh3`… 순으로.
 * 순수 함수(중복 집합은 호출부가 DB·auth에서 모아 넘긴다) — Vitest로 규칙을 잠근다.
 */
export function autoStaffEmail(name: string, taken: ReadonlySet<string>): string | null {
  const base = initialsOf(name);
  for (let n = 0; n < 50; n++) {
    const candidate = `${base}${n === 0 ? "" : n + 1}@${AUTO_STAFF_EMAIL_DOMAIN}`.toLowerCase();
    if (!taken.has(candidate)) return candidate;
  }
  return null; // 50개까지 다 찼다 = 사람이 개입할 상황(호출부가 경고).
}

/**
 * 이메일을 "아이디 + 도메인"으로 쪼갠다 — 화면에서 **아이디만 고치게** 하기 위한 것(원장 지시 2026-07-30).
 *
 * 도메인을 gmail로 **못 박지 않는 이유**: 네이버 등 다른 도메인을 쓰는 직원이 실제로 있고,
 * 그 사람 이메일을 열었을 때 도메인이 gmail로 바뀌어 있으면 **저장하는 순간 로그인 주소가 조용히 바뀐다.**
 * 그래서 지금 쓰는 도메인을 그대로 고정값으로 들고 오고, 없거나 임시(@imported.local)일 때만 기본값을 쓴다.
 *
 * 임시 주소의 아이디는 사람이 쓸 수 없는 문자열(`sheet-26-…`, `sam 김태건`)인 경우가 많아
 * **깔끔한 형태일 때만** 남기고 아니면 비운다(그대로 두면 그게 새 아이디가 된다).
 */
export function splitEmailForEdit(email: string | null | undefined): { local: string; domain: string } {
  const raw = (email ?? "").trim();
  const at = raw.lastIndexOf("@");
  if (at <= 0) return { local: "", domain: DEFAULT_EMAIL_DOMAIN };
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1).toLowerCase();
  const usable = /^[a-zA-Z0-9._%+-]+$/.test(local);
  if (domain === "imported.local") {
    // 이관이 자동 생성한 아이디(`sheet-26-65579e04`)는 문자 구성만 보면 멀쩡해 보이지만 사람 아이디가 아니다.
    const generated = /^sheet-\d+-/.test(local);
    return { local: usable && !generated ? local : "", domain: DEFAULT_EMAIL_DOMAIN };
  }
  return { local: usable ? local : "", domain: domain || DEFAULT_EMAIL_DOMAIN };
}
