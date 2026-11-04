/**
 * Where the "support the project" money goes, and how to send it.
 *
 * Everything here is data, not markup: adding a second wallet should be a new
 * entry, and dropping the QR image in at `qrSrc` should be the only step
 * needed to make it live. No component needs to know about MariBank.
 */

export interface SupportMethod {
  id: string
  /** Wallet / bank name, as the donor sees it in their own app. */
  name: string
  /** What the donor scans or opens. */
  qrSrc: string
  /** One line of instruction, in the order the donor needs it. */
  instruction: string
  /**
   * Left null on purpose: an account number typed from memory is worse than
   * no number at all, and the QR already carries the destination. Fill these
   * in only from the real statement.
   */
  accountName?: string | null
  accountNumber?: string | null
}

export const SUPPORT_METHODS: SupportMethod[] = [
  {
    id: "maribank",
    name: "MariBank",
    qrSrc: "/support/maribank-qr.png",
    instruction: "Open MariBank → Scan QR → any amount. One-off or recurring, both work.",
    accountName: null,
    accountNumber: null,
  },
]

/** Honest, non-transactional reasons the money is asked for. */
export const SUPPORT_USES = [
  {
    icon: "server" as const,
    title: "Hosting and the domain",
    body: "The tracker, the API routes and the image proxy all run somewhere. That bill arrives every month whether or not anyone donates.",
  },
  {
    icon: "storage" as const,
    title: "The catalogue itself",
    body: "Episode artwork, case files and story-arc mapping live in the database. Storage and bandwidth grow with every season that airs.",
  },
  {
    icon: "no-ads" as const,
    title: "No ads, no paywall",
    body: "Progress tracking stays free and unranked. Support buys nothing extra — it just keeps the lights on.",
  },
]
