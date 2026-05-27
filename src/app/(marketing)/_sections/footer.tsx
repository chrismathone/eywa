export function FooterSection() {
  return (
    <footer id="footer" className="bg-background border-line border-t px-16 py-8">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="bg-ink flex size-[18px] items-center justify-center rounded-[2px]">
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="8" cy="8" r="2" fill="#fff" />
            </svg>
          </span>
          <p className="text-text-dim text-[12px]">© 2026 EYWA · 인재원 학원관리</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {["이용약관", "개인정보처리방침", "사업자 정보", "고객지원"].map((label) => (
            <a
              key={label}
              href="#"
              className="text-text-dim hover:text-foreground text-[12px] transition"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
