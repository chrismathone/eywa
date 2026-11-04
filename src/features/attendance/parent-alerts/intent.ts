/**
 * 학부모 연락(클래스노트) → **출결 의도** 추출의 순수 로직 (IO 없음 · Vitest 대상).
 *
 * 원장 2026-08-06: *"오늘 결석한다, 언제부터 언제까지 결석한다. 일찍간다. 늦게 간다 같은 메시지를 잘
 * 필터링해서 정리하는거지."* — 이 파일이 그 "잘"의 규칙을 담는다.
 *
 * ⚠️ **왜 키워드가 아니라 AI인가**(2026-08-06 실측이 결론을 뒤집음): 정규식은 한국어 활용형에서 샌다 —
 * "오늘 연재 수업에 **못갈것** 같아요"는 '못가'와 글자가 안 겹쳐 놓치고(실제 결석 통보였다), 반대로
 * "보강 언제까지 하나요"·"늦게 확인했네요"·"두시간 일찍 갔었는데"는 오탐으로 잡힌다. 하루 물량이
 * 수십 건이라 모델 비용은 사실상 0이므로 판단은 모델에 맡기고, **여기서는 모델 출력을 조인다.**
 *
 * 🔴 이 모듈의 존재 이유 = **후검증**. 모델이 준 값을 그대로 믿지 않는다(`buildFormPatch` 하네스와 같은 취지):
 *  - 카테고리가 우리가 아는 4개가 아니면 `none`(=알리지 않음)으로 떨어뜨린다.
 *  - 날짜가 형식·상식 범위를 벗어나면 **버린다**(연도 환각이 흔하다 — 지난해 날짜로 "오늘 결석"이 오면
 *    명단에서 사라진다). 버린 자리는 "연락일 기준"으로 표시하되 **추정임을 화면에 드러낸다**.
 *  - 시작보다 이른 종료는 하루짜리로 접는다.
 *
 * 🔴 분류는 **제안**이지 판정이 아니다 — 알림·화면은 항상 `content`(원문)를 함께 싣는다. 오분류가
 *    "아이를 두고 가는" 결과로 이어지면 안 되므로 최종 판단은 사람이 원문으로 한다.
 */

/** 출결 의도 4종. `none` = 출결과 무관한 연락(인사·교재·상담 문의 등) → 알리지 않는다. */
export const ATTENDANCE_CATEGORIES = ["absence", "late", "early_leave", "none"] as const;
export type AttendanceCategory = (typeof ATTENDANCE_CATEGORIES)[number];

/** 알림 유형 키 — notifications.type. */
export const ATTENDANCE_ALERT_TYPE = "student_attendance_notice";

/** 화면·알림에 쓰는 한글 라벨(⚠️ raw enum을 UI에 그대로 내보내지 않는다 — CLAUDE.md 표시 규칙). */
export function attendanceCategoryLabel(category: AttendanceCategory): string {
  switch (category) {
    case "absence":
      return "결석";
    case "late":
      return "지각";
    case "early_leave":
      return "조퇴";
    default:
      return "일반 연락";
  }
}

export type ParentIntent = {
  category: AttendanceCategory;
  /** 결석·지각·조퇴가 시작되는 날(YYYY-MM-DD). 모델이 못 줬으면 연락일로 채우고 `dateAssumed`가 선다. */
  startsOn: string | null;
  /** 기간의 마지막 날. 하루짜리면 startsOn과 같다. */
  endsOn: string | null;
  /** 한 줄 요약(사유·시각). 원문에 있는 말만. */
  detail: string | null;
  /** 날짜를 모델이 못 줘서 **연락일로 가정**했다 → 화면이 "연락일 기준"이라고 밝혀야 한다. */
  dateAssumed: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 며칠 전까지 거슬러 인정하나 — 어제 일을 오늘 알리는 경우가 있어 1일은 연다. */
const PAST_TOLERANCE_DAYS = 1;
/** 며칠 앞까지 인정하나 — "8월 2일~18일 가족여행" 류가 실제로 온다. 그보다 먼 미래는 연도 환각으로 본다. */
const FUTURE_TOLERANCE_DAYS = 120;

/** ISO 날짜(YYYY-MM-DD) → 일 단위 정수. Date 파싱을 피해 시간대 이동을 원천 차단한다. */
function toDayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
}

function cleanDate(value: unknown, messageDate: string): string | null {
  const s = String(value ?? "").trim();
  if (!ISO_DATE.test(s)) return null;
  if (!ISO_DATE.test(messageDate)) return s; // 기준일이 없으면 범위 검사를 못 한다(형식만 통과)
  const diff = toDayNumber(s) - toDayNumber(messageDate);
  if (diff < -PAST_TOLERANCE_DAYS || diff > FUTURE_TOLERANCE_DAYS) return null; // 상식 밖 = 환각
  return s;
}

