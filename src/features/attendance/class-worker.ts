/**
 * "그 달 이 반, **누가 수업했나**" — 월별 출석부 반 머리행 끝에 붙는 이름(순수 · Vitest).
 *
 * 원장 2026-09-07: *"누가 수업했는지 ... 라벨 끝에 적어줘"* → *"이게 수업보고서 기준으로 출결이 되니까
 * '수업보고서' 발송한 사람을 적어. 담임말고"* → *"영어의 경우에는 출결자로 (수업보고서를 보내지 않기
 * 때문에)"* → *"수학의 경우 수업보고서를 보고 유추가능한지 검토해볼것"*.
 *
 * 🔴 **담임이 아니다.** 담임은 반 단위 단일 값이라 시간 축이 없어 지난 달을 봐도 지금 담임이 나온다
 *    (2026-09-07 학생 상세에서 같은 이유로 한 번 고쳤다). 여기서 묻는 건 "그 달에 실제로 한 사람"이다.
 *
 * 근거는 둘이고 **순서가 있다**:
 *  ① **수업보고서 작성자**(`lesson_reports.teacher_name` = 그 보고서의 강사) — 실측 2026-09: 보고서가
 *     있는 수학 반 **55개 전부 작성자 1명**(2명 이상 0개)이라 유추가 사실상 확정이다.
 *  ② 보고서가 없으면 **출결 기록자**(`recorded_by`) — 영어는 보고서를 aywa에 안 쓴다(전부 ClassNote).
 *     ⚠️ 여기가 약한 근거다: 기록자는 **대신 찍어 줄 수 있다**([[#93]]·teacher-axis). 실측 2026-09 영어는
 *        반마다 기록자가 2~4명이었다 → 그래서 **한 명으로 단정하지 않고 `외 N명`을 함께 적는다.**
 *  ③ 둘 다 없으면 **아무것도 적지 않는다**(null) — 모르는 것을 지어내지 않는다. 실측 9월 수학 활성 반
 *     22개가 여기 해당한다(그 달 보고서가 아직 없는 반).
 */

import { DEFAULT_SHEET_LANG, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

export type WorkerCount = { name: string; count: number };

export type ClassWorker = {
  /** 가장 많이 한 사람. */
  name: string;
  /** 그 외 몇 명이 더 있나(0이면 한 명뿐). */
  others: number;
  /** 근거 — 화면이 툴팁으로 밝힌다(보고서=강한 근거 / 출결=대신 찍혔을 수 있다). */
  source: "report" | "attendance";
};

/**
 * 최다 1명 + 나머지 수. **동수면 이름 순**으로 고정한다 — 새로고침마다 이름이 바뀌면
 * "누가 했는지"가 아니라 "이번엔 누가 뽑혔는지"가 된다(비결정 금지).
 */
export function pickTopWorker(rows: readonly WorkerCount[], source: ClassWorker["source"]): ClassWorker | null {
  const clean = rows.filter((r) => r.name.trim() && r.count > 0);
  if (clean.length === 0) return null;
  const top = [...clean].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"))[0]!;
  return { name: top.name.trim(), others: clean.length - 1, source };
}

/**
 * 화면 문구 — `유형숙` / `유형숙 외 2명`. 🔴 라벨 끝에 붙는 자리라 짧아야 한다.
 * ⚠️ **이름은 데이터라 번역하지 않는다** — 꼬리말(`외 N명`)만 사전을 탄다(en `+N`).
 *    인자를 안 주면 한국어(다른 순수 모듈과 같은 ko 기본값 규약).
 */
export function classWorkerLabel(w: ClassWorker | null, lang: SheetLang = DEFAULT_SHEET_LANG): string | null {
  if (!w) return null;
  return w.others > 0 ? sheetTf(lang, "att.group.workerOthers", { name: w.name, n: w.others }) : w.name;
}
