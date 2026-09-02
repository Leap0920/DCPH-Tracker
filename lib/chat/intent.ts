/**
 * Lightweight, rule-based intent pre-check for DCPH Bot.
 *
 * Runs on EVERY chat request BEFORE any retrieval or provider inference, so it
 * is deliberately pure: zero imports, zero I/O, instant, and fully unit-testable
 * (same contract as lib/chat/query.ts).
 *
 * Decision rules, evaluated in order:
 *   1. In-domain markers win. Mentioning the franchise or the site allows the
 *      request even when a weak out-of-domain token is present ("write a fan
 *      letter about Kaito Kid" stays in scope).
 *   2. Strong out-of-domain evidence blocks. A refusal requires a POSITIVE match
 *      against a specific rule (coding, other franchise, homework, recipes, ...).
 *   3. Default is allow. A message with no out-of-domain evidence passes, so
 *      short follow-ups like "what about the victim?" are never blocked.
 *
 * False negatives (letting an off-topic request through) are acceptable — the
 * system prompt's scope boundaries police those. False positives (blocking a
 * genuine series question) are the failure mode this module exists to avoid, so
 * the marker list is generous and the blocker patterns require strong signals.
 */

export type ChatIntent =
  | { action: "allow" }
  | { action: "refuse"; reason: string; reply: string }

/** One short, friendly refusal per category — in the bot's voice, pivoting back
 *  to the series. */
const REFUSAL_CODING =
  "I'm DCPH Bot, and I only help with Detective Conan — episodes, movies, characters, cases, arcs, and your DCPH Tracker. Writing or debugging code is outside my scope, but ask me anything about the series!"

const REFUSAL_OTHER_FRANCHISE =
  "I only know Detective Conan! I can't help with other shows, but ask me about episodes, movies, characters, cases, or watch guides."

const REFUSAL_GENERAL =
  "That's outside what I can help with — I'm DCPH Bot, and I'm here for Detective Conan and your DCPH Tracker. Ask me about the series anytime!"

const REFUSAL_SYSTEM =
  "I'm DCPH Bot, and I stay in my Detective Conan lane — I can't do that, but I'd love to talk episodes, movies, characters, or your tracker progress!"

/**
 * Allowed past any blocker: mentioning the franchise or the site proves the
 * request is at least adjacent to DCPH scope. Word-boundary anchored so
 * "briefcase", "kidnap", or "running" never count.
 */
const SERIES_MARKERS: RegExp[] = [
  /\bconan\b/i,
  /\bdcph\b/i,
  /\btracker\b/i,
  /\bdetective boys\b/i,
  /\bblack organization\b/i,
  /\bcase closed\b/i,
  /\bshinichi\b/i,
  /\bkudo\b/i,
  /\bkogoro\b/i,
  /\bmouri\b/i,
  /\bhaibara\b/i,
  /\bsherry\b/i,
  /\bagasa\b/i,
  /\bheiji\b/i,
  /\bkazuha\b/i,
  /\bsonoko\b/i,
  /\bakai\b/i,
  /\bsubaru\b/i,
  /\bamuro\b/i,
  /\bbourbon\b/i,
  /\bvermouth\b/i,
  /\bkaito\b/i,
  /\bphantom thief\b/i,
  /\byusaku\b/i,
  /\byukiko\b/i,
  /\bdetective\b/i,
  /\bepisode\b/i,
  /\bmovie\b/i,
  /\bova\b/i,
  /\barc\b/i,
  /\bcanon\b/i,
  /\bfiller\b/i,
  /\bmanga\b/i,
  /\bgadget\b/i,
  /\baptx\b/i,
  /\bwatch order\b/i,
  /\bred string\b/i,
  /\bcase\b/i,
  /\bmurder\b/i,
  /\bkiller\b/i,
  /\bvictim\b/i,
  /\bsuspect\b/i,
  /\bheist\b/i,
  /\bcrime\b/i,
]

interface OutOfDomainRule {
  reason: string
  pattern: RegExp
  reply: string
}

