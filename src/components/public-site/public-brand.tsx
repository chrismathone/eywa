import Link from "next/link";
import { BrandMark } from "./brand-mark";
import styles from "./public-site.module.css";

/** 로그인 화면의 AYWA 표식(랜딩과 같은 등각 상자). 학원·지점 표기는 두지 않는다(결정 로그). */
export function PublicBrand() {
  return (
    <Link href="/" className={styles.brand} aria-label="AYWA 홈">
      <span className={styles.brandMark}><BrandMark size={30} /></span>
      <span>AYWA</span>
    </Link>
  );
}
