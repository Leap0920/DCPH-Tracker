import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-surface text-ink flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        {children}
      </main>
      <Footer />
    </div>
  )
}
