import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthModal } from "@/components/auth/AuthModal";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ChatWidget } from "@/components/chat/ChatWidget";
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
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#000000" },
  ],
  colorScheme: "dark",
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
        // Dark banner: the share card should look like the product does.
        url: new URL("/hero-image-darkM.jpg", siteUrl),
        width: 1200,
        height: 630,
        alt: "Detective Conan PH",
      },
    ],
  },
  applicationName: "Detective Conan PH",
  appleWebApp: {
    capable: true,
    title: "DCPH",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/tab-icon.png",
    apple: "/tab-icon.png",
  },
  twitter: {
    card: "summary_large_image",
    title: "Detective Conan PH",
    description:
      "The Filipino Detective Conan community tracker and hub.",
    images: [new URL("/hero-image-darkM.jpg", siteUrl)],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware forwards the per-request CSP nonce on the request headers.
  // It belongs ONLY on the elements CSP actually checks (<script>/<style>) —
  // never on <html>. Browsers implement "nonce hiding": after parsing, the
  // nonce value is moved to the element's .nonce property and the content
  // attribute is blanked, so a nonce on <html> serializes as nonce="<value>"
  // on the server but reads back as nonce="" in the client DOM, which is
  // precisely the React 19 hydration mismatch we are avoiding here.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      // `dark` ships from the server: dark is the default, so the very
      // first painted frame is black with zero JS. The inline script below
      // only REMOVES it for the legacy light opt-in.
      className={`dark ${plusJakartaSans.variable} ${inter.variable} ${jetbrainsMono.variable} scroll-smooth`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-page text-ink font-body antialiased overflow-x-hidden w-full max-w-full">
        {/* FOUC guard, inverted for a dark-default app: <html> already has
            `dark`, so this only strips it when the visitor explicitly chose
            light. Net effect — dark users never flash, light users flip
            before first paint. Must stay in sync with
            components/theme-provider.tsx (same key "dcph-theme-v2", same
            default dark). Carries the CSP nonce because it is inline and a
            nonce-based policy would otherwise block it. Plain <script> with
            suppressHydrationWarning avoids the React 19 nonce-hiding hydration
            mismatch that next/script + nonce triggers. */}
        <script
          id="dcph-theme-init"
          suppressHydrationWarning
          {...(nonce ? { nonce } : {})}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("dcph-theme-v2")==="light"){document.documentElement.classList.remove("dark");}}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <Providers>
            {children}
            <AuthModal />
            <ServiceWorkerRegister />
            <ChatWidget />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