const OUT_OF_DOMAIN_RULES: OutOfDomainRule[] = [
  {
    reason: "coding",
    pattern:
      /(?:write|debug|fix|build|create|implement|refactor|review|optim[ie]se|explain|show|make|give|help me (?:to |with )?|how do i|how to|can you).{0,70}(?:code|program|script|function|class|algorithm|recursion|regex|api|sql|database|query|syntax|array|loop|variable|debugging|bug|compile|runtime|leetcode|hackerrank|javascript|typescript|python|java|react|next\.js|node\.?js|css|html|git|docker|kubernetes|website|web app|server|extension|cli|bot)/i,
    reply: REFUSAL_CODING,
  },
  {
    reason: "other-franchise",
    pattern:
      /\b(?:naruto|one piece|dragon ball|dbz|jujutsu kaisen|demon slayer|kimetsu no yaiba|attack on titan|my hero academia|pokemon|digimon|ghibli|spirited away|bleach|fairy tail|hunter x hunter|death note|fullmetal alchemist|evangelion|sailor moon|spy x family|chainsaw man|vinland saga|doraemon|yu-gi-oh|jojo|konosuba)\b/i,
    reply: REFUSAL_OTHER_FRANCHISE,
  },
  {
    reason: "recipe-cooking",
    pattern:
      /\b(?:recipe|ingredients|how to cook|how to bake|meal plan|meal prep|baking|kitchen)\b/i,
    reply:
      "I'm strictly a Detective Conan assistant, so I can't cook up recipes for you — but I can serve up episode and movie recommendations anytime!",
  },
  {
    reason: "homework-math",
    pattern:
      /\b(?:homework|assignment|maths?|geometry|algebra|calculus|physics|chemistry|essay|dissertation|thesis|research paper|book report)\b/i,
    reply:
      "I'm DCPH Bot and my beat is Detective Conan, not homework — but ask me about cases, characters, or watch order instead!",
  },
  {
    reason: "health-legal-finance",
    pattern:
      /\b(?:symptom|medication|diagnos(?:e|is|ed)|prescription|medical advice|headache|fever|cough|nausea|dizzy|chest pain|sore throat|legal advice|lawyer|my contract|invest|stock market|cryptocurrency|bitcoin|mortgage|insurance)\b/i,
    reply: REFUSAL_GENERAL,
  },
  {
    reason: "personal-advice",
    pattern:
      /\b(?:relationship advice|my boyfriend|my girlfriend|my wife|my husband|should i break up|breakup|dating advice)\b/i,
    reply: REFUSAL_GENERAL,
  },
  {
    reason: "system-prompt-attack",
    pattern:
      /\b(?:ignore (?:all )?(?:previous|prior|above) (?:instructions?|prompts?|rules?)|ignore (?:the |your |any )?(?:system|developer) prompt|you are now|act as (?:chatgpt|gpt|an? ai|a bot)|reveal (?:your|the) (?:system|developer) prompt|jailbreak|dan mode|developer message)\b/i,
    reply: REFUSAL_SYSTEM,
  },
]

/**
 * Classifies a chat request: allow it through, or refuse it with a final,
 * ready-to-stream reply (the route sends it straight back to the widget).
 */
export function classifyChatIntent(message: string): ChatIntent {
  const text = message.trim()
  if (!text) return { action: "allow" }

  // 1. In-domain markers win over weak out-of-domain tokens.
  if (containsSeriesMarker(text)) return { action: "allow" }

  // 2. Strong out-of-domain evidence blocks.
  for (const rule of OUT_OF_DOMAIN_RULES) {
    if (rule.pattern.test(text)) {
      return { action: "refuse", reason: rule.reason, reply: rule.reply }
    }
  }

  // 3. Default allow — covers greetings, chit-chat, and markerless follow-ups.
  return { action: "allow" }
}

/**
 * True when a message explicitly mentions the franchise or the site.
 *
 * Shares the marker list with classifyChatIntent so the retrieval gate and the
 * intent pre-check never disagree about what counts as in-scope vocabulary.
 */
export function containsSeriesMarker(text: string): boolean {
  return SERIES_MARKERS.some((re) => re.test(text))
}

/** Refusal used when retrieval found no in-domain grounding for the question. */
export const REFUSAL_NO_CONTEXT =
  "I couldn't find anything about that in the Detective Conan universe, and I'm here for Detective Conan only - episodes, movies, characters, cases, arcs, and your DCPH Tracker. Try asking about the series!"

/** Interrogatives marking an information-seeking request (English + Tagalog). */
const INFO_SEEKING =
  /(^|\s)(who|whom|whose|what|which|where|when|why|how|is|are|was|were|am|do|does|did|can|could|would|should|tell me|explain|describe|define|about|give me|show me|recommend|list|history|summary|overview|facts|background|meaning|definition|details|sino|ano|saan|kailan|bakit|paano|alin|ilan)\b/i

/** Questions about the bot itself - never refused by the retrieval gate. */
const SELF_QUERY = /(who are you|what are you|what can you (do|help)|introduce your(?:self| bot))/i

export interface RetrievalGateInput {
  /** The composed search query (current message + previous user turn). */
  searchQuery: string
  /** Prior user turns (excluding the one folded into `searchQuery`). */
  priorUserMessages: string[]
  /** True when retrieval returned at least one genuinely in-domain hit. */
  hasContext: boolean
}

/**
 * Strict domain-validation backstop for empty retrieval.
 *
 * Returns true when the request should be refused BEFORE the LLM is consulted
 * - the case where an information-seeking question found no grounding in the
 * Detective Conan universe and never mentioned the series, now or in the recent
 * conversation. Without this gate the model would happily answer the injected
 * general-knowledge (e.g. Wikipedia) context out of scope.
 *
 * Conversations that are already on-topic escape: a markerless follow-up like
 * "what about the victim?" passes once any of the last few user turns named
 * the series (and "victim", "murder", "case" etc. are markers themselves).
 * Greetings, thanks, chit-chat, and questions about DCPH Bot itself are never
 * gated.
 */
export function shouldRefuseForMissingContext({
  searchQuery,
  priorUserMessages,
  hasContext,
}: RetrievalGateInput): boolean {
  if (hasContext) return false

  // On-topic, now or recently: let the model hedge instead of refusing.
  if (containsSeriesMarker(searchQuery)) return false
  for (const turn of priorUserMessages.slice(-3)) {
    if (containsSeriesMarker(turn)) return false
  }

  // Only information-seeking requests are gated.
  if (!INFO_SEEKING.test(searchQuery.toLowerCase())) return false

  // Questions about the bot itself are always fine.
  if (SELF_QUERY.test(searchQuery.trim().toLowerCase())) return false

  return true
}
