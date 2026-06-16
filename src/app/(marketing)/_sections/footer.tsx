import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

export function FooterSection() {
  return (
    <footer id="footer" className="bg-bg-soft border-line border-t">
      <div className="mx-auto max-w-[1180px] px-6 py-12 sm:px-10 lg:px-16">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
                <EyIcon name="leaf" size={16} />
              </span>
              <span className="text-foreground text-[18px] font-extrabold tracking-tight">EYWA</span>
            </div>
            <p className="text-text-dim mt-3 max-w-[20rem] text-[13px] leading-relaxed">
              학원의 모든 흐름을, 한 화면에.
              <br />
              출결 · 수납 · 상담 · 학부모 알림.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-8 gap-y-3" aria-label="푸터">
            <FootCol title="제품" items={[["흐름", "#signature"], ["효과", "#roi"], ["요금", "#pricing"]]} />
            <FootCol title="회사" items={[["도입 사례", "#voice"], ["고객 지원", "#closing"], ["로그인", "/login"]]} />
          </nav>
        </div>

        <div className="border-line mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
          <p className="text-text-faint text-[12px]">© 2026 EYWA · 인재원 학원관리</p>
          <p className="text-text-faint font-mono text-[11px] tracking-[0.08em]">made for 원장님 · since 2026</p>
        </div>
      </div>
    </footer>
  );
}

function FootCol({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="min-w-[7rem]">
      <p className="text-text-faint font-mono text-[10px] font-bold tracking-[0.14em] uppercase">{title}</p>
      <ul className="mt-3 space-y-2">
        {items.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-text-dim hover:text-foreground text-[13px] transition-colors">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
