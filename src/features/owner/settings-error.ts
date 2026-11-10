import { settingFieldLabel } from "./settings-diff";
import { isRecord } from "@/lib/guards";

/**
 * 학원 설정 저장의 **화면용 오류 문구** — 순수(Vitest). 일반 지점 화면에 내부 식별자를 내보내지 않는다.
 *
 * 전에는 검증 오류가 `입력값 오류 (subjects.1.monthPlan.notices): Too big: expected string to have <=600 characters`처럼
 * **칸의 경로와 검증 도구의 영문 원문**을 그대로 실었다. 그렇다고 경로와 원문을 통째로 지우면 사용자가 **어느 칸을 어떻게**
 * 고쳐야 하는지 알 수 없다(적대 리뷰 5 C1). 그래서 둘 다 사람 말로 바꾼다:
 *  · 어느 칸인가 — 경로를 **허용 목록의 한글 이름**으로 풀어 적는다(`과목 '영어' · 월간 계획서 · 표 위 안내`).
 *    모르는 키는 건너뛰고, 과목 줄은 사용자가 지은 과목 이름으로 가리킨다. 내부 키·주소는 싣지 않는다.
 *  · 왜 안 되는가 — 오류 종류(길이·개수·범위·형식)에서 한글 사유를 만든다(`600자 이내로 입력해 주세요`).
 *    스키마가 한글로 적어 둔 사유는 그대로 쓰되, **내부 식별자가 섞인 문장은 쓰지 않는다**(C2).
 */

/** 검증 도구(Zod)가 돌려주는 오류 한 건 — 쓰는 칸만. */
export type SettingsIssue = {
  path: PropertyKey[];
  message: string;
  code?: string;
  /** 무엇의 길이·크기인가 — "string" · "array" · "number" …. */
  origin?: string;
  maximum?: number | bigint;
  minimum?: number | bigint;
};

const GENERIC = "값을 확인해 주세요";

/**
 * 검증 문구에**만** 쓰는 칸 이름(섹션의 맨 위 칸) — 감사 기록의 칸 표(`settings-diff.ts`)에 없는 칸들.
 * 🔴 여기 칸을 그 표로 옮기지 말 것 — 그 표의 칸은 변경 내역에 **이전 값·새 값**이 실린다. 자리 출석부 비밀번호처럼
 *    값이 기록에 남으면 안 되는 칸은 이름만 여기에 둔다.
 */
const VALIDATION_ONLY_LABELS: Record<string, Record<string, string>> = {
  profile: {
    bizRegNo: "사업자등록번호",
    legalName: "법인명",
    payslipSigners: "급여명세서 담당자",
  },
  operations: {
    seatPins: "자리 출석부 비밀번호",
    jobTitlesByDepartment: "부서별 직급",
    weekdayGroupings: "요일 묶음",
    hiddenBuiltinWeekdayGroupings: "요일 묶음",
    periodStyle: "교시 표기",
  },
  billing: {
    account: "입금 계좌",
    accounts: "입금 계좌",
  },
  report: {
    title: "보고서 제목",
    footerNote: "꼬리말",
    logoUrl: "보고서 로고",
    videoHomeworkPolicy: "영상 숙제",
    writingExemptTeachers: "작성 제외 강사",
    classnoteSubjects: "발송 대상 과목",
  },
  permissions: {
    overrides: "역할별 메뉴 권한",
    userOverrides: "개인별 메뉴 권한",
    specialAccess: "개인별 기능 권한",
  },
  dashboard: {
    layouts: "역할별 배치",
    assignments: "직원 배정",
  },
};

/** 칸 안쪽의 이름 — 어느 섹션에서든 같은 뜻으로 쓰이는 키만(허용 목록). 없는 키는 문구에 싣지 않는다. */
const NESTED_LABELS: Record<string, string> = {
  label: "이름",
  name: "이름",
  title: "제목",
  body: "내용",
  color: "색",
  startTime: "시작 시각",
  endTime: "종료 시각",
  date: "날짜",
  weekdayPeriods: "평일 교시",
  skillAreas: "영역",
  testMax: "테스트 문항수",
  monthPlan: "월간 계획서",
  bookLegend: "교재 약어 범례",
  notices: "표 위 안내",
  slogan: "꼬리말 한 줄",
  prepTitle: "Prep 안내 제목",
  prepNotes: "Prep 안내 본문",
  bank: "은행",
  holder: "예금주",
  number: "계좌번호",
};


/**
 * 이름 표에서 **제 속성인 문자열만** 꺼낸다 — 키는 사용자가 보낸 경로에서 온다. `constructor`·`toString` 같은 키로
 * 상속된 값(함수)을 이름으로 치면 그 원문이 오류 문구에 섞인다(적대 리뷰 5b B1).
 */
