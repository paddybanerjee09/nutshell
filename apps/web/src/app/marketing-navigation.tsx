"use client";

import { Menu } from "lucide-react";
import { useRef } from "react";

const sections = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how-it-works" },
] as const;

export function MarketingSectionLinks() {
  const menu = useRef<HTMLDetailsElement>(null);

  function closeMenu(restoreFocus: boolean) {
    if (!menu.current) return;
    menu.current.open = false;
    if (restoreFocus) menu.current.querySelector("summary")?.focus();
  }

  return <>
    <div className="marketing-section-links">
      {sections.map(({ label, href }) => <a key={href} href={href}>{label}</a>)}
    </div>
    <details ref={menu} className="marketing-mobile-menu" onKeyDown={(event) => {
      if (event.key === "Escape" && menu.current?.open) {
        event.stopPropagation();
        closeMenu(true);
      }
    }}>
      <summary><Menu aria-hidden="true" size={16} strokeWidth={1.5} />Menu</summary>
      <div className="marketing-section-menu">
        {sections.map(({ label, href }) => <a key={href} href={href} onClick={() => closeMenu(false)}>{label}</a>)}
      </div>
    </details>
  </>;
}
