import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Korakuen",
  description: "Sistema de gestión — Constructora Korakuen E.I.R.L.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
