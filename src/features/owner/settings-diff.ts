/**
 * 학원 설정 저장의 **변경 내역 요약**(순수, Vitest) — 감사로그 metadata에 실린다.
 *
 * 🔴 왜(원장 지시 2026-08-27 *"학원 설정의 감사 로그에 추적되지 않는 데이터 있나 점검"*):
 *    `owner_settings_update`는 지금까지 `{section}`만 남겨서 "누가 언제 운영 체계를 저장했다"뿐이었고
 *    **무엇이 어떻게 바뀌었는지는 복원할 수 없었다**(권한 매트릭스 변경조차). 반 수정 감사로그가
 *    2026-08-05에 같은 이유로 "어디서 → 어디로"를 넣은 것과 같은 결이다.
 *
 * 규약:
 *  · 표시 문자열(한글 라벨·값)은 **저장 시점에 굳힌다** — 감사로그는 시점 스냅샷이라 나중에 과목명·메뉴
 *    라벨이 바뀌어도 그때 무엇을 했는지가 남아야 한다(`operating_periods_save`와 같은 방식).
 *  · **라벨을 모르는 필드는 아예 싣지 않고 개수만**(`others`) 센다 — 화면에 `brandColor` 같은 영문 키를
 *    내보내지 않기 위해서다(raw 코드 노출 금지).
 *  · 비밀·긴 문자열(발신키·시트ID·약관 본문)은 **값 대신 "변경됨"** — 감사로그가 자격증명 사본이 되면 안 된다.
 *  · 최대 `MAX_CHANGES`개까지만 담고 나머지는 `others`로 — metadata가 무한정 커지지 않게.
 */
import { MENU_LABEL } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { MODULES } from "@/lib/modules";
import { CHINSAN_SCHOOL_SAVE_ALIASES } from "@/features/schools/school-name";

export type SettingChange = { label: string; from?: string; to?: string; note?: string };
export type SettingsDiff = { changes: SettingChange[]; others: number };

export const MAX_CHANGES = 12;

/** 값 대신 "변경됨"으로만 남기는 필드(자격증명·외부 식별자·장문 약관). */
const OPAQUE_FIELDS = new Set([
  "alimtalkSenderKey",
  "kakaoChannelId",
  "googleSheetId",
  "logoUrl",
  "sealUrl",
  "privacyTerms",
  "serviceTerms",
  "printHeader",
]);

/** 섹션별 필드 한글 라벨 — 없는 키는 싣지 않는다(others로만 카운트). */
const FIELD_LABELS: Record<string, Record<string, string>> = {
  profile: {
    name: "학원 이름",
    branchLabel: "지점 표기",
    logoText: "로고 문구",
    logoUrl: "로고 이미지",
    sealUrl: "직인 이미지",
    brandColor: "브랜드 색",
    representativeName: "대표자",
    phone: "대표 전화",
    email: "대표 이메일",
    address: "주소",
  },
  operations: {
    schoolSaveAliases: "학교명 저장 별칭",
    subjects: "과목",
    gradeLevels: "학년",
    jobTitles: "직급",
    weekdayPeriods: "평일 교시",
    weekendPeriods: "주말 교시",
    holidays: "휴원일",
    terms: "학기",
    shuttle: "셔틀 설정",
  },
  billing: {
    dueDay: "납부일",
    latePolicy: "연체 안내",
    taxMode: "세금 처리",
    defaultMethod: "기본 결제수단",
    sessionPrices: "공통 회당 단가",
    eieMonthlyPrice: "EiE 월 수강료",
  },
  notifications: {
    alimtalkSenderKey: "알림톡 발신키",
    kakaoChannelId: "카카오 채널 ID",
    googleSheetId: "구글 시트 ID",
    printHeader: "인쇄물 머리글",
    privacyTerms: "개인정보 동의문",
    serviceTerms: "환불·학칙 동의문",
  },
  consultations: {
    templates: "상담 양식",
  },
  navigation: {
    // 줄마다 목적지 주소(href)라 이름이 없다 → diffArray가 "N개 → M개"까지만 남긴다.
    // 주소를 감사로그에 그대로 싣지 않는 건 의도 — 화면에 raw 경로를 내보내지 않는다.
    menus: "관리자뷰 메뉴 표시·순서",
    teacherMenus: "강사뷰 메뉴 표시·순서",
  },
  modules: {
    // 끈 모듈 id 목록 — 아래 diffModules가 한국어 기능 이름으로 "켬/끔"을 적는다(영문 id를 싣지 않는다).
    disabled: "기능 켜기·끄기",
  },
  report: {
    allowTeacherTestMax: "강사 문항수 변경 허용",
    classnoteSendWindowStart: "발송 시작 시각",
    classnoteSendWindowEnd: "발송 종료 시각",
    noticeMode: "공지 방식",
    subjects: "대상 과목",
  },
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 스칼라 표시값 — 길면 자른다(비밀 필드는 애초에 이 함수를 안 탄다). */
function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "없음";
  if (typeof v === "boolean") return v ? "켬" : "끔";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 40) + "…" : v;
  return "변경됨";
}

