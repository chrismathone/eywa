/**
 * scripts/_classnote/child-map.mjs — ClassNote **원아(child) ↔ aywa 학생** 확정의 순수 로직(IO 없음 · Vitest).
 *
 * 왜 필요한가(2026-08-06): 인바운드(학부모 글·댓글) 매핑이 지금은 **보드명**(`(수학)홍길동`) 기준이라
 * 1인 보드에서만 통한다. 그런데 영어는 **그룹반**(`[EIE] Let's Speak 6 …`)이라 보드명에 학생이 없고,
 * 재원 341명 중 **영어만 다니는 학생이 149명(44%)** 이다 — 셔틀·출결 용도로는 절반이 빈 명단이 된다.
 *
 * 실측이 준 해법: 피드 행에 **`child`(원아 id)가 그룹반 포함 100%** 실려 있다(학부모 글 43건 전건).
 * 그래서 매핑을 이름이 아니라 **원아 id**로 옮기고, 그 id를 학생에 한 번 붙여 둔다
 * (`students.classnote_child_id`, 0184a).
 *
 * 확정 근거 3겹(2026-08-06 실측 474명 중 461명 = 97%):
 *   ① 보호자 전화(`admissioninfos.basic_info.carer1/2_phone`) — 형제가 같은 번호를 공유해 후보가 여럿일 수 있다
 *   ② 원아명 ↔ aywa 유효이름(동명이인 접미사 A~G까지 포함) — 형제를 가르는 축
 *   ③ 생년 ↔ 학년(±1) — ①②로도 안 갈릴 때의 마지막 축
 * 경로별 실측: 전화유일 276 · 전화+이름 170 · 이름유일 12 · 이름+생년 2 · 미확정 13.
 *
 * 🔴 **전화는 대조에만 쓰고 어디에도 남기지 않는다** — 로그·DB·화면 금지(classnote-integration.md §11 경고).
 *    이 모듈은 전화를 **받아서 비교만** 하고, 돌려주는 건 학생 id와 "어떤 근거로 맞췄나"뿐이다.
 * 🔴 **애매하면 확정하지 않는다.** 잘못 붙이면 남의 집 연락이 그 학생 이름으로 뜬다 — 미확정은
 *    "아직 모른다"로 남기는 게 언제나 낫다(퇴원 동명이인 사고의 교훈, parent-post-filter.mjs 주석 참조).
 */
import { expectedBirthYear } from "./board-safety.mjs";
import { childIdentityKeys, matchesIdentity, studentIdentityKeys } from "./identity-keys.mjs";

/**
 * 전화 비교 키 — 숫자만 남기고 국가번호(82)를 0으로 되돌린다.
 * 하이픈·공백·`+82-10-…` 표기가 양쪽에서 제각각이라 원문 비교는 대부분 빗나간다.
 * @param {unknown} raw
 * @returns {string} 비교 불가(10자리 미만)면 빈 문자열
 */
export function phoneKey(raw) {
  const d = String(raw ?? "")
    .replace(/\D/g, "")
    .replace(/^82/, "0");
  return d.length >= 10 ? d : "";
}

/**
 * 원아 1명 → aywa 학생 확정.
 *
 * @param {{ childId: number, name?: string|null, birth?: string|null, phones?: Array<string|null|undefined> }} child
 * @param {Array<{ id: string, name?: string|null, classnote_name?: string|null, grade?: string|null, phones?: Array<string|null|undefined> }>} students
 *   전 학생(퇴원 포함) — ⚠️ 재원만 넘기면 퇴원 동명이인의 원아가 재원 학생에게 잘못 붙는다.
 * @param {{ schoolYear: number }} opts
 * @returns {{ studentId: string, by: "phone"|"phone+name"|"phone+name+birth"|"name"|"name+birth" }
 *          | { studentId: null, why: string }}
 */
