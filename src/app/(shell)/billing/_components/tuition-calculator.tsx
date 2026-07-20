"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Plus, Printer, Save } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { saveTuitionQuote, type SaveQuoteState } from "@/features/billing/server/tuition-quote-actions";
import { DISCOUNT_CATEGORY, type TuitionCatalogOption } from "@/features/billing/tuition-catalog";
import { koreanHolidayDatesForRange } from "@/features/billing/holidays-data";
import { autoSessions, quoteTotal } from "@/features/billing/quote-calc";
import type { QuoteStudent, QuoteCourse, QuoteExtra, QuoteDiscount } from "@/features/billing/quote-calc";
import type { QuoteDetail } from "@/features/billing/server/tuition-quote-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { AccountSetting } from "@/features/owner/settings-types";
import { CatalogPicker, CourseEditor, ExtraEditor, DiscountEditor } from "./quote-editors";
import { QuoteDocument } from "./quote-document";

const won = (n: number) => `${new Intl.NumberFormat("ko-KR").format(Math.round(n))}원`;
const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";
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

export function TuitionCalculator({
  academyName,
  logoSrc,
  defaultPeriod,
  defaultAccount,
  holidays = [],
  catalog = [],
  textbooks = [],
  initial,
}: {
  academyName: string;
  logoSrc?: string | null; // 학원 로고(서버에서 resolveBrandingSrc로 푼 signed URL) — 안내문 헤더
  defaultPeriod: string;
  defaultAccount: AccountSetting; // 입금 계좌 기본값 — 학원설정에서 '수강료 계산기'에 배선된 계좌
  holidays?: string[];
  catalog?: TuitionCatalogOption[];
  textbooks?: CatalogOption[]; // 교재 단가표(146권) — 교재/기타 picker에 합침
  initial?: QuoteDetail;
}) {
  const uidRef = useRef(0);
  const nextUid = () => `q${++uidRef.current}`;

  const [student, setStudent] = useState<QuoteStudent>({
    name: initial?.studentName ?? "",
    school: initial?.school ?? "",
    grade: initial?.grade ?? "",
    consultant: initial?.consultant ?? "",
    startDate: initial?.startDate ?? `${defaultPeriod}-01`,
    endDate: initial?.endDate ?? monthLastDay(defaultPeriod),
  });
  const [courses, setCourses] = useState<QuoteCourse[]>(initial?.courses ?? []);
  const [extras, setExtras] = useState<QuoteExtra[]>(initial?.extras ?? []);
  const [discounts, setDiscounts] = useState<QuoteDiscount[]>(initial?.discounts ?? []);
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
        note: b.bookDetail,
      })),
    ],
    [catalog, textbooks],
  );
  const discountOpts = useMemo(() => catalog.filter((c) => c.category === DISCOUNT_CATEGORY), [catalog]);

  const unionHol = (s: QuoteStudent) =>
    Array.from(new Set([...holidays, ...koreanHolidayDatesForRange(s.startDate, s.endDate)]));
  const recompute = (c: QuoteCourse, s: QuoteStudent): QuoteCourse => {
    if (c.fixedMonthly) return c;
    const sessions = autoSessions(c.days, s.startDate, s.endDate, c.excludeHolidays ? unionHol(s) : []);
    return { ...c, sessions, price: Math.round(c.perSession * sessions) };
  };

  const setPeriod = (key: "startDate" | "endDate", value: string) => {
    const s = { ...student, [key]: value };
    setStudent(s);
    setCourses((cs) => cs.map((c) => recompute(c, s)));
  };

  const addCourse = (o: TuitionCatalogOption) =>
    setCourses((cs) => [
      ...cs,
      recompute(
        {
          uid: nextUid(),
          category: o.category,
          name: o.name,
          days: "",
          perSession: o.price,
          sessions: 0,
          price: 0,
          note: o.note ?? "",
          excludeHolidays: true,
          fixedMonthly: false,
        },
        student,
      ),
    ]);

  const patchCourse = (uid: string, patch: Partial<QuoteCourse>) =>
    setCourses((cs) =>
      cs.map((c) => {
        if (c.uid !== uid) return c;
        const next = { ...c, ...patch };
        if (!next.fixedMonthly && ("days" in patch || "excludeHolidays" in patch || "fixedMonthly" in patch)) {
          return recompute(next, student);
        }
        if (!next.fixedMonthly && "sessions" in patch) {
          return { ...next, price: Math.round(next.perSession * next.sessions) };
        }
        return next;
      }),
    );

  const totals = quoteTotal(courses, extras, discounts);
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
    setCourses(d.courses);
    setExtras(d.extras);
    setDiscounts(d.discounts);
    // uid 카운터를 복원 행들의 최대치 이상으로 → 이후 nextUid()가 기존 행과 충돌 안 함.
    uidRef.current = [...d.courses, ...d.extras, ...d.discounts]
      .map((x) => Number(String(x.uid).replace(/\D/g, "")) || 0)
      .reduce((a, b) => Math.max(a, b), uidRef.current);
  }

  return (
    <div className="grid grid-cols-1 gap-5 print:block xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* 입력 (인쇄 시 숨김) */}
      <div className="space-y-4 print:hidden">
        <DraftBanner savedAt={draft.draftSavedAt} onRestore={restoreDraft} onDiscard={draft.discard} />
        {/* 학생 정보 */}
        <section className="bg-card border-line shadow-card space-y-3 rounded-2xl border p-4">
          <h2 className="text-foreground text-[15px] font-bold">상담 정보 (신입생)</h2>
          <div className="grid grid-cols-2 items-end gap-2">
            <label className="space-y-1">
              <span className="text-text-faint text-[11px]">
                학생 이름 <span className="text-danger">*</span>
              </span>
              <input className={inputCls} placeholder="학생 이름" value={student.name} onChange={(e) => setStudent({ ...student, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="학교" value={student.school} onChange={(e) => setStudent({ ...student, school: e.target.value })} />
              <input className={inputCls} placeholder="학년" value={student.grade} onChange={(e) => setStudent({ ...student, grade: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-text-faint text-[11px]">시작일</span>
              <input type="date" className={inputCls} value={student.startDate} onChange={(e) => setPeriod("startDate", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-text-faint text-[11px]">종료일</span>
              <input type="date" className={inputCls} value={student.endDate} onChange={(e) => setPeriod("endDate", e.target.value)} />
            </label>
          </div>
          <input className={inputCls} placeholder="상담자" value={student.consultant} onChange={(e) => setStudent({ ...student, consultant: e.target.value })} />
          {/* 안내문 헤더 표시 — 로고 이미지에 학원명이 들어가 있으면 하나만 켜서 중복 제거. */}
          <div className="border-line flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3">
            <span className="text-text-faint text-[11px]">안내문 헤더</span>
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
        <Group required title="수강 과목" hint="단가표에서 고르면 회당 단가가 채워집니다. 요일을 입력하면 시수·금액 자동 계산.">
          <CatalogPicker options={courseOpts} placeholder="+ 과목 추가 (단가표)" onPick={addCourse} />
          {courses.map((c) => (
            <CourseEditor key={c.uid} course={c} onPatch={(p) => patchCourse(c.uid, p)} onRemove={() => setCourses((cs) => cs.filter((x) => x.uid !== c.uid))} />
          ))}
        </Group>

        {/* 교재 및 기타 */}
        <Group title="교재 및 기타">
          <CatalogPicker
            options={extraOpts}
            placeholder="+ 교재·항목 추가 (단가표 검색)"
            onPick={(o) => setExtras((es) => [...es, { uid: nextUid(), name: o.note ? `${o.name} ${o.note}` : o.name, price: o.price, note: "" }])}
          />
          {extras.map((e) => (
            <ExtraEditor key={e.uid} extra={e} onPatch={(p) => setExtras((es) => es.map((x) => (x.uid === e.uid ? { ...x, ...p } : x)))} onRemove={() => setExtras((es) => es.filter((x) => x.uid !== e.uid))} />
          ))}
          <AddManual label="직접 입력 항목 추가" onAdd={() => setExtras((es) => [...es, { uid: nextUid(), name: "", price: 0, note: "" }])} />
        </Group>

        {/* 할인 */}
        <Group title="할인 적용">
          <CatalogPicker options={discountOpts} placeholder="+ 할인 추가 (프리셋)" onPick={(o) => setDiscounts((ds) => [...ds, { uid: nextUid(), name: o.name, amount: o.price }])} />
          {discounts.map((d) => (
            <DiscountEditor key={d.uid} discount={d} onPatch={(p) => setDiscounts((ds) => ds.map((x) => (x.uid === d.uid ? { ...x, ...p } : x)))} onRemove={() => setDiscounts((ds) => ds.filter((x) => x.uid !== d.uid))} />
          ))}
          <AddManual label="직접 입력 할인 추가" onAdd={() => setDiscounts((ds) => [...ds, { uid: nextUid(), name: "", amount: 0 }])} />
        </Group>

        {/* 입금 계좌 안내 — 안내문(우측 최종 납부 금액 위)에 표시. 기본값=학원설정(수납) 계좌, 여기서 수정 가능. */}
        <section className="bg-card border-line shadow-card space-y-2.5 rounded-2xl border p-4">
          <label className="text-foreground inline-flex items-center gap-1.5 text-[15px] font-bold">
            <input
              type="checkbox"
              checked={showAccount}
              onChange={(e) => setShowAccount(e.target.checked)}
              className="size-4"
            />
            입금 계좌 안내
          </label>
          <p className="text-text-faint text-[11px]">
            체크하면 안내문 <b>최종 납부 금액 위</b>에 입금 계좌가 표시됩니다. 학원설정(수납)에서 &lsquo;수강료
            계산기&rsquo;에 배선한 계좌가 자동으로 채워지며, 여기서 수정하면 이 안내문에만 반영됩니다.
          </p>
          {showAccount ? (
            <div className="space-y-2">
              {/* 계좌는 학원설정에서 '수강료 계산기'에 배선된 계좌가 자동으로 채워짐. 이 견적만 다르게 쓰려면 여기서 직접 수정. */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  placeholder="은행"
                  value={account.bank}
                  onChange={(e) => setAccount({ ...account, bank: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder="예금주"
                  value={account.holder}
                  onChange={(e) => setAccount({ ...account, holder: e.target.value })}
                />
              </div>
              <input
                className={inputCls}
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
            <h2 className="text-foreground text-[15px] font-bold">견적 저장</h2>
            <span className="text-primary num text-lg font-bold">{won(totals.total)}</span>
          </div>
          <p className="text-text-faint text-[11px]">신입생 상담 견적으로 저장됩니다(재원생 청구서와 별개). 저장 후 ‘저장된 청구서’ 탭에서 다시 열 수 있습니다.</p>
          <form action={formAction} className="flex items-center justify-end gap-2">
            <input type="hidden" name="studentName" value={student.name} />
            <input type="hidden" name="school" value={student.school} />
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
            ) : !student.name.trim() || courses.length === 0 ? (
              <p className="text-text-faint mr-auto text-xs">
                <span className="text-danger">*</span> 학생 이름과 수강 과목을 입력하면 저장됩니다
              </p>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" />
              인쇄
            </Button>
            <SaveBtn disabled={!student.name.trim() || courses.length === 0} />
          </form>
        </section>
      </div>

      {/* 라이브 안내문 (인쇄 시 카드 크롬 제거 → A4 전폭 세로 문서) */}
      <div className="border-line bg-card overflow-hidden rounded-md border print:overflow-visible print:rounded-none print:border-0 print:bg-white print:shadow-none">
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
      <h2 className="text-foreground text-[15px] font-bold">
        {title}
        {required ? <span className="text-danger"> *</span> : null}
      </h2>
      {hint ? <p className="text-text-faint text-[11px]">{hint}</p> : null}
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
