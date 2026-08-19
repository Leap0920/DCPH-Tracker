import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthModal } from "@/components/auth/AuthModal";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: "#E11D48",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Detective Conan PH",
    template: "%s | Detective Conan PH",
  },
  description:
    "The Filipino Detective Conan community: track episodes, join discussions, and prove your rank in the organization.",
  openGraph: {
    title: "Detective Conan PH",
    description:
      "The Filipino Detective Conan community tracker and hub.",
    type: "website",
    locale: "en_PH",
    images: [
      {
        url: new URL("/hero-image.jpg", siteUrl),
        width: 1200,
        height: 630,
        alt: "Detective Conan PH",
      },
    ],
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  twitter: {
    card: "summary_large_image",
    title: "Detective Conan PH",
    description:
      "The Filipino Detective Conan community tracker and hub.",
    images: [new URL("/hero-image.jpg", siteUrl)],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware forwards the per-request CSP nonce on the request headers.
  // Passing it to <html> keeps the server render and the client DOM in sync,
  // which prevents React 19's nonce-mode hydration mismatch.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${inter.variable} ${jetbrainsMono.variable} scroll-smooth`}
      nonce={nonce}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-page text-ink font-body antialiased overflow-x-hidden w-full max-w-full">
        {/* FOUC guard: apply the persisted theme to <html> BEFORE first
            paint. App Router has no manual <head>, so this
            beforeInteractive script is injected into the initial HTML and
            runs before hydration. Must stay in sync with the ThemeProvider
            initializer (same localStorage key, default light). */}
        <Script id="dcph-theme-init" strategy="beforeInteractive">
          {`(function(){try{var s=localStorage.getItem("dcph-theme");document.documentElement.classList.toggle("dark",s==="dark");}catch(e){}})();`}
        </Script>
        <ThemeProvider>
          <Providers>
            {children}
            <AuthModal />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
