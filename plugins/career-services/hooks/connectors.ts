// Gmail and Google Calendar, read through whatever connectors the session has, with $.mcp.call.
// Pure shaping only, so tests can feed it recorded answers. Mail and event text is shown, never acted on.
import type { CalItem, CalKind, MailItem, MailKind } from '../types'

type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : [])

/**
 * The servers to try for a tool: any connected server offering it whose description matches, then the
 * claude.ai connector's usual name. Hosts name the same connector differently, so we look before we guess.
 */
export function serversFor(tools: { name: string; description: string }[], tool: string, about: RegExp, fallback: string): string[] {
  const found = tools
    .filter(t => t.name.startsWith('mcp__') && t.name.endsWith(`__${tool}`) && about.test(t.description))
    .map(t => t.name.slice(5, -(tool.length + 2)))
  return [...new Set([...found, fallback])]
}

/** An MCP tool's answer: structuredContent when the server declares it, else the JSON in its first text block. */
export function mcpJson(result: { content: { type: string; text?: string }[]; structuredContent?: unknown }): Raw {
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent as Raw
  const text = result.content.find(b => b.type === 'text')?.text ?? ''
  return text.trim().startsWith('{') ? (JSON.parse(text) as Raw) : {}
}

// ---------------- Gmail ----------------
const ATS = ['greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com', 'myworkday.com', 'workday.com', 'hackerrank.com',
  'codesignal.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com', 'hirevue.com', 'rippling.com']
export const MAIL_QUERY = 'newer_than:30d -in:sent -category:promotions (subject:(application OR applying OR interview OR ' +
  `assessment OR "next steps" OR candidacy OR offer OR "coding challenge" OR "your interest") OR from:(${ATS.join(' OR ')}))`

// Job-board marketing matches the query but records nothing
const NOISE = /top applicant|is about to close|jobs? (you may|for you)|recommended for you|new jobs|job alert|webinar|newsletter/i
// Order matters: a rejection often thanks you for your interest, and an assessment invite often says interview
const KINDS: [MailKind, RegExp][] = [
  ['offer', /pleased to offer|offer letter|extend(ing)? (you )?an offer/i],
  ['rejection', /unfortunately|not (be )?moving forward|other candidates|decided not to|not been selected|regret to|will not be proceeding|position has been filled/i],
  ['assessment', /assessment|hackerrank|codesignal|coding challenge|online test|hirevue|codility|take-?home/i],
  ['interview', /interview|schedule (a|your)|your availability|next round|superday|phone screen|speak with you/i],
  ['applied', /application (was )?(sent|received|submitted|confirmation)|thank(s| you) for (applying|your application|your interest)|received your application|we('ve| have) received/i],
]
const SENDER_WORDS = /\b(careers?|recruiting|recruitment|talent( acquisition)?|team|jobs|hr|hiring|university|campus|no-?reply|notifications?)\b/gi
const BOARDS = /linkedin|handshake|indeed|glassdoor|ziprecruiter|gmail/i

export function companyOf(subject: string, displayName: string, email: string): string {
  const fromSubject = subject.match(/application was sent to (.+)$/i)
    ?? subject.match(/^(.+?) (?:application confirmation|application received)/i)
    ?? subject.match(/(?:applying to|interest in|application (?:to|with)|interview (?:with|at)) ([A-Z][\w&.' -]{1,40}?)(?:[!,.:|]| - | – |$)/)
  if (fromSubject) return fromSubject[1]!.trim()
  const name = displayName.replace(SENDER_WORDS, ' ').replace(/[|,·:-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (name && !BOARDS.test(name)) return name
  const host = email.split('@')[1] ?? ''
  if (BOARDS.test(host) || ATS.some(a => host.endsWith(a))) return ''
  const parts = host.split('.')
  const base = parts.length >= 2 ? parts[parts.length - 2]! : ''
  return base ? base[0]!.toUpperCase() + base.slice(1) : ''
}

export function classify(subject: string, snippet: string): MailKind | null {
  if (NOISE.test(subject)) return null
  const text = `${subject} ${snippet}`
  for (const [kind, re] of KINDS) if (re.test(text)) return kind
  return 'update'
}

export function shapeMail(raw: Raw): MailItem[] {
  const out: MailItem[] = []
  for (const t of arr(raw.threads)) {
    const m = arr(t.messages).at(-1)
    if (!m) continue
    const subject = str(m.subject)
    const kind = classify(subject, str(m.snippet))
    if (!kind) continue
    const sender = str(m.sender)
    const named = arr(m.addressDisplayNames).find(a => str(a.emailAddress) === sender)
    out.push({
      id: str(t.id),
      kind,
      company: companyOf(subject, str(named?.displayName), sender),
      subject,
      from: str(named?.displayName) || sender,
      date: str(m.date).slice(0, 10),
      url: str(t.viewUrl ?? m.viewUrl),
      unread: arr(m.labelIds).some(l => (l as unknown) === 'UNREAD'),
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

// ---------------- Google Calendar ----------------
// Keep recruiting deadlines, interviews and career events; leave classes and everyday events out
const COURSEWORK = /\b[A-Z]{2,4}\s?\d{3,4}\b|problem set|homework|lecture|midterm|final exam|quiz/
const INTERVIEW = /interview|superday|phone screen|technical screen|online assessment|\bOA\b/i
const EVENT = /coffee chat|info session|career fair|networking|recruit|office hours with|meet the firm/i

export function kindOf(title: string): CalKind | null {
  if (/^\s*(DEADLINE|Deadline|DUE)\b/.test(title)) return COURSEWORK.test(title) ? null : 'deadline'
  if (COURSEWORK.test(title)) return null
  if (INTERVIEW.test(title)) return 'interview'
  if (EVENT.test(title)) return 'event'
  return null
}

export function shapeEvents(raw: Raw): CalItem[] {
  const out: CalItem[] = []
  for (const ev of arr(raw.events)) {
    const title = str(ev.summary)
    const kind = kindOf(title)
    if (!kind) continue
    const start = (ev.start ?? {}) as Raw
    out.push({ id: str(ev.id), kind, title, start: str(start.dateTime ?? start.date), allDay: !start.dateTime, link: str(ev.htmlLink) })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

/** "DEADLINE 11:00 PM — Example Co Software Intern" → "Example Co Software Intern". */
export const eventName = (t: string) => t.replace(/^\s*(?:DEADLINE|Deadline|DUE)\b(?:.*?\s[—–-]\s+|:\s*)/, '').trim() || t