export function resolveChildStudent(child, students, { schoolYear }) {
  const list = students ?? [];
  const ck = childIdentityKeys(child?.name ?? "");
  const nameOk = (s) => matchesIdentity(ck, studentIdentityKeys(s?.name ?? "", s?.classnote_name ?? null));
  const birthYear = Number(String(child?.birth ?? "").slice(0, 4));
  const birthOk = (s) => {
    const expected = expectedBirthYear(s?.grade ?? null, schoolYear);
    return !!(expected && birthYear && Math.abs(expected - birthYear) <= 1);
  };

  const wanted = new Set((child?.phones ?? []).map(phoneKey).filter(Boolean));
  const byPhone = wanted.size
    ? list.filter((s) => (s?.phones ?? []).some((p) => wanted.has(phoneKey(p))))
    : [];

  const only = (arr, by) => (arr.length === 1 ? { studentId: arr[0].id, by } : null);

  if (byPhone.length) {
    // 전화가 맞으면 그 집이 맞다 — 남은 문제는 "그 집의 누구냐"(형제)뿐이라 이름·생년으로 좁힌다.
    const named = byPhone.filter(nameOk);
    return (
      only(byPhone, "phone") ??
      only(named, "phone+name") ??
      only(named.filter(birthOk), "phone+name+birth") ?? {
        studentId: null,
        why: `전화후보 ${byPhone.length}명 중 이름일치 ${named.length}명 — 사람이 확인 필요`,
      }
    );
  }

  // 전화가 없거나 어느 학생과도 안 맞는 경우 — 이름만으로는 위험하므로 **유일할 때만** 인정한다.
  const named = list.filter(nameOk);
  return (
    only(named, "name") ??
    only(named.filter(birthOk), "name+birth") ?? {
      studentId: null,
      why: named.length ? `전화 대조 실패 · 같은 이름 ${named.length}명` : "전화 대조 실패 · 이름 일치 0명",
    }
  );
}

/**
 * 전건 계획 — 이미 붙어 있는 원아는 건드리지 않고(멱등) **새로 확정된 것만** 돌려준다.
 *
 * ⚠️⚠️ **한 학생에 원아가 여럿인 건 정상이다**(0185a). 처음엔 "한 학생 = 원아 하나"로 잠갔는데
 *    실데이터에서 **16쌍 32명**이 같은 아이의 두 계정이었다(수학·영어 따로 가입 / 학부모·학생 각자 가입 —
 *    `이재용` ↔ `Lincoln(이재용)`처럼 이름 표기만 다른 경우 포함). 그 제약 때문에 확정이 461→429명으로
 *    줄었고, 못 붙은 계정으로 들어온 연락은 **그 아이를 출결 명단에서 통째로 빠뜨린다.**
 *    → 막아야 하는 건 그 반대 방향뿐이다: **한 원아가 두 학생에** 붙는 것(남의 집 연락이 섞인다).
 *
 * @param {Array<object>} children ClassNote 원아
 * @param {Array<object>} students aywa 학생(퇴원 포함)
 * @param {{ schoolYear:number, linkedChildIds?: Iterable<number> }} opts
 *   linkedChildIds = 이미 링크된 원아 id들(멱등 판정용).
 * @returns {{ plan: Array<{childId:number, studentId:string, by:string}>, skipped: Array<{childId:number, why:string}> }}
 */
export function planChildMap(children, students, { schoolYear, linkedChildIds = [] }) {
  const already = new Set([...linkedChildIds].map(Number));
  const plan = [];
  const skipped = [];
  for (const c of children ?? []) {
    const childId = Number(c?.childId);
    if (!Number.isFinite(childId)) continue;
    if (already.has(childId)) continue; // 이미 붙어 있다 = 할 일 없음
    const r = resolveChildStudent(c, students, { schoolYear });
    if (!r.studentId) {
      skipped.push({ childId, why: r.why });
      continue;
    }
    plan.push({ childId, studentId: r.studentId, by: r.by });
  }
  return { plan, skipped };
}
