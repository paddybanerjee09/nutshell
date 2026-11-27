import Image from "next/image";
import type { ReactNode } from "react";
import artwork from "../../../../assets/brand/nutshell-logo.png";

export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href="/">Nutshell</a>
        {children && <nav aria-label="Main navigation">{children}</nav>}
      </div>
    </header>
  );
}

export function BrandArtwork({ className }: { className?: string }) {
  return (
    <div className={`artwork-tile ${className ?? ""}`}>
      <Image src={artwork} alt="" unoptimized />
    </div>
  );
}