function ownLabel(table: Record<string, string> | undefined, key: string): string | undefined {
  if (!table || !Object.hasOwn(table, key)) return undefined;
  const label = table[key];
  return typeof label === "string" ? label : undefined;
}
/** 보낸 값에서 한 단계 내려간다 — 제 속성만(목록은 번호만). */
function step(parent: unknown, token: PropertyKey): unknown {
  if (Array.isArray(parent)) return typeof token === "number" ? parent[token] : undefined;
  if (isRecord(parent) && typeof token === "string" && Object.hasOwn(parent, token)) return parent[token];
  return undefined;
}

/** 사용자가 지은 이름을 문구에 실을 때 — 한 줄로, 짧게. */
function quoteName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? `'${text.length > 20 ? `${text.slice(0, 20)}…` : text}'` : null;
}

/**
 * 오류가 난 칸을 사람 말로 — `과목 '영어' · 월간 계획서 · 표 위 안내`. 아는 이름만 잇고 모르는 키는 건너뛴다.
 * `input` = 사용자가 보낸 값(그 줄의 이름을 찾는 데만 쓴다 — 사용자가 직접 지은 이름이라 되돌려 보여도 된다).
 */
function locate(section: string, path: PropertyKey[], input: unknown): string | undefined {
  const parts: string[] = [];
  let node: unknown = input;
  path.forEach((token, depth) => {
    node = step(node, token);
    if (typeof token === "number") {
      // 목록의 한 줄 — 이름이 있는 줄(과목 · 영역 · 양식 등)은 그 이름으로, 없으면 차례로 가리킨다.
      const named = isRecord(node) ? quoteName(step(node, "label") ?? step(node, "name") ?? step(node, "title")) : null;
      if (named && parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]} ${named}`;
      else parts.push(`${token + 1}번째`);
      return;
    }
    if (typeof token !== "string") return;
    const label =
      depth === 0
        ? (settingFieldLabel(section, token) ?? ownLabel(Object.hasOwn(VALIDATION_ONLY_LABELS, section) ? VALIDATION_ONLY_LABELS[section] : undefined, token))
        : ownLabel(NESTED_LABELS, token);
    if (label) parts.push(label);
  });
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * 문장에 **내부 식별자**가 섞였는가 — 앱 안의 주소(`/owner?tab=…`) · 밑줄로 이은 키(`teacher_onescreen`) · 쿼리(`?tab=`).
 * 한글이 들어 있다는 것만으로는 화면에 내보내도 되는 문장이 아니다.
 */
const RAW_IDENTIFIER = /\/[a-z]|[a-z0-9]_[a-z0-9]|[?&][a-z]+=/i;

/** 스키마가 적어 둔 사유를 화면에 써도 되는가 — 한글 문장이고 내부 식별자가 없다. */
function safeSaid(message: string): string | null {
  return /[가-힣]/.test(message) && !RAW_IDENTIFIER.test(message) ? message : null;
}

const toNumber = (v: number | bigint | undefined): number | undefined => (typeof v === "bigint" ? Number(v) : v);

/** 오류 종류에서 한글 사유를 만든다(검증 도구의 영문 기본 문구 대신). */
function reasonByKind(issue: SettingsIssue): string {
  const max = toNumber(issue.maximum);
  const min = toNumber(issue.minimum);
  const countable = issue.origin === "array" || issue.origin === "set";
  const numeric = issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint";
  if (issue.code === "too_big" && max !== undefined) {
    if (issue.origin === "string") return `${max}자 이내로 입력해 주세요`;
    if (countable) return `${max}개까지 넣을 수 있습니다`;
    if (numeric) return `${max} 이하로 입력해 주세요`;
  }
  if (issue.code === "too_small" && min !== undefined) {
    if (issue.origin === "string") return min <= 1 ? "비워 둘 수 없습니다" : `${min}자 이상 입력해 주세요`;
    if (countable) return min <= 1 ? "하나 이상 넣어 주세요" : `${min}개 이상 넣어 주세요`;
    if (numeric) return `${min} 이상으로 입력해 주세요`;
  }
  if (issue.code === "invalid_format") return "형식을 확인해 주세요";
  return GENERIC;
}

/**
 * 검증 오류 한 줄 — `입력값 오류 (어느 칸): 왜`.
 * `input`을 주면 목록의 줄을 사용자가 지은 이름으로 가리킨다(없으면 차례로).
 */
export function settingsValidationError(section: string, issue: SettingsIssue | undefined, input?: unknown): string {
  if (!issue) return `입력값 오류: ${GENERIC}`;
  const where = locate(section, issue.path, input);
  const reason = safeSaid(issue.message) ?? reasonByKind(issue);
  return `입력값 오류${where ? ` (${where})` : ""}: ${reason}`;
}

/**
 * DB(쓰기 가드)가 돌려준 한글 사유를 지점 화면 문구로 — 운영자 역할 이름과 괄호 속 내부 식별자를 걷는다.
 * SQL의 문장은 그대로 둔다(마이그레이션 없이 화면에서만 바꾼다).
 */
export function plainSettingsReason(message: string): string {
  return message
    .replace(/원장 또는 총괄만/g, "원장만")
    .replace(/\s*\((?:master|super_admin|tenant_settings|permissions)\)/g, "")
    .trim();
}
