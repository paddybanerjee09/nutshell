import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: { default: "Nutshell", template: "%s | Nutshell" },
  description: "Your codebase. In a Nutshell.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
