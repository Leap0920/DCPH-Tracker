"use client"

import dynamic from "next/dynamic"

/**
 * Lazy host for the floating chat widget. Rendered on every route via the
 * root layout, so ssr:false + dynamic keeps its (chat + framer-motion heavy)
 * chunk out of every page's initial JS — the launcher button simply appears a
 * beat after mount.
 */
const ChatWidget = dynamic(
  () => import("@/components/chat/ChatWidget").then((m) => m.ChatWidget),
  { ssr: false }
)

export function ChatWidgetLoader() {
  return <ChatWidget />
}
