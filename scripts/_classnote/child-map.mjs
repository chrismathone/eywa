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
import { childNameConsistent, familyFinder, namesakeClash, namesakeFinder, siblingNameClash } from "./child-identity.mjs";
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

/** ClassNote 유효이름 — classnote_name 오버라이드 || name(발송 워커와 같은 규약). */
const effName = (s) => String(s?.classnote_name || s?.name || "").trim();

/**
 * 원아 1명 → aywa 학생 확정.
 *
 * @param {{ childId: number, name?: string|null, birth?: string|null, phones?: Array<string|null|undefined> }} child
 * @param {Array<{ id: string, name?: string|null, classnote_name?: string|null, grade?: string|null, phones?: Array<string|null|undefined> }>} students
 *   전 학생(퇴원 포함) — ⚠️ 재원만 넘기면 퇴원 동명이인의 원아가 재원 학생에게 잘못 붙는다.
 * @param {{ schoolYear: number, familyFor?: ((student:object, adm:{phones:Array<string|null|undefined>}) => Array<object>)|null }} opts
 *   familyFor = 같은 집 후보(child-identity.mjs `familyFinder` — 전건 계획이 한 번 만들어 넘긴다 · 없으면 여기서 만든다)
 *   · namesakesFor = 지점 전체 같은 이름(`namesakeFinder` — 형제가 서로 다른 번호로 적혀 같은 집에 안 잡히는 경우 · 없으면 여기서 만든다).
 * @returns {{ studentId: string, by: "phone"|"phone+name"|"phone+name+birth"|"name"|"name+birth" }
 *          | { studentId: null, why: string }}
 */
export function resolveChildStudent(child, students, { schoolYear, familyFor = null, namesakesFor = null }) {
  const list = students ?? [];
  const childName = child?.name ?? "";
  const ck = childIdentityKeys(childName);
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
  // ⑦ 같은 집 형제 확인(child-identity.mjs — 수학 반 보드·영어 반 방 발송과 같은 판정). 같은 집 = 원아 보호자 전화 ∪ 그 학생의 전화.
  const findFamily = familyFor ?? familyFinder(list.map((s) => ({ id: s.id, name: effName(s), phones: s.phones })));
  const findNamesakes = namesakesFor ?? namesakeFinder(list.map((s) => ({ id: s.id, name: effName(s) })));
  // ⑦ + ⑦-b — 같은 집 다른 아이와 이어지거나, 지점 전체에서 원아 이름과 똑같은(또는 이 학생보다 긴 그 이름을 담은) 다른 학생이 있으면
  // 붙이지 않는다(적대적 리뷰·재리뷰 2026-11-05 반례 김하·김하늘 · '김하늘이'). 돌려주는 값 = 미확정 사유의 가운데 말(없으면 null).
  const clashWhy = (s) => {
    const self = { id: s.id, name: effName(s) };
    if (siblingNameClash(self, [childName], findFamily({ id: s.id, phones: s.phones }, { phones: child?.phones ?? [] })).length) return "같은 집 다른 아이와도 이어짐";
    if (namesakeClash(self, [childName], findNamesakes([childName])).length) return "다른 학생 이름과 똑같거나 그 이름을 담고 있음";
    return null;
  };

  if (byPhone.length) {
    // 전화가 맞으면 그 집이 맞다 — 남은 문제는 "그 집의 누구냐"(형제)뿐이라 이름·생년으로 좁힌다.
    // 🔴 2026-11-05(원장 *"형제 원아 연결이 뒤바뀐건 크리티컬함. 아주 섬세한 가드로 매칭해야함"*): 전화 후보가 **한 명이어도** 원아 이름이
    //    그 학생과 이어져야 붙인다. 전엔 이름을 안 봤다 — 형제가 aywa에 다른 번호로 적혀 있으면 형제의 원아가 이 학생에게 붙었다
    //    (실측 2026-11-05: 명부 '한도현' 원아가 같은 번호의 유일한 학생 '한민호'에 붙어 있었다). 이름이 정확히 같지 않은 계정
    //    (`서연`↔`박서연` · `Jay(이재희)`)은 포함 관계로 인정하되, 같은 집 다른 아이와도 이어지면 붙이지 않는다.
    const named = byPhone.filter(nameOk);
    if (byPhone.length === 1) {
      const s = byPhone[0];
      if (!childNameConsistent(effName(s), childName))
        return { studentId: null, why: "전화후보 1명인데 원아 이름이 그 학생과 이어지지 않음 — 형제 계정일 수 있어 사람이 확인 필요" };
      const clash = clashWhy(s);
      if (clash) return { studentId: null, why: `전화후보 1명이지만 원아 이름이 ${clash} — 사람이 확인 필요` };
      // 근거 표기는 종전대로 'phone'(= 전화 후보 1명) — 11-05부터는 이름 연속성·형제 확인도 지난 연결이다(0185a linked_by 칸 설명).
      return { studentId: s.id, by: "phone" };
    }
    const pick = only(named, "phone+name") ?? only(named.filter(birthOk), "phone+name+birth");
    if (pick) {
      const s = byPhone.find((x) => x.id === pick.studentId);
      const clash = s ? clashWhy(s) : null;
      if (clash) return { studentId: null, why: `원아 이름이 ${clash} — 사람이 확인 필요` };
      return pick;
    }
    return { studentId: null, why: `전화후보 ${byPhone.length}명 중 이름일치 ${named.length}명 — 사람이 확인 필요` };
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
  // 같은 집 색인은 전건에 한 번(원아마다 학생 전체를 다시 훑지 않게).
  const familyFor = familyFinder((students ?? []).map((s) => ({ id: s.id, name: effName(s), phones: s.phones })));
  const namesakesFor = namesakeFinder((students ?? []).map((s) => ({ id: s.id, name: effName(s) })));
  const plan = [];
  const skipped = [];
  for (const c of children ?? []) {
    const childId = Number(c?.childId);
    if (!Number.isFinite(childId)) continue;
    if (already.has(childId)) continue; // 이미 붙어 있다 = 할 일 없음
    const r = resolveChildStudent(c, students, { schoolYear, familyFor, namesakesFor });
    if (!r.studentId) {
      skipped.push({ childId, why: r.why });
      continue;
    }
    plan.push({ childId, studentId: r.studentId, by: r.by });
  }
  return { plan, skipped };
}
