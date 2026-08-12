import type { Metadata } from "next";
import { getPublicBranding } from "@/features/owner/server/public-branding";
import { CONSENT_BASIS, CONSENT_LABELS } from "@/lib/consent/snapshot";
import { RECORDING_RETENTION_DAYS, TRANSCRIPT_RETENTION_DAYS } from "@/lib/storage/retention";

/**
 * 개인정보 처리방침 — **비로그인 공개** 페이지(2026-08-12 개인정보 검토 M-1).
 *
 * 🔴 처리방침은 동의와 **별개의 의무**다(제30조): 동의를 받든 안 받든 수립·공개해야 하고,
 * 위탁(수탁자) 현황도 여기서 공개한다(제26조). 종전엔 이 페이지 자체가 없었다.
 *
 * ⚠️ 동의 문구는 학원설정에서 원장이 편집하지만, **위탁·국외이전 표는 코드가 소유한다** —
 *    실제로 어떤 사업자를 쓰는지는 코드가 아는 사실이고, 손으로 적게 하면 반드시 실제와 어긋난다
 *    (문구는 안 고쳐지고 provider만 바뀌는 상황). 새 외부 처리자를 붙이면 **여기 표에도 추가**할 것.
 * ⚠️ 보유기간 숫자는 retention.ts 상수를 그대로 읽는다 — 코드가 지우는 날짜와 화면 표기가 갈라지지 않게.
 */
export const metadata: Metadata = {
  title: "개인정보 처리방침",
  robots: { index: false },
};

/** 외부 처리자(수탁) 현황 — 코드가 실제로 호출하는 곳. 새 외부 전송을 추가하면 여기도 반드시 추가. */
const PROCESSORS = [
  {
    name: "AssemblyAI, Inc.",
    country: "미국",
    purpose: "상담 녹음의 음성을 문자로 변환(전사)",
    items: "상담 녹음 파일",
  },
  {
    name: "Anthropic PBC",
    country: "미국",
    purpose: "상담 내용 요약·정리, 수업 보고서 문구 생성",
    items: "전사 내용, 학생 성명·학년·학교, 학부모 성명",
  },
  {
    name: "주식회사 업스테이지",
    country: "대한민국",
    purpose: "상담 내용 요약·정리(대체 처리자)",
    items: "전사 내용, 학생 성명·학년·학교, 학부모 성명",
  },
  {
    name: "Supabase, Inc.",
    country: "대한민국(서울 리전)",
    purpose: "학원 데이터 보관 및 파일 저장",
    items: "학원 운영에 필요한 전체 항목",
  },
  {
    name: "Vercel, Inc.",
    country: "미국",
    purpose: "서비스 운영(웹 호스팅)",
    items: "접속 기록",
  },
] as const;

const RETENTION_ROWS = [
  { what: "상담 녹음의 전사(대화 내용을 그대로 옮긴 글)", period: `상담일로부터 ${TRANSCRIPT_RETENTION_DAYS}일` },
  { what: "상담 녹음 원본 파일", period: `녹음일로부터 ${RECORDING_RETENTION_DAYS}일` },
  { what: "상담 기록·요약", period: "재원 기간 및 퇴원 후 1년 (미등록 상담은 상담일로부터 1년)" },
  { what: "출결·성적·수납 기록", period: "재원 기간 및 퇴원 후 1년" },
] as const;

const CONSENT_ORDER = ["privacy", "overseas", "sensitive"] as const;

export default async function PrivacyPolicyPage() {
  const branding = await getPublicBranding();
  const academy = branding?.settings.profile.name ?? "본 학원";
  const rep = branding?.settings.profile.representativeName?.trim();
  const email = branding?.settings.profile.email?.trim();
  const phone = branding?.settings.profile.phone?.trim();

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-foreground text-2xl font-bold">개인정보 처리방침</h1>
      <p className="text-text-dim mt-2 text-sm">
        {academy}은(는) 학생·학부모의 개인정보를 아래와 같이 처리합니다.
      </p>

      <Section title="1. 수집하는 항목과 이용 목적">
        <p>
          학생의 성명·학년·학교·생년월일·성별·연락처, 학부모의 성명·연락처·관계, 상담 기록, 출결·성적·수납
          기록을 수업 배정, 학습 관리, 상담 기록의 작성과 보관, 수강료 청구 및 학부모 안내를 위해 처리합니다.
        </p>
        <p>
          상담 녹음에 동의하신 경우, 상담 내용을 정확히 기록하기 위해 녹음 파일과 그 전사 내용을 함께
          처리합니다. <strong>녹음은 필수가 아니며, 동의하지 않으셔도 상담과 등록에는 아무런 제한이 없습니다.</strong>
        </p>
      </Section>

      <Section title="2. 동의를 받는 항목">
        <p>아래 항목은 법에 따라 각각 나누어 동의를 받습니다.</p>
        <ul className="mt-2 space-y-1.5">
          {CONSENT_ORDER.map((key) => (
            <li key={key} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-foreground font-bold">{CONSENT_LABELS[key]}</span>
              <span className="text-text-dim text-[13px]">{CONSENT_BASIS[key]}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="3. 보유 및 이용 기간">
        <Table
          head={["항목", "보유 기간"]}
          rows={RETENTION_ROWS.map((r) => [r.what, r.period])}
        />
        <p className="mt-2">
          보유 기간이 지난 정보는 자동으로 삭제되며, 다른 법령이 보존 기간을 정한 경우에는 그 기간을 따릅니다.
        </p>
      </Section>

      <Section title="4. 처리 위탁 및 국외 이전 현황">
        <p>
          상담 녹음의 전사와 요약을 위해 아래 사업자에게 처리를 위탁하고 있으며, 일부는 국외로 이전됩니다.
          이전은 녹음이 등록되는 즉시 암호화된 인터넷 통신으로 이루어집니다.
        </p>
        <Table
          head={["이전받는 자", "국가", "이전 항목", "이용 목적"]}
          rows={PROCESSORS.map((p) => [p.name, p.country, p.items, p.purpose])}
        />
        <p className="mt-2">
          <strong>국외 이전을 거부하실 수 있습니다.</strong> 거부하시면 녹음과 자동 요약 기능만 제공되지
          않으며, 상담을 포함한 그 밖의 모든 서비스는 제한 없이 이용하실 수 있습니다.
        </p>
      </Section>

      <Section title="5. 정보주체의 권리">
        <p>
          학생 본인 또는 법정대리인은 개인정보의 열람·정정·삭제·처리정지를 요구하실 수 있습니다.
          만 14세 미만 아동의 개인정보는 법정대리인의 동의를 받아 처리합니다.
        </p>
      </Section>

      <Section title="6. 문의처">
        <p>
          {rep ? `개인정보 보호책임자: ${rep}` : "개인정보 보호책임자: 학원 대표자"}
          {phone ? ` · 전화 ${phone}` : ""}
          {email ? ` · 이메일 ${email}` : ""}
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border mt-8 border-t pt-6">
      <h2 className="text-foreground text-base font-bold">{title}</h2>
      <div className="text-text-dim mt-2.5 space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    // 좁은 화면에서 표가 본문을 밀지 않게 자기 컨테이너 안에서만 가로 스크롤(전역 규약).
    <div className="border-border mt-3 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-bg-soft">
            {head.map((h) => (
              <th key={h} className="text-foreground border-border border-b px-3 py-2 text-left font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-border [&:not(:last-child)]:border-b">
              {r.map((c, j) => (
                <td key={j} className="text-text-dim px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
