import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

/** 푸터 — 클로징(다크 파인)에서 이어지는 다크 테일. */
export function FooterSection() {
  return (
    <footer id="footer" className="border-[var(--pine-line)] border-t bg-[var(--pine)]">
      <div className="mx-auto max-w-[1180px] px-6 py-12 sm:px-10 lg:px-16">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="border-[var(--pine-line)] flex size-8 items-center justify-center rounded-[9px] border bg-[var(--pine-2)]">
                <EyIcon name="building" size={16} className="text-[var(--mint)]" />
              </span>
              <span className="text-[var(--pine-text)] text-[18px] font-extrabold tracking-[-0.02em]">EYWA</span>
            </div>
            <p className="text-[var(--pine-dim)] mt-3 max-w-[20rem] text-[13px] leading-relaxed">
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

        <div className="border-[var(--pine-line)] mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6">
          <p className="text-[var(--pine-dim)] text-[12px]">© 2026 EYWA · 인재원 학원관리</p>
          <p className="text-[var(--pine-dim)] font-mono text-[11px] tracking-[0.08em]">made for 원장님 · since 2026</p>
        </div>
      </div>
    </footer>
  );
}

function FootCol({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="min-w-[7rem]">
      <p className="text-[var(--pine-dim)] font-mono text-[10px] font-bold tracking-[0.14em] uppercase opacity-70">
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map(([label, href]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-[var(--pine-dim)] hover:text-[var(--pine-text)] text-[13px] transition-colors"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