function cleanText(value: unknown, max: number): string | null {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 모델 출력 → 검증된 의도.
 *
 * @param raw 모델이 준 객체(무엇이든 들어올 수 있다고 가정한다)
 * @param messageDate 학부모가 그 글·댓글을 남긴 날(YYYY-MM-DD, KST) — 상대 표현("오늘")의 기준이자 범위 가드의 축
 */
export function normalizeIntent(raw: unknown, { messageDate }: { messageDate: string }): ParentIntent {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawCategory = String(obj.category ?? "").trim();
  const category = (ATTENDANCE_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as AttendanceCategory)
    : "none";

  if (category === "none") {
    return { category: "none", startsOn: null, endsOn: null, detail: null, dateAssumed: false };
  }

  let startsOn = cleanDate(obj.startsOn, messageDate);
  let endsOn = cleanDate(obj.endsOn, messageDate);
  // 종료만 있고 시작이 없으면 종료를 시작으로 본다(기간의 한쪽만 읽힌 경우).
  if (!startsOn && endsOn) startsOn = endsOn;

  // 날짜를 못 건졌으면 **연락일**로 둔다 — 학부모 연락의 대다수가 당일 건이라 이게 가장 덜 틀리지만,
  // 추정이라는 사실을 반드시 화면에 드러낸다(dateAssumed).
  const dateAssumed = !startsOn;
  if (!startsOn) startsOn = ISO_DATE.test(messageDate) ? messageDate : null;
  if (!endsOn) endsOn = startsOn;
  // 거꾸로 된 기간은 하루짜리로 접는다(모델이 시작·끝을 바꿔 쓴 경우).
  if (startsOn && endsOn && toDayNumber(endsOn) < toDayNumber(startsOn)) endsOn = startsOn;

  return { category, startsOn, endsOn, detail: cleanText(obj.detail, 60), dateAssumed };
}

/** 이 의도가 알림 대상인가 — `none`은 벨을 울리지 않는다(하루 절반이 인사·문의라 경보 피로가 된다). */
export function isAttendanceIntent(intent: Pick<ParentIntent, "category">): boolean {
  return intent.category !== "none";
}

/** "8/6" · "8/8~8/18" — 연도는 같은 해면 생략(좁은 벨에서 길면 본문이 밀린다). */
export function describeWhen(intent: Pick<ParentIntent, "startsOn" | "endsOn">): string {
  const { startsOn, endsOn } = intent;
  if (!startsOn) return "";
  const short = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  if (!endsOn || endsOn === startsOn) return short(startsOn);
  return `${short(startsOn)}~${short(endsOn)}`;
}

/**
 * 원문에 적힌 날짜 중 **판정 구간이 못 담은 날**을 찾는다 (2026-08-07 실사고).
 *
 * 🔴 실제로 이렇게 샜다: *"8월 7일 (오늘) 이랑 8월 11일, 8월 12일에 개인일정으로 학원 못 옵니다"* →
 * 판정 `8/12~8/12`, 벨 제목 "이수빈 결석 8/12". **오늘 결석이 제목에서 사라졌다.** 표가 단일 구간
 * (starts~ends)이라 흩어진 복수 날짜를 담을 수 없고, 그래서 모델은 그중 하나만 남긴다.
 *
 * 🔴 **날짜를 고쳐 쓰지 않는다.** 원문에서 뽑은 날짜로 판정을 당기면 *"8월 7일에 보강 될까요? 8월 12일은
 * 결석입니다"* 같은 문장에서 오늘을 결석으로 만들어 **셔틀이 아이를 두고 간다**(이 기능이 가장 피해야 할
 * 방향). 그래서 여기서는 **"원문에 다른 날짜도 있다"고 사람에게 알리기만** 한다 — 최종 판단은 원문으로.
 *
 * 뽑는 표기: `8월 7일` · `8/7` · 그리고 앞에 달이 나온 뒤의 `12일`(달을 승계). 달 없는 맨 `3일`은
 * 뽑지 않는다 — "보강은 **3일**을 해야되니"(실제 문장)를 날짜로 오인하기 때문이다.
 *
 * @returns "8/7"·"8/11" 형태의 짧은 라벨(이른 순, 중복 제거). 없으면 빈 배열.
 */
export function uncoveredDatesIn(
  content: string,
  intent: Pick<ParentIntent, "startsOn" | "endsOn">,
  { messageDate }: { messageDate: string },
): string[] {
  const text = String(content ?? "");
  if (!ISO_DATE.test(messageDate)) return [];
  const baseYear = Number(messageDate.slice(0, 4));
  const baseDay = toDayNumber(messageDate);

  const found: number[] = [];
  let lastMonth: number | null = null;
  // 한 번의 스캔으로 세 표기를 순서대로 훑는다 — 달 승계(`8월 11일, 12일`)를 하려면 등장 순서가 필요하다.
  const token = /(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{1,2})\s*\/\s*(\d{1,2})|(\d{1,2})\s*일/g;
  for (const m of text.matchAll(token)) {
    let month: number | null = null;
    let day: number | null = null;
    if (m[1] && m[2]) [month, day] = [Number(m[1]), Number(m[2])];
    else if (m[3] && m[4]) [month, day] = [Number(m[3]), Number(m[4])];
    else if (m[5] && lastMonth !== null) [month, day] = [lastMonth, Number(m[5])];
    if (month === null || day === null) continue;
    lastMonth = month;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    // 연도는 원문에 거의 안 적힌다 → 연락일의 해로 보되, 그러면 한참 과거가 되는 경우(12월 연락 ↔ 1월 일정)만 다음 해로.
    let iso = `${baseYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (toDayNumber(iso) < baseDay - 60) iso = `${baseYear + 1}-${iso.slice(5)}`;
    if (!cleanDate(iso, messageDate)) continue; // 지난 일·먼 미래는 셔틀에 쓸모없다(같은 상식 가드 재사용)
    found.push(toDayNumber(iso));
  }
  if (!found.length) return [];

  const from = intent.startsOn && ISO_DATE.test(intent.startsOn) ? toDayNumber(intent.startsOn) : null;
  const to = intent.endsOn && ISO_DATE.test(intent.endsOn) ? toDayNumber(intent.endsOn) : from;
  const covered = (d: number) => from !== null && to !== null && d >= from && d <= to;

  const out = [...new Set(found.filter((d) => !covered(d)))].sort((a, b) => a - b);
  return out.map((d) => {
    const date = new Date(d * 86_400_000);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  });
}

/**
 * 원문이 **어느 반 보드에 · 글인지 댓글인지** — 벨 본문의 원문 앞머리(원장 2026-11-04).
 *
 * 🔴 '학부모'라고 적지 않는다: 원문 표(`classnote_parent_messages`)에는 작성자 칸이 없다. ClassNote 가족 계정으로
 *    **학생이 직접** 쓴 글·댓글도 같은 길로 들어오는데(11-04 '김동리 학생' 댓글이 '학부모'로 떴다) 누가 썼는지는 모른다.
 *    반 이름(`class_name`) = 연동 PC가 그 글이 올라온 ClassNote 반(보드) 이름을 적은 값 · 글/댓글 = `source`('post'·'comment').
 * 🔑 반 이름 뒤에 **'보드에'**를 붙여 장소임을 밝힌다 — 1인 보드 이름은 `(수학)김동리`라 `(수학)김동리 댓글`이면
 *    "김동리가 쓴 댓글"로 읽힌다(그 보드엔 학부모도 쓴다 · 리뷰 2026-11-04). 둘 다 모르면 '원문'.
 */
export function parentMessageOrigin(source: string | null | undefined, className: string | null | undefined): string {
  const cls = String(className ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const kind = source === "comment" ? "댓글" : source === "post" ? "글 작성" : null;
  if (!cls) return kind ?? "원문";
  return kind ? `${cls} 보드에 ${kind}` : `${cls} 보드 원문`;
}

/**
 * 벨 알림 문구 — **원문을 반드시 싣는다.**
 * 강사·차량팀이 클래스노트를 열지 않고도 판단할 수 있어야 한다는 게 인바운드 알림의 원칙이고,
 * 여기선 한 겹 더해서 "분류가 틀렸을 때 사람이 알아챌 수 있어야 한다"는 이유도 있다.
 * 원문 앞에는 어느 반 보드의 글인지 댓글인지를 붙인다(`parentMessageOrigin` — 작성자는 모르므로 적지 않는다).
 *
 * ⚠️ 판정이 못 담은 날짜가 원문에 있으면 제목·본문에 그 사실을 적는다(`uncoveredDatesIn` 주석 참조) —
 *    제목만 훑는 차량팀이 "오늘"을 놓치지 않게. 단정하지 않고 "원문 확인"으로만 말한다.
 */
export function buildAttendanceAlert({
  studentName,
  intent,
  content,
  messageDate,
  source,
  className,
}: {
  studentName: string;
  intent: ParentIntent;
  content: string;
  /** 연락일(KST). 원문 날짜를 푸는 축 — 없으면 다른 날짜 안내를 생략한다(지어내지 않는다). */
  messageDate?: string;
  /** 원문 종류 — 'post'(글 작성) · 'comment'(댓글). 모르면 생략. */
  source?: string | null;
  /** 원문이 올라온 ClassNote 반 이름(연동 PC가 적은 값). 모르면 생략. */
  className?: string | null;
}): { title: string; body: string } {
  const when = describeWhen(intent);
  const assumed = intent.dateAssumed ? "(연락일 기준)" : "";
  const others = messageDate ? uncoveredDatesIn(content, intent, { messageDate }) : [];
  const alsoTitle = others.length ? ` ⚠️${others.join("·")} 확인` : "";
  const title = `${studentName} ${attendanceCategoryLabel(intent.category)}${when ? ` ${when}${assumed}` : ""}${alsoTitle}`;
  const text = String(content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const head = intent.detail ? `${intent.detail} · ` : "";
  const also = others.length ? `원문에 ${others.join("·")} 날짜도 있음 · ` : "";
  const quoted = text.length > 180 ? `${text.slice(0, 180)}…` : text;
  return { title, body: `${head}${also}${parentMessageOrigin(source, className)}: “${quoted}”` };
}

/**
 * 분류 프롬프트 — 한 번에 여러 건을 넣어 왕복을 줄인다(하루 수십 건이라 건별 호출은 낭비).
 *
 * ⚠️ 사실 원칙(팩트·환각금지 등)은 여기 적지 않는다 — `generateJSON()`이 모든 프롬프트 앞에 자동으로
 *    붙인다(CLAUDE.md: 지울 수 없는 자리에 둬야 "항상"이 성립한다).
 * ⚠️ **개인정보**: 이 프롬프트에 들어가는 건 학생 이름·학부모 메시지 본문뿐이다(기존 상담 분석과 같은 선).
 *    전화번호·주민번호·계좌·급여는 절대 싣지 않는다.
 */
export function buildClassifyPrompt(items: Array<{ id: string; studentName: string; date: string; content: string }>): string {
  const lines = items.map(
    (it, i) =>
      `${i + 1}) id=${it.id} | 학생=${it.studentName || "미상"} | 연락일=${it.date}\n"""${String(it.content ?? "").slice(0, 600)}"""`,
  );
  return [
    "너는 학원 사무실 직원이다. 학부모가 학원 알림장 앱에 남긴 메시지에서 **출결 관련 통보**만 골라 JSON으로 정리한다.",
    "",
    "분류(category) 4가지 중 하나:",
    '- "absence": 결석/빠짐/못 감/쉼 (하루든 여러 날이든)',
    '- "late": 지각 — 평소보다 늦게 간다',
    '- "early_leave": 조퇴 — 평소보다 일찍 간다/일찍 데려간다',
    '- "none": 위 셋이 아닌 모든 것(인사, 감사, 교재·진도·성적 문의, 상담 요청, 입금 확인, 보강 일정 협의 등)',
    "",
    "판단 규칙:",
    "- **이미 지나간 일에 대한 설명·확인**은 통보가 아니다 → none. (예: \"지난주에 못 갔었는데 보강 언제 하나요\")",
    "- 보강/일정 **문의·협의**는 none. 다만 그 메시지 안에 '언제 결석한다'는 통보가 함께 있으면 그 통보를 잡는다.",
    "- 확실하지 않으면 none. **추측해서 결석으로 만들지 말 것** — 없는 결석을 만들면 아이를 두고 가게 된다.",
    "",
    "날짜(startsOn/endsOn, YYYY-MM-DD):",
    "- 반드시 **연락일 기준**으로 상대 표현을 풀어라(오늘=연락일, 내일=연락일+1, 이번주 금요일 등).",
    "- '8월 2일부터 8월 6일까지'처럼 기간이면 startsOn·endsOn을 각각 채운다. 하루면 둘을 같게.",
    "- 날짜가 **띄엄띄엄 여러 개**면(예 \"7일이랑 11일, 12일\") 그건 기간이 아니다 → **가장 이른 날**을",
    "  startsOn·endsOn에 같이 넣고, 나머지 날짜는 detail에 적어라(예 \"개인일정 8/11·8/12\").",
    "  가장 늦은 날을 endsOn에 넣으면 **사이에 오는 날까지 결석으로 만들어** 아이가 학원에 못 온다.",
    "- 날짜를 알 수 없으면 **null**로 둬라. 지어내지 말 것.",
    "",
    "detail: 사유나 시각을 원문 표현 그대로 30자 이내로(예: \"감기\", \"가족여행\", \"10시 등원\"). 없으면 null.",
    "",
    "아래 메시지들을 각각 분류해 JSON으로만 답하라:",
    '{"results":[{"id":"<주어진 id 그대로>","category":"absence|late|early_leave|none","startsOn":"YYYY-MM-DD|null","endsOn":"YYYY-MM-DD|null","detail":"…|null"}]}',
    "",
    ...lines,
  ].join("\n");
}
