"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Plus, Printer, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { saveTuitionQuote, type SaveQuoteState } from "@/features/billing/server/tuition-quote-actions";
import { DISCOUNT_CATEGORY, type TuitionCatalogOption } from "@/features/billing/tuition-catalog";
import { koreanHolidayDatesForRange } from "@/features/billing/holidays-data";
import {
  autoSessions,
  monthlySessionsFor,
  feeKindFromPricingMode,
  groupByFeeKind,
  normalizeLoadedCourses,
  quoteTotal,
} from "@/features/billing/quote-calc";
import type { QuoteStudent, QuoteCourse, QuoteExtra, QuoteDiscount } from "@/features/billing/quote-calc";
import type { QuoteDetail } from "@/features/billing/server/tuition-quote-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { AccountSetting } from "@/features/owner/settings-types";
import { CatalogPicker, CourseEditor, ExtraEditor, DiscountEditor } from "./quote-editors";
import { QuoteDocument } from "./quote-document";
import { submitAction } from "@/components/forms/submit-action";
import { useBillingSettingsRefresh } from "@/features/billing/use-billing-settings-refresh";
import { writeLockedNote } from "@/lib/write-lock";

const won = (n: number) => `${new Intl.NumberFormat("ko-KR").format(Math.round(n))}원`;
const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";
const EXTRA_CATEGORY = "기타";

function monthLastDay(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, "0")}`;
}
function todayLabel(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const w = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getDate()).padStart(2, "0")}. (${w})`;
}

function SaveBtn({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      견적 저장
    </Button>
  );
}

/**
 * 불러온 행들의 uid를 **유일하게** 만든다. 이미 저장된 견적에 중복 uid가 들어 있으면(과거 버전이
 * 만든 데이터) 한 칸을 고칠 때 두 행이 함께 바뀐다 — 화면에 들이기 전에 여기서 끊는다.
 * ⚠️ 인덱스 기반이라 서버·클라 결과가 같다(Date.now/random을 쓰면 hydration이 어긋난다).
 */
function dedupeUids<T extends { uid: string }>(list: readonly T[], prefix: string): T[] {
  const seen = new Set<string>();
  return list.map((x, i) => {
    const uid = x.uid && !seen.has(x.uid) ? x.uid : `${prefix}${i}`;
    seen.add(uid);
    return uid === x.uid ? x : { ...x, uid };
  });
}

