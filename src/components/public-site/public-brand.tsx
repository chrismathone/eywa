import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import styles from "./public-site.module.css";

export function PublicBrand() {
  return (
    <Link href="/" className={styles.brand} aria-label="AYWA 홈">
      <span className={styles.brandMark}><EyIcon name="building" size={22} /></span>
      <span>AYWA</span>
    </Link>
  );
}
