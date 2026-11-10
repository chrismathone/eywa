"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { buildMakeupStudent } from "../server/actions";
import type { OneScreenStudent, Subject } from "../types";
import { CLASS_TAG_ALL } from "../class-tags";
import type { TodayClass } from "../server/roster";
import { effectiveClassnoteStatus, isAlreadySent } from "../grid";
import { fetchMakeupAbsences, fetchMakeupHostClasses } from "@/features/attendance/server/makeup-actions";
import { planMakeupMerge } from "../makeup-merge-plan";
import type { ReportsState } from "../session-input";
import { EMPTY_ABSENCES, candidateAnchorClassId, hostChoicesOfAsk, pendingMakeupRows, type MakeupAsk } from "../makeup-ask-plan";
import type { MakeupI18n } from "./makeup-flow-types";

/**
 * 보강 추가 — 학생을 고르면 합침/분리·수업·결석분을 묻는 확인창(`makeupAsk`)을 연다. 수정 계획 P3-O batch C,
 * `use-makeup-flow.ts`에서 나눔(본문 그대로). 🔴 결석·수업 후보 조회는 응답 순서 가드(`absenceSeq`·`hostSeq`)로
 * 늦게 온 옛 응답이 새 창을 덮지 않게 한다.
 */
export function useMakeupAsk({
  ctx: { date, activeDate, classFilter, matchingClasses, todayClasses },
  state: { students, reports },
  i18n: { t, tf },
  setSelId,
  readonlyBlocked,
}: {
  ctx: { date: string; activeDate: string; classFilter: string; matchingClasses: TodayClass[]; todayClasses: TodayClass[] };
  state: { students: OneScreenStudent[]; reports: ReportsState };
  i18n: MakeupI18n;
  setSelId: Dispatch<SetStateAction<string>>;
  readonlyBlocked: () => boolean;
}) {
  const [makeupAsk, setMakeupAsk] = useState<MakeupAsk | null>(null);
  /**
   * 결석 조회 응답 순서 가드(옆 두 화면 `input-form`·`makeup-add-flow`와 같은 규약).
   * 🔴 **학생 id만으로는 부족하다** — 같은 학생을 반 필터를 바꿔 두 번 열면 조회 결과가 **앵커마다 다르므로**,
   *    늦게 온 옛 조회가 새 창을 덮으면 **다른 과목 목록 + 그 과목 라벨**이 뜬다(과목 필터 이전엔 두 응답이
   *    같아서 안 보이던 레이스다).
   */
  const absenceSeq = useRef(0);
  /** 수업 후보 조회 응답 순서 가드 — 결석 조회와 같은 규약(늦게 온 옛 응답이 새 창을 덮지 않게). */
  const hostSeq = useRef(0);
  /**
   * 🔴 보강 칸은 **서버가 앵커 반에** 적는다(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 확인하는 순간 등록 문(`registerMakeupEntries`,
   *    `recordCell`)이, 보고서를 저장할 때 저장 훅(`saveLessonReport`)이 **같은 함수**(`syncAnchorCells`)로 기다려서 적는다(이미 있으면 그대로).
   *    예전엔 확인창이 여기서 칸을 **기다리지 않고** 먼저 적었고(`persistAnchorMakeup`), 실패하면 저장 훅이 다른 반(예약 반·보강 반)에
   *    칸을 세워 보고서 반과 출석부 반이 갈렸다(C2). 확인 때 적어 두는 이유 = 보고서를 안 쓰는 보강(영어 등)·저장 실패에도 시수가 남게.
   */
  // 보강(수업외) 학생 추가 — 서버에서 OneScreenStudent 조립(담당 과목·교재 기본값).
  //
  // ⚠️ 정규/특강으로 **이미 목록에 있는 학생**도 보강 추가가 돼야 한다(2026-07-24 원장: 특강+정규외 보강).
  //    별도 카드(가짜 id)는 카드 id가 곳곳에서 DB 학생 id로 쓰여 첨부·발송상태를 깨뜨린다(적대검수 실측) →
  //    대신 **그 학생 카드에 '수학 (보강)' 행을 병합**한다(카드 id=실제 학생 id 불변 = 안전). 보강 행은
  //    classId=null·makeup=true라 DB에서 정규 보고서와 별개(unit_key 분리)로 저장되고, 학부모 보고서엔 "(보강)"이 붙는다.
  async function addMakeupStudent(studentId: string) {
    if (readonlyBlocked()) return;
    const res = await buildMakeupStudent(studentId, date || undefined); // 조회 중인 날짜 전달(과거 백필 중복게시 방지)
    if (!res.ok || !res.student) {
      toast.error(res.error ?? t("os.c.addStudentFail"));
      return;
    }
    // 보강을 **어느 수업 시간에** 하는지 = 지금 보고 있는 반 필터. 이게 반 필터 앵커가 된다(0171a) —
    // 앵커가 없으면(전체에서 추가·동명 반이라 특정 불가) 그 보강 행은 '전체'에서만 보인다.
    // 🔴 예전엔 앵커가 없어 보강 학생이 **모든 반 필터**에 나왔다(원장 제보 2026-08-03).
    // ⚠️ 이름은 **필터가 걸려 있으면 항상** 남긴다(id는 동명 반이면 특정 불가 → null). id가 없다고 이름까지
    //    비우면, 동명 반을 고른 채 보강을 추가했을 때 카드가 그 자리에서 사라진다 = 2026-07-27 그 버그 재발.
    const anchorName = classFilter === CLASS_TAG_ALL ? null : classFilter;
    const anchorId = matchingClasses.length === 1 ? matchingClasses[0]!.id : null;
    const withAnchor = (su: Subject): Subject => ({
      ...su,
      makeupClassId: anchorId,
      makeupClassName: anchorName,
    });
    // 🔴 과목 **키**로 거른다 — `TodayClass.subject`는 표시 라벨("수학")이라 키("math")와 비교하면 늘 거짓이고,
    //    반 칩을 고른 채 보강을 추가하면 보강 줄이 0개가 되어 저장이 "보강 날짜와 과목을 확인해 주세요"로 막혔다
    //    (원장 제보 2026-09-14 권영준·이수진). 키를 모르면("") 거르지 않는다(종전 '전체'와 같은 동작).
    const anchorSubject = matchingClasses.length === 1 ? matchingClasses[0]!.subjectKey || null : null;
    const mk = {
      ...res.student,
      subjects: res.student.subjects.filter(su => !anchorSubject || su.subjectKey === anchorSubject).map(withAnchor),
    };
    const existing = students.find((s) => s.id === studentId);
    if (!existing) {
      // 🔴 목록에 없던 학생도 **묻고 나서** 추가한다(원장 2026-08-19: *"이름 검색하고 누르면 그냥 추가되고
      //    끝이야"*). 예전엔 여기서 바로 카드를 만들어, 보강의 대다수인 "다른 반 학생"에서 결석분·시수를
      //    물을 자리가 아예 없었다. 카드는 확인 후 `resolveMakeupAsk`가 만든다(취소하면 아무 일도 없다).
      if (anchorName) {
        mk.tag = anchorName;
        mk.className = anchorName;
      }
      setMakeupAsk({
        studentId,
        studentName: mk.name,
        mk,
        candidates: [],
        sentSubjects: [],
        isNew: true,
        absences: EMPTY_ABSENCES,
        absencesLoading: true,
        hostClasses: { options: [], loading: true },
      });
      void loadAbsences(studentId, anchorId);
      void loadHostClasses(studentId, mk.subjects);
      return;
    }
    // 🔴 **자동으로 합치지 않는다 — 묻는다**(원장 2026-08-06: *"선생님들이 헷갈린대"*).
    //    2026-08-05엔 정규 행이 있으면 말없이 합쳤는데(제목이 "(정규+보강)"이 되고 수업타임이 2가 된다),
    //    보강을 추가한 강사는 그 결과만 보게 돼 무슨 일이 일어난 건지 몰랐다.
    //    → `planMakeupMerge`가 후보를 고르고, 다이얼로그가 **합침 ↔ 분리 토글**로 물어본 뒤 고른 대로만 한다.
    //      · 합침 = 정규 행 1건에 합쳐 "(정규+보강)" 한 번만 발송(수업타임 +1)
    //      · 분리 = 종전(08-05 이전)대로 별도 "(보강)" 행 → 정규 1건 + 보강 1건, 2건 발송
    //    ⚠️ 후보를 고르는 3조건(내 과목·반 있는 정규 행·시수 올려도 되는 상태)은 그대로다 — 판정은
    //       [makeup-merge-plan.ts](../makeup-merge-plan.ts) 단일 소스(순수+Vitest).
    const teacherSubjectKeys = new Set(mk.subjects.map((su) => su.subjectKey).filter((k): k is string => !!k));
    const plan = planMakeupMerge(existing.subjects, teacherSubjectKeys);
    if (plan.kind === "already") {
      // 이미 합쳐 둔 과목이 있으면 **또 만들지 않는다** — 두 번 누르면 별도 "(보강)" 행이 생겨 보고서가
      // 결국 두 번 나간다. 예전 "이미 보강 행이 추가되어 있습니다"와 같은 규약.
      setSelId(existing.id);
      toast.message(
        tf("os.c.makeupAlready", { name: existing.name, subjects: plan.subjects.join("·") }),
      );
      return;
    }
    if (plan.kind === "ask") {
      // ⚠️ 이미 발송된 정규 보고서는 수정이 막혀 있다(발송본 잠금) — 합치면 보강 내용이 안 실린다는 사실을
      //    **고르기 전에** 다이얼로그에서 알린다(원장 2026-08-05 경고 요구를 선택 시점으로 앞당긴 것).
      const sentSubjects = plan.candidates
        .filter((c) =>
          isAlreadySent(
            effectiveClassnoteStatus(
              reports[studentId]?.[c.name]?.classnoteStatus,
              existing.subjects.find((su) => su.name === c.name)?.classnoteStatus,
            ),
          ),
        )
        .map((c) => c.name);
      setSelId(existing.id);
      setMakeupAsk({
        studentId,
        studentName: existing.name,
        mk,
        // 반 이름은 확인창 선택지 표시용(판정은 classId) — 행 이름("수학")만으론 어느 반인지 안 보인다.
        candidates: plan.candidates.map((c) => ({ ...c, className: todayClasses.find((x) => x.id === c.classId)?.name ?? null })),
        sentSubjects,
        isNew: false,
        absences: EMPTY_ABSENCES,
        absencesLoading: true,
        // 🔴 정규 수업이 있어도 **다른 수업을 고를 수 있다**(원장 2026-09-21 *"보강을 항상 다른 수업을 고를 수 있게 해야 따로 보강 행이
        //    안생겨서 수납 분리가 쉬울듯"*) — 다니는 다른 반에 기록하면 출석부에 방문 줄이 안 생긴다. 오늘 정규 반은 목록에서 빠진다(`hostChoicesOf`).
        hostClasses: { options: [], loading: true },
      });
      // 반 필터가 '전체'면 앵커가 없다 — 그때는 **합칠 후보의 반**으로 좁힌다(위 헬퍼의 🔴 참조).
      void loadAbsences(studentId, anchorId ?? candidateAnchorClassId(plan.candidates));
      // 수업 후보도 **합칠 정규 수업의 과목**으로 좁힌다 — 두 과목을 가르치는 선생님이 '전체'에서 추가하면 결석 목록은 정규 수업 과목인데
      // 반 후보에 다른 과목 반이 섞여, 영어 반에 기록하면서 수학 결석에 메모를 달 수 있었다(적대 리뷰 2026-09-21). 과목 키를 모르면 종전대로.
      const candSubjects = mk.subjects.filter((su) => plan.candidates.some((c) => !!c.subjectKey && c.subjectKey === su.subjectKey));
      void loadHostClasses(studentId, candSubjects.length ? candSubjects : mk.subjects);
      return;
    }
    // 합칠 정규 행이 없다(그날 결석·다른 강사 과목 등) → **그래도 묻는다**. 결석 보강이 바로 이 경로라
    // 예전엔 가장 흔한 보강에서 결석분·시수를 물을 자리가 없었다(원장 2026-08-19).
    // 🔴 단 **더할 보강 행이 없으면**(같은 학생을 다시 추가) 창을 열지 않는다 — 열면 수업·시수·결석분을 고르게 해 놓고
    //    하나도 반영하지 못한다(적대 리뷰 2026-09-21). 반을 바꾸려면 보강 빼기 → 다시 추가.
    if (pendingMakeupRows(existing, mk).length === 0) {
      setSelId(existing.id);
      toast.message(t("os.c.makeupRowExists"));
      return;
    }
    setMakeupAsk({
      studentId,
      studentName: existing.name,
      mk,
      candidates: [],
      sentSubjects: [],
      isNew: false,
      absences: EMPTY_ABSENCES,
      absencesLoading: true,
      hostClasses: { options: [], loading: true },
    });
    void loadAbsences(studentId, anchorId);
    void loadHostClasses(studentId, mk.subjects);
  }
  // 창에 보일 수업 후보 — 판정 본문은 makeup-ask-plan.ts(hostChoicesOfAsk).
  function hostChoicesOf(ask: MakeupAsk) {
    return hostChoicesOfAsk(ask, students, todayClasses);
  }
  /** 보강을 기록할 수업 후보를 뒤늦게 채운다 — 창은 먼저 열고 목록만 갈아 끼운다(결석 조회와 같은 모양). */
  async function loadHostClasses(studentId: string, rows: readonly Subject[]) {
    const mine = ++hostSeq.current;
    // 후보는 보강 행 과목의 반만(등록 문이 과목까지 맞춰 본다) — 과목 키를 모르면 거르지 않는다.
    const subjects = [...new Set(rows.map((su) => su.subjectKey).filter((k): k is string => !!k))];
    const res = await fetchMakeupHostClasses(studentId, activeDate, subjects).catch(() => ({ options: [], failed: true }));
    if (mine !== hostSeq.current) return;
    setMakeupAsk((prev) =>
      prev && prev.studentId === studentId && prev.hostClasses
        ? { ...prev, hostClasses: { options: res.options, loading: false, failed: res.failed, noneBlocked: "noneBlocked" in res ? res.noneBlocked : false } }
        : prev,
    );
  }
  /**
   * 결석 후보(이전 반 포함)를 뒤늦게 채운다 — 창은 먼저 열고 목록만 도착하면 갈아 끼운다.
   * 🔴 앵커 반을 함께 넘겨 **그 반 과목**의 결석만 받는다(수학 보강에 영어 결석이 뜨던 것,
   *    원장 제보 2026-08-19). 반 필터가 '전체'라 앵커가 없으면 종전대로 안 거른다.
   */
  async function loadAbsences(studentId: string, anchorClassId: string | null) {
    const mine = ++absenceSeq.current;
    const list = await fetchMakeupAbsences(studentId, activeDate, anchorClassId).catch(
      () => EMPTY_ABSENCES,
    );
    // 🔴 늦게 온 옛 조회는 버린다 — 학생이 같아도 **앵커(과목)가 다르면 다른 목록**이다.
    if (mine !== absenceSeq.current) return;
    setMakeupAsk((prev) =>
      prev && prev.studentId === studentId ? { ...prev, absences: list, absencesLoading: false } : prev,
    );
  }
  return { makeupAsk, setMakeupAsk, addMakeupStudent, hostChoicesOf, loadAbsences };
}
