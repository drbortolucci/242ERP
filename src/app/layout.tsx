import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "242ERP", template: "%s · 242ERP" },
  description: "ERP SaaS para empresas de serviços, com especialidade em consultorias",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
