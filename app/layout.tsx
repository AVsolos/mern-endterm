import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BorrowLab — Good things are better shared",
  description:
    "Equipment booking for campus labs and creative teams. Reserve equipment, manage handovers, and keep your shared toolkit working.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