export function TuitionCalculator({
  academyName,
  logoSrc,
  defaultPeriod,
  defaultAccount,
  holidays = [],
  catalog = [],
  textbooks = [],
  initial,
  showHouseRules = true,
  canSave,
}: {
  academyName: string;
  logoSrc?: string | null; // 학원 로고(서버에서 resolveBrandingSrc로 푼 signed URL) — 안내문 헤더
  defaultPeriod: string;
  defaultAccount: AccountSetting; // 입금 계좌 기본값 — 학원설정에서 '수강료 계산기'에 배선된 계좌
  holidays?: string[];
  catalog?: TuitionCatalogOption[];
  textbooks?: CatalogOption[]; // 교재 단가표(146권) — 교재/기타 picker에 합침
  initial?: QuoteDetail;
  /** 안내문 하단 '학원 수칙'(첫 학원 규칙) — 새 학원은 끈다. 법정 환불 규정은 늘 실린다. */
  showHouseRules?: boolean;
  /**
   * '견적 저장'을 세울지 — 서버(CalculatorTab)가 `saveTuitionQuote`와 같은 판정(canManageTenant billing = full)으로 정한 값.
   * 읽기 권한이면 저장 단추만 그리지 않는다 — 입력칸은 그 자리 계산용이라 그대로 두고 계산·인쇄는 쓴다(원장 2026-11-05).
   */
  canSave: boolean;
}) {
  useBillingSettingsRefresh();
  /**
   * 행 uid — 🔴 **절대 겹치면 안 된다.** patchCourse/patchExtra 등이 uid로 대상을 고르므로
   * 두 행이 같은 uid를 가지면 한 칸을 고칠 때 **두 행이 함께 바뀐다**(원장 제보 2026-08-07:
   * "2개의 수강과목이 있으면 별개로 계산되어야 하는데 요일입력이 같이 작동한다").
   *
   * 원인은 카운터 시드였다 — 저장된 견적을 열면(`initial`) courses에 이미 q1·q2가 들어 있는데
   * 카운터는 0에서 시작해, 과목을 추가하면 q1을 다시 발급했다. 초안 복구 경로엔 재시드가 있었지만
   * (restoreDraft) `initial` 경로엔 없었다.
   *
   * 두 겹으로 막는다: ① 카운터를 initial 최대값에서 시작 ② 발급할 때 **현재 목록과 대조**해
   * 이미 쓰는 값이면 건너뛴다(어떤 경로로 들어오든 구조적으로 충돌 불가).
   */
  const uidRef = useRef(
    [...(initial?.courses ?? []), ...(initial?.extras ?? []), ...(initial?.discounts ?? [])]
      .map((x) => Number(String(x.uid).replace(/\D/g, "")) || 0)
      .reduce((a, b) => Math.max(a, b), 0),
  );
  const nextUid = (used: readonly { uid: string }[] = []) => {
    const taken = new Set(used.map((x) => x.uid));
    let n = uidRef.current;
    let uid: string;
    do {
      uid = `q${++n}`;
    } while (taken.has(uid));
    uidRef.current = n;
    return uid;
  };

  const [student, setStudent] = useState<QuoteStudent>({
    name: initial?.studentName ?? "",
    school: initial?.school ?? "",
    grade: initial?.grade ?? "",
    consultant: initial?.consultant ?? "",
    startDate: initial?.startDate ?? `${defaultPeriod}-01`,
    endDate: initial?.endDate ?? monthLastDay(defaultPeriod),
  });
  // 🔴 열 때 **월 정액이 '회당'으로 저장돼 있던 행**을 바로잡는다(normalizeLoadedCourses 주석 참조) —
  //    그대로 두면 날짜·요일을 한 번만 건드려도 27만원이 27만원 × 12회가 된다(실측 4행).
  const [courses, setCourses] = useState<QuoteCourse[]>(() =>
    normalizeLoadedCourses(dedupeUids(initial?.courses ?? [], "c")),
  );
  const [extras, setExtras] = useState<QuoteExtra[]>(() => dedupeUids(initial?.extras ?? [], "e"));
  const [discounts, setDiscounts] = useState<QuoteDiscount[]>(() => dedupeUids(initial?.discounts ?? [], "d"));
  const [createdLabel] = useState(() => todayLabel(initial?.createdAt));
  // 안내문 헤더 로고/학원명 표시 토글 — 로고 이미지에 학원명 워드마크가 있으면 하나만 켜서 중복 제거.
  // 표시 전용(견적 데이터 아님)이라 저장/복구엔 미포함.
  const [showLogo, setShowLogo] = useState(true);
  const [showName, setShowName] = useState(true);
  // 입금 계좌 안내 — 기본값은 학원설정에서 '수강료 계산기'에 배선된 계좌(accountForTarget). 계산기에서 수정 가능하고
  // 체크박스로 안내문 표시 여부 토글. 표시 전용(견적 데이터 아님)이라 저장/복구엔 미포함(showLogo·showName과 동일).
  const [account, setAccount] = useState<AccountSetting>(defaultAccount);
  const [showAccount, setShowAccount] = useState(
    !!(defaultAccount.bank || defaultAccount.holder || defaultAccount.number),
  );
  const [state, formAction] = useActionState<SaveQuoteState, FormData>(saveTuitionQuote, undefined);

  const courseOpts = useMemo(
    () => catalog.filter((c) => c.category !== DISCOUNT_CATEGORY && c.category !== EXTRA_CATEGORY),
    [catalog],
  );
  // 교재/기타 picker = tuition_catalog "기타" + 교재 단가표(146권). 교재명 검색으로 바로 추가.
  const extraOpts = useMemo<TuitionCatalogOption[]>(
    () => [
      ...catalog.filter((c) => c.category === EXTRA_CATEGORY),
      ...textbooks.map((b) => ({
        id: b.id,
        category: "교재",
        name: b.title,
        price: b.price,
        // 교재는 권당 가격이라 회당 단가가 아니다 — 시수를 곱하면 안 된다(기타 항목으로만 쓰인다).
        pricingMode: null,
        note: b.bookDetail,
      })),
    ],
    [catalog, textbooks],
  );
  const discountOpts = useMemo(() => catalog.filter((c) => c.category === DISCOUNT_CATEGORY), [catalog]);

  const unionHol = (s: QuoteStudent) =>
    Array.from(new Set([...holidays, ...koreanHolidayDatesForRange(s.startDate, s.endDate)]));
  const recompute = (c: QuoteCourse, s: QuoteStudent): QuoteCourse => {
    const hol = c.excludeHolidays ? unionHol(s) : [];
    // 🔴 월 고정도 **회차는 센다**(원장 2026-08-07) — 고정된 건 금액이지 회차가 아니다. 예전엔 여기서
    //    통째로 돌아가 요일을 적어도 '월 N회'가 0으로 남았고, 그대로 학부모 안내문에 실렸다.
    //    ⚠️ 금액은 손대지 않는다(월 정액은 회차와 무관하게 사람이 정한 값).
    // 요일이 없으면 사람이 적은 '월 N회'를 지킨다(monthlySessionsFor 주석 — 자동 계산이 0으로 지워 버린다).
    if (c.fixedMonthly) return { ...c, sessions: monthlySessionsFor(c, s.startDate, s.endDate, hol) };
    const sessions = autoSessions(c.days, s.startDate, s.endDate, hol);
    // 🔴 **회당 단가가 없으면 금액을 건드리지 않는다.** 단가표에 종류가 없는 항목은 perSession이 0으로
    //    들어오는데, 예전엔 그대로 곱해 **금액이 0원으로 죽었다**(요일을 고칠 때마다 다시 0으로 덮였다).
    //    시수는 그대로 갱신하고 금액은 사람이 넣은 값을 지킨다 — 단가를 채우면 그때부터 자동 계산된다.
    return { ...c, sessions, price: c.perSession > 0 ? Math.round(c.perSession * sessions) : c.price };
  };

  const setPeriod = (key: "startDate" | "endDate", value: string) => {
    const s = { ...student, [key]: value };
    setStudent(s);
    setCourses((cs) => cs.map((c) => recompute(c, s)));
  };

  const addCourse = (o: TuitionCatalogOption) =>
    setCourses((cs) => {
      // 🔴 **회당 단가일 때만 시수를 곱한다.** 단가표의 price는 "회당/월/할인"이 섞여 있어서
      //    (0102a pricing_mode) 무조건 곱하면 월 20만원짜리가 9회 곱해져 180만원이 된다.
      //    회당이 아니면(월 단가·미지정) '월 N회 고정'으로 넣어 금액을 그대로 쓴다 — 곱셈 금지.
      const perSessionPriced = feeKindFromPricingMode(o.pricingMode) === "per_session";
      const row: QuoteCourse = {
        uid: nextUid(cs),
        category: o.category,
        name: o.name,
        days: "",
        perSession: perSessionPriced ? o.price : 0,
        sessions: 0,
        price: perSessionPriced ? 0 : o.price,
        note: o.note ?? "",
        excludeHolidays: true,
        fixedMonthly: !perSessionPriced,
        // 어디서 온 단가인지 남긴다 — 미지정이면 행에 "구분을 골라 주세요"가 뜬다(EiE 27만원 사고 방지).
        pricingMode: o.pricingMode ?? null,
      };
      return [...cs, recompute(row, student)];
    });

  const patchCourse = (uid: string, patch: Partial<QuoteCourse>) =>
    setCourses((cs) =>
      cs.map((c) => {
        if (c.uid !== uid) return c;
        const next = { ...c, ...patch };
        // 요일·공휴일·구분이 바뀌면 회차를 다시 센다 — **월 고정도 포함**(recompute가 구분에 맞게 갈라 준다).
        if ("days" in patch || "excludeHolidays" in patch || "fixedMonthly" in patch) {
          return recompute(next, student);
        }
        // 시수·회당 단가를 고치면 금액을 다시 곱한다. ⚠️ 단가가 0이면(=미지정 항목) **금액을 지키고**
        //    곱하지 않는다 — 위 recompute와 같은 규약(0원으로 죽는 것 방지).
        if (!next.fixedMonthly && ("sessions" in patch || "perSession" in patch)) {
          return next.perSession > 0 ? { ...next, price: Math.round(next.perSession * next.sessions) } : next;
        }
        return next;
      }),
    );

  const totals = quoteTotal(courses, extras, discounts);
  // 수강료 구분별 묶음 — 입력 목록을 두 부류로 갈라 보여준다(원본 순서 보존, quote-calc 주석 참조).
  const byKind = groupByFeeKind(courses);
  const docHolidays = unionHol(student);

  const payload = (k: "courses" | "extras" | "discounts") =>
    JSON.stringify(k === "courses" ? courses : k === "extras" ? extras : discounts);

  // 로컬 초안 자동저장 — 입력이 React state(동적 행 배열)라 useStateDraft로 스냅샷 직렬화 저장.
  // 복구는 setState로 일괄 rehydrate + uid 카운터 재시드. 저장 성공(state.ok) 시 초안 삭제.
  const draftScope = initial?.id ? `quote:${initial.id}` : "quote:new";
  const draftSnapshot = useMemo(
    () => ({ student, courses, extras, discounts }),
    [student, courses, extras, discounts],
  );
  const draft = useStateDraft({
    scope: draftScope,
    snapshot: draftSnapshot,
    hasContent: (s) => s.student.name.trim() !== "" || s.courses.length > 0,
  });
  const clearDraft = draft.clear;
  useEffect(() => {
    if (state?.ok) clearDraft();
  }, [state, clearDraft]);

  function restoreDraft() {
    const d = draft.restore();
    if (!d) return;
    setStudent(d.student);
    setCourses(normalizeLoadedCourses(d.courses)); // 초안 복구도 같은 자리(옛 초안이 같은 모양일 수 있다)
    setExtras(d.extras);
    setDiscounts(d.discounts);
    // uid 카운터를 복원 행들의 최대치 이상으로 → 이후 nextUid()가 기존 행과 충돌 안 함.
    uidRef.current = [...d.courses, ...d.extras, ...d.discounts]
      .map((x) => Number(String(x.uid).replace(/\D/g, "")) || 0)
      .reduce((a, b) => Math.max(a, b), uidRef.current);
  }

  return (
    <div className="grid grid-cols-1 gap-5 print:block min-[960px]:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      {/* 입력 (인쇄 시 숨김) */}
      <div className="space-y-4 print:hidden">
        <DraftBanner savedAt={draft.draftSavedAt} onRestore={restoreDraft} onDiscard={draft.discard} />
        {/* 학생 정보 */}
        <section className="bg-card border-line shadow-card space-y-3 rounded-2xl border p-4">
          <h2 className="text-foreground text-base font-bold">상담 정보 (신입생)</h2>
          <div className="grid grid-cols-2 items-end gap-2">
            <label className="space-y-1">
              <span className="text-text-faint text-xs">
                학생 이름 <span className="text-danger">*</span>
              </span>
              <input className={inputCls} placeholder="학생 이름" value={student.name} onChange={(e) => setStudent({ ...student, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} aria-label="학교" placeholder="학교" value={student.school} onChange={(e) => setStudent({ ...student, school: e.target.value })} />
              <input className={inputCls} aria-label="학년" placeholder="학년" value={student.grade} onChange={(e) => setStudent({ ...student, grade: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-text-faint text-xs">시작일</span>
              <input type="date" className={inputCls} value={student.startDate} onChange={(e) => setPeriod("startDate", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-text-faint text-xs">종료일</span>
              <input type="date" className={inputCls} value={student.endDate} onChange={(e) => setPeriod("endDate", e.target.value)} />
            </label>
          </div>
          <input className={inputCls} aria-label="상담자" placeholder="상담자" value={student.consultant} onChange={(e) => setStudent({ ...student, consultant: e.target.value })} />
          {/* 안내문 헤더 표시 — 로고 이미지에 학원명이 들어가 있으면 하나만 켜서 중복 제거. */}
          <div className="border-line flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3">
            <span className="text-text-faint text-xs">안내문 헤더</span>
            <label className="text-foreground inline-flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} className="size-4" />
              로고 이미지
            </label>
            <label className="text-foreground inline-flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="size-4" />
              학원명 텍스트
            </label>
          </div>
        </section>

        {/* 수강 과목 */}
        <Group
          required
          title="수강 과목"
          hint="단가표에서 고르면 단가 종류(회당/월)에 맞게 들어갑니다. 회당은 요일을 넣으면 시수·금액이 자동 계산되고, 월 고정은 금액을 그대로 청구합니다."
        >
          <CatalogPicker options={courseOpts} placeholder="+ 과목 추가 (단가표)" onPick={addCourse} />
          {/* 🔴 **두 부류를 갈라 보여준다**(원장 2026-08-07: *"월 고정 금액을 받는 수업과 회당 수업을 받는
              수업으로 분리"*). 섞여 있으면 27만원이 월 금액인지 회당 단가인지 목록만 봐서는 알 수 없다.
              ⚠️ 화면에서만 나눈다 — `courses` 배열 순서는 안 건드린다(안내문이 그 순서로 인쇄된다).
              ⚠️ 구분별 건수·합계 줄은 **두지 않는다**(원장 2026-08-07: *"상단에 이건 필요없을듯. 어차피
                 우측에 나오잖아"*) — 같은 숫자를 안내문이 이미 보여준다. */}
          {(
            [
              ["월 고정 금액", byKind.monthly, "금액을 그대로 청구합니다(월 정액)"],
              ["회당", byKind.perSession, "회당 단가 × 시수로 계산합니다"],
            ] as const
          ).map(([label, list, hint]) =>
            list.length ? (
              <div key={label} className="space-y-2">
                <div className="border-line flex items-baseline gap-2 border-b pb-1">
                  <span className="text-foreground text-xs font-bold">{label}</span>
                  <span className="text-text-faint text-xs">{hint}</span>
                </div>
                {list.map((c) => (
                  <CourseEditor
                    key={c.uid}
                    course={c}
                    onPatch={(p) => patchCourse(c.uid, p)}
                    onRemove={() => setCourses((cs) => cs.filter((x) => x.uid !== c.uid))}
                  />
                ))}
              </div>
            ) : null,
          )}
        </Group>

        {/* 교재 및 기타 */}
        <Group title="교재 및 기타">
          <CatalogPicker
            options={extraOpts}
            placeholder="+ 교재·항목 추가 (단가표 검색)"
            onPick={(o) => setExtras((es) => [...es, { uid: nextUid(es), name: o.note ? `${o.name} ${o.note}` : o.name, price: o.price, note: "" }])}
          />
          {extras.map((e) => (
            <ExtraEditor key={e.uid} extra={e} onPatch={(p) => setExtras((es) => es.map((x) => (x.uid === e.uid ? { ...x, ...p } : x)))} onRemove={() => setExtras((es) => es.filter((x) => x.uid !== e.uid))} />
          ))}
          <AddManual label="직접 입력 항목 추가" onAdd={() => setExtras((es) => [...es, { uid: nextUid(es), name: "", price: 0, note: "" }])} />
        </Group>

        {/* 할인 */}
        <Group title="할인 적용">
          <CatalogPicker options={discountOpts} placeholder="+ 할인 추가 (프리셋)" onPick={(o) => setDiscounts((ds) => [...ds, { uid: nextUid(ds), name: o.name, amount: o.price }])} />
          {discounts.map((d) => (
            <DiscountEditor key={d.uid} discount={d} onPatch={(p) => setDiscounts((ds) => ds.map((x) => (x.uid === d.uid ? { ...x, ...p } : x)))} onRemove={() => setDiscounts((ds) => ds.filter((x) => x.uid !== d.uid))} />
          ))}
          <AddManual label="직접 입력 할인 추가" onAdd={() => setDiscounts((ds) => [...ds, { uid: nextUid(ds), name: "", amount: 0 }])} />
        </Group>

        {/* 입금 계좌 안내 — 안내문(우측 최종 납부 금액 위)에 표시. 기본값=학원설정(수납) 계좌, 여기서 수정 가능. */}
        <section className="bg-card border-line shadow-card space-y-2.5 rounded-2xl border p-4">
          <label className="text-foreground inline-flex items-center gap-1.5 text-base font-bold">
            <input
              type="checkbox"
              checked={showAccount}
              onChange={(e) => setShowAccount(e.target.checked)}
              className="size-4"
            />
            입금 계좌 안내
          </label>
          <p className="text-text-faint text-xs">
            체크하면 안내문 <b>최종 납부 금액 위</b>에 입금 계좌가 표시됩니다. 학원설정(수납)에서 &lsquo;수강료
            계산기&rsquo;에 배선한 계좌가 자동으로 채워지며, 여기서 수정하면 이 안내문에만 반영됩니다.
          </p>
          {showAccount ? (
            <div className="space-y-2">
              {/* 계좌는 학원설정에서 '수강료 계산기'에 배선된 계좌가 자동으로 채워짐. 이 견적만 다르게 쓰려면 여기서 직접 수정. */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  aria-label="은행"
                  placeholder="은행"
                  value={account.bank}
                  onChange={(e) => setAccount({ ...account, bank: e.target.value })}
                />
                <input
                  className={inputCls}
                  aria-label="예금주"
                  placeholder="예금주"
                  value={account.holder}
                  onChange={(e) => setAccount({ ...account, holder: e.target.value })}
                />
              </div>
              <input
                className={inputCls}
                aria-label="계좌번호"
                placeholder="계좌번호"
                value={account.number}
                onChange={(e) => setAccount({ ...account, number: e.target.value })}
              />
            </div>
          ) : null}
        </section>

        {/* 저장 */}
        <section className="bg-card border-line shadow-card space-y-3 rounded-2xl border p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-foreground text-base font-bold">{canSave ? "견적 저장" : "합계"}</h2>
            <span className="text-primary num text-lg font-bold">{won(totals.total)}</span>
          </div>
          <p className="text-text-faint text-xs">
            {canSave
              ? "신입생 상담 견적으로 저장됩니다(재원생 청구서와 별개). 저장 후 ‘저장된 청구서’ 탭에서 다시 열 수 있습니다."
              : `계산·인쇄는 그대로 쓸 수 있습니다. ${writeLockedNote("billing")}`}
          </p>
          <form onSubmit={(e) => submitAction(e, formAction)} className="flex items-center justify-end gap-2">
            <input type="hidden" name="studentName" value={student.name} />
            <input type="hidden" name="school" value={student.school} />
            {/* 저장된 견적을 열었으면 그 행을 **덮어쓴다** — 없으면 새로 만든다(사본 증식 방지). */}
            {initial?.id ? <input type="hidden" name="quoteId" value={initial.id} /> : null}
            <input type="hidden" name="grade" value={student.grade} />
            <input type="hidden" name="consultant" value={student.consultant} />
            <input type="hidden" name="startDate" value={student.startDate} />
            <input type="hidden" name="endDate" value={student.endDate} />
            <input type="hidden" name="courses" value={payload("courses")} />
            <input type="hidden" name="extras" value={payload("extras")} />
            <input type="hidden" name="discounts" value={payload("discounts")} />
            <input type="hidden" name="totalAmount" value={totals.total} />
            {state?.error ? (
              <p className="text-danger mr-auto inline-flex items-center gap-1 text-xs">
                <AlertCircle className="size-3.5" />
                {state.error}
              </p>
            ) : state?.ok ? (
              <p className="text-primary mr-auto inline-flex items-center gap-1 text-xs">
                <Check className="size-3.5" />
                견적이 저장되었습니다.
              </p>
            ) : canSave && (!student.name.trim() || courses.length === 0) ? (
              <p className="text-text-faint mr-auto text-xs">
                <span className="text-danger">*</span> 학생 이름과 수강 과목을 입력하면 저장됩니다
              </p>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" />
              인쇄
            </Button>
            {canSave ? <SaveBtn disabled={!student.name.trim() || courses.length === 0} /> : null}
          </form>
        </section>
      </div>

      {/* 라이브 안내문 (인쇄 시 카드 크롬 제거 → A4 전폭 세로 문서) */}
      <div className="border-line bg-card overflow-hidden rounded-2xl border print:overflow-visible print:rounded-none print:border-0 print:bg-white print:shadow-none">
        <QuoteDocument
          academyName={academyName}
          logoSrc={logoSrc}
          showLogo={showLogo}
          showName={showName}
          account={account}
          showAccount={showAccount}
          student={student}
          courses={courses}
          extras={extras}
          discounts={discounts}
          holidays={docHolidays}
          createdLabel={createdLabel}
          showHouseRules={showHouseRules}
        />
      </div>
    </div>
  );
}

function Group({
  title,
  hint,
  required,
  children,
}: {
  title: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border-line shadow-card space-y-2.5 rounded-2xl border p-4">
      <h2 className="text-foreground text-base font-bold">
        {title}
        {required ? <span className="text-danger"> *</span> : null}
      </h2>
      {hint ? <p className="text-text-faint text-xs">{hint}</p> : null}
      {children}
    </section>
  );
}

function AddManual({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-1.5 text-xs transition"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  );
}
