import type { ReactNode } from "react";
import Link from "next/link";
import { PublicBrand } from "@/components/public-site/public-brand";
import { NAV_LINKS } from "@/data/marketing";
import { AYWA_SITE_DESCRIPTION, AYWA_SITE_TITLE } from "@/lib/config/site-metadata";
import styles from "@/components/public-site/public-site.module.css";

export const metadata = { title: AYWA_SITE_TITLE, description: AYWA_SITE_DESCRIPTION };

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.site}>
      <a href="#main-content" className={styles.skipLink}>본문으로 이동</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <PublicBrand />
          <nav className={styles.navigation} aria-label="주요 메뉴">
            {NAV_LINKS.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <Link href="/login" className={styles.headerLogin}>로그인</Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <PublicBrand />
          <p>학원의 하루를 연결하는 업무 공간</p>
          <span>© AYWA</span>
        </div>
      </footer>
    </div>
  );
}