/** 배열 원소의 이름(라벨/키/문자열) — 추가·삭제 요약에 쓴다. */
function nameOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (isObj(v)) {
    for (const k of ["label", "name", "title", "key", "id"]) {
      const x = v[k];
      if (typeof x === "string" && x.trim()) return x;
    }
  }
  return null;
}

/** 배열 변화 → "4개 → 5개" + 추가/삭제된 이름(있을 때만). 개수·이름이 같으면 "내용 변경". */
function diffArray(label: string, before: unknown[], after: unknown[]): SettingChange {
  const beforeNames = before.map(nameOf).filter((v): v is string => !!v);
  const afterNames = after.map(nameOf).filter((v): v is string => !!v);
  const added = afterNames.filter((n) => !beforeNames.includes(n));
  const removed = beforeNames.filter((n) => !afterNames.includes(n));
  if (before.length === after.length && added.length === 0 && removed.length === 0) {
    return { label, note: "내용 변경" };
  }
  const parts: string[] = [];
  if (added.length) parts.push(`추가 ${added.slice(0, 3).join("·")}${added.length > 3 ? " 외" : ""}`);
  if (removed.length) parts.push(`삭제 ${removed.slice(0, 3).join("·")}${removed.length > 3 ? " 외" : ""}`);
  return {
    label,
    from: `${before.length}개`,
    to: `${after.length}개`,
    ...(parts.length ? { note: parts.join(" · ") } : {}),
  };
}

/**
 * 새로 생긴 칸의 첫 저장이 **어느 프리셋이든 그 기본값과 같은가** — 그렇다면 사람이 바꾼 것이 아니다.
 * (침산 = 일중→대구일중 · 두 교시 묶음 / 새 학원 = 빈 목록 · 교시마다 한 줄. 침산 저장은 애초에 기본값을 행에 안 남긴다 — preset.ts.)
 */
function isFirstSaveOfNewDefault(section: string, key: string, after: unknown): boolean {
  if (section === "operations" && key === "schoolSaveAliases") {
    const s = JSON.stringify(after);
    return s === JSON.stringify(CHINSAN_SCHOOL_SAVE_ALIASES) || s === "[]";
  }
  if (section === "operations" && key === "periodStyle") return after === "chinsan" || after === "plain";
  return false;
}

/** 기능(모듈) 켜기·끄기 변화 — 끈 목록의 차이를 "켬 …/끔 …"으로. 모르는 id는 이름이 없어 빠진다. */
function diffModules(label: string, before: unknown[], after: unknown[]): SettingChange {
  const nameOfModule = (v: unknown): string | null =>
    typeof v === "string" && v in MODULES ? MODULES[v as keyof typeof MODULES].label : null;
  const was = new Set(before.filter((v): v is string => typeof v === "string"));
  const now = new Set(after.filter((v): v is string => typeof v === "string"));
  const turnedOff = [...now].filter((v) => !was.has(v)).map(nameOfModule).filter((v): v is string => !!v);
  const turnedOn = [...was].filter((v) => !now.has(v)).map(nameOfModule).filter((v): v is string => !!v);
  const parts: string[] = [];
  if (turnedOn.length) parts.push(`켬 ${turnedOn.join("·")}`);
  if (turnedOff.length) parts.push(`끔 ${turnedOff.join("·")}`);
  return { label, note: parts.length ? parts.join(" · ") : "내용 변경" };
}

const menuKo = (v: unknown): string | null =>
  typeof v === "string" ? ((MENU_LABEL as Record<string, string>)[v] ?? null) : null;
const roleKo = (v: unknown): string | null =>
  typeof v === "string" ? ((ROLE_LABEL as Record<string, string>)[v] ?? null) : null;
const accessKo = (v: unknown): string =>
  v === "full"
    ? "쓰기"
    : v === "scoped"
      ? "담당분"
      : v === "readonly"
        ? "조회"
        : v === "none"
          ? "차단"
          : "기본값";

/**
 * 권한 섹션은 **역할×메뉴 한 칸 단위**로 비교한다 — "권한 저장" 한 줄로는 누구에게 무엇이 열렸는지
 * 알 수 없고, 그게 이 섹션에서 가장 알아야 할 사실이다.
 */
