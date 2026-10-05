import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TimeZoneSync } from "@/components/time-zone-sync";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: { default: "rove", template: "%s · rove" },
  description: "A calm, beautiful home for every trip you take.",
};

export const viewport: Viewport = {
  themeColor: "#fffcf8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${dmSans.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col *:min-w-0">
        {children}
        <Toaster position="bottom-center" />
        <TimeZoneSync />
      </body>
    </html>
  );
}
