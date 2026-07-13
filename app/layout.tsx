import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Oswald loaded via next/font/local because it's not in Google Fonts with
// the exact weight range we need — or use Google Fonts with variable axis.
// For simplicity, using Oswald from Google Fonts:
import { Oswald } from "next/font/google";

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Detective Conan PH",
    template: "%s | Detective Conan PH",
  },
  description:
    "The Filipino Detective Conan community — track episodes, join discussions, and prove your rank in the organization.",
  openGraph: {
    title: "Detective Conan PH",
    description:
      "The Filipino Detective Conan community tracker and hub.",
    type: "website",
    locale: "en_PH",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