function diffPermissions(before: unknown, after: unknown): SettingsDiff {
  const rows = (v: unknown): Map<string, { label: string; access: unknown }> => {
    const out = new Map<string, { label: string; access: unknown }>();
    if (!isObj(v)) return out;
    for (const o of Array.isArray(v.overrides) ? v.overrides : []) {
      if (!isObj(o)) continue;
      const role = roleKo(o.role);
      const menu = menuKo(o.menu);
      if (!role || !menu) continue; // 라벨을 모르면 안 싣는다(영문 키 노출 금지)
      out.set(`role:${String(o.role)}:${String(o.menu)}`, {
        label: `${role} · ${menu}`,
        access: o.access,
      });
    }
    for (const o of Array.isArray(v.userOverrides) ? v.userOverrides : []) {
      if (!isObj(o)) continue;
      const menu = menuKo(o.menu);
      if (!menu || typeof o.userId !== "string") continue;
      out.set(`user:${o.userId}:${String(o.menu)}`, {
        label: `개인 예외 · ${menu}`,
        access: o.access,
      });
    }
    return out;
  };
  const b = rows(before);
  const a = rows(after);
  const changes: SettingChange[] = [];
  let others = 0;
  for (const [k, v] of a) {
    const prev = b.get(k);
    if (prev && prev.access === v.access) continue;
    if (changes.length < MAX_CHANGES) {
      changes.push({
        label: v.label,
        from: prev ? accessKo(prev.access) : "기본값",
        to: accessKo(v.access),
      });
    } else others += 1;
  }
  for (const [k, v] of b) {
    if (a.has(k)) continue;
    if (changes.length < MAX_CHANGES) {
      changes.push({ label: v.label, from: accessKo(v.access), to: "기본값(예외 해제)" });
    } else others += 1;
  }
  return { changes, others };
}

/**
 * 섹션 저장 전/후를 비교해 사람이 읽는 변경 목록을 만든다.
 * ⚠️ `before`가 없으면(첫 저장) 빈 목록 — 전 필드가 "없음 → 값"으로 쏟아지면 소음이 된다.
 */
export function diffSettingsSection(section: string, before: unknown, after: unknown): SettingsDiff {
  if (section === "permissions") return diffPermissions(before, after);
  if (!isObj(before) || !isObj(after)) return { changes: [], others: 0 };
  const labels = FIELD_LABELS[section] ?? {};
  const changes: SettingChange[] = [];
  let others = 0;
  for (const key of Object.keys(after)) {
    const a = after[key];
    // 강사뷰 구성(2026-09-22)은 옛 행에 키 자체가 없다 — 없음을 빈 목록으로 읽는다. 관리자뷰만 고쳐 저장해 빈 목록이
    // 처음 실리는 것은 변경이 아니고(아래 비교에서 같음), 처음 정하면 "없음 → 변경됨"이 아니라 "0개 → N개"로 적힌다.
    const b = before[key] === undefined && section === "navigation" && key === "teacherMenus" ? [] : before[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    // 이 작업(2026-09-22 일반판 분리)이 새로 만든 칸이 **처음 저장되며 기본값 그대로** 실리는 것은 변경이 아니다 —
    // 침산이 운영 체계를 저장할 때마다 감사로그에 "외 1건"이 붙으면 침산 기록에 흔적이 남는다(원장: 아무 일도 없던 것처럼).
    if (b === undefined && isFirstSaveOfNewDefault(section, key, a)) continue;
    const label = labels[key];
    if (!label || changes.length >= MAX_CHANGES) {
      others += 1; // 라벨 미등록 필드(영문 키 노출 금지) 또는 상한 초과
      continue;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (section === "modules" && key === "disabled") {
        changes.push(diffModules(label, b, a));
        continue;
      }
      if (section === "billing" && key === "sessionPrices") {
        const prices = (rows: unknown[]) => rows
          .filter(isObj)
          .map((row) => `${showValue(row.price)}원${row.label ? ` (${showValue(row.label)})` : ""}`)
          .join(" · ");
        changes.push({ label, from: prices(b), to: prices(a) });
        continue;
      }
      changes.push(diffArray(label, b, a));
      continue;
    }
    if (OPAQUE_FIELDS.has(key) || isObj(a) || isObj(b)) {
      changes.push({ label, note: a === null || a === "" ? "지움" : "변경됨" });
      continue;
    }
    changes.push({ label, from: showValue(b), to: showValue(a) });
  }
  // ⚠️ **사라진 키**도 변경이다(선택 필드를 비우면 키 자체가 없어진다) — after만 훑으면 조용히 놓친다.
  for (const key of Object.keys(before)) {
    if (key in after) continue;
    const label = labels[key];
    if (!label || changes.length >= MAX_CHANGES) {
      others += 1;
      continue;
    }
    changes.push({ label, note: "지움" });
  }
  return { changes, others };
}

/** 감사로그 화면 한 줄 — `라벨 이전 → 이후` / `라벨(내용 변경)`. */
export function formatSettingChange(c: SettingChange): string {
  const arrow = c.from !== undefined && c.to !== undefined ? `${c.from} → ${c.to}` : null;
  const tail = [arrow, c.note].filter(Boolean).join(", ");
  return tail ? `${c.label} ${tail}` : c.label;
}
