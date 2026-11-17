// The drawing: one function per area, all fed one Ctx built in register.tsx. The layout borrows from
// dashboard-style career sites: a "next move" card up top, uppercase section labels, segmented toggles,
// company tiles, and empty states that say what to do.
import type {
  BoxProps, ButtonProps, ElementConstructor, InputProps, LinkProps, MarkdownProps, RenderElement, SelectProps, SvgProps, TextProps,
} from 'claude-code'

import type { CalItem, Data, Feed, Interview, MailItem, Move, Role, Stage, Tab } from '../types'
import { eventName } from './connectors'
import {
  QUESTIONS, STAGES, TOPICS, appliedThisWeek, companyView, daysBetween, heroSvg, markSvg, nextMoves, plural, progress, ringSvg, sameCompany,
  stageLabel, tileSvg, topicBars, whenText,
} from './data'

export type UI = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
  Svg?: ElementConstructor<SvgProps>
  Input?: ElementConstructor<InputProps>
  Select?: ElementConstructor<SelectProps>
  Markdown?: ElementConstructor<MarkdownProps>
}

type Press = () => Promise<void>
export type Act = {
  go: (tab: Tab, sub?: string) => Press
  setSub: (tab: Tab, value: string) => Press
  openRole: (id: string) => Press
  openCompany: (name: string) => Press
  openGuide: (id: string) => Press
  back: Press
  setForm: (key: string, value: string) => Promise<void>
  setup: Press
  refresh: Press
  refreshMail: Press
  refreshCal: Press
  moveRole: (id: string, stage: Stage) => Press
  addRole: Press
  addCompany: (name: string) => Promise<void>
  removeCompany: (name: string) => Press
  addPerson: (company: string) => Press
  logTalk: Press
  markReplied: (index: number) => Press
  logAttempt: Press
  ask: (question: string) => Promise<void>
  interview: { start: (r: Role) => Press; answer: (text: string) => Promise<void>; finish: Press; reset: Press }
}

export type Ctx = {
  ui: UI
  act: Act
  d: Data
  mail: Feed<MailItem>
  cal: Feed<CalItem>
  tab: Tab
  sub: Record<string, string>
  selected: string
  company: string
  guide: string
  form: Record<string, string>
  note: string
  interview: Interview | null
  today: string
  width: number
}

const TABS: [Tab, string, string][] = [
  ['home', 'Home', '1'], ['jobs', 'Jobs', '2'], ['network', 'Network', '3'], ['inbox', 'Inbox', '4'], ['prep', 'Prep', '5'], ['playbook', 'Playbook', '6'],
]
const SUBS: Partial<Record<Tab, [string, string][]>> = {
  jobs: [['watch', 'Watch list'], ['board', 'Board'], ['add', 'Add a role']],
  network: [['people', 'People'], ['conversations', 'Conversations']],
}
const people = (n: number) => (n === 1 ? '1 person' : `${n} people`)

export function render(x: Ctx): RenderElement {
  if (!x.d.ready) return welcome(x)
  if (x.selected) {
    const r = x.d.roles.find(role => role.id === x.selected)
    if (r) return roleView(x, r)
  }
  if (x.company) return companyPage(x, x.company)
  switch (x.tab) {
    case 'jobs': return jobs(x)
    case 'network': return network(x)
    case 'inbox': return inbox(x)
    case 'prep': return prep(x)
    case 'playbook': return playbook(x)
    default: return home(x)
  }
}

// ---------------- shared pieces ----------------
function pic(x: Ctx, source: string, alt: string, size?: number) {
  const { Svg } = x.ui
  return Svg ? <Svg source={source} alt={alt} width={size} /> : null
}
function label(x: Ctx, text: string, key: string) {
  const { Text } = x.ui
  return <Text key={key} size="caption" weight="semibold" dimColor>{text.toUpperCase()}</Text>
}
function chip(x: Ctx, text: string, color: string, key: string) {
  const { Text } = x.ui
  return <Text key={key} size="caption" weight="semibold" color={color}>{text}</Text>
}
function tile(x: Ctx, name: string, size = 34) {
  const { Svg, Text } = x.ui
  return Svg ? <Svg source={tileSvg(name, size)} alt={name} width={size} /> : <Text weight="bold">{name.slice(0, 1)}</Text>
}
const subOf = (x: Ctx, tab: Tab) => x.sub[tab] ?? SUBS[tab]?.[0]?.[0] ?? ''
function seg(x: Ctx, tab: Tab) {
  const { Box, Button } = x.ui
  const current = subOf(x, tab)
  return (
    <Box key={`seg-${tab}`} flexDirection="row" gap={0} flexWrap="wrap">
      {(SUBS[tab] ?? []).map(([k, text]) => (
        <Button key={`sub-${tab}-${k}`} variant={current === k ? 'primary' : 'secondary'} onPress={x.act.setSub(tab, k)}>{text}</Button>
      ))}
    </Box>
  )
}
function input(x: Ctx, key: string, placeholder: string, onSubmit?: () => Promise<void>) {
  const { Input } = x.ui
  if (!Input) return null
  return <Input key={key} placeholder={placeholder} value={x.form[key] ?? ''} onInput={v => void x.act.setForm(key, v)} onSubmit={() => void onSubmit?.()} />
}
function feedNote(x: Ctx, feed: Feed<unknown>, what: string, retry: Press, key: string) {
  const { Box, Text, Button } = x.ui
  if (feed.status === 'loading' && !feed.items.length) return <Text key={key} size="caption" dimColor>Reading {what}…</Text>
  if (feed.status !== 'error') return null
  return (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
      <Text size="caption" dimColor wrap="wrap">{what[0]!.toUpperCase() + what.slice(1)} is not available: {feed.error}</Text>
      <Button key={`${key}-retry`} dimColor onPress={retry}>Retry</Button>
    </Box>
  )
}

function header(x: Ctx) {
  const { Box, Text, Button, Input } = x.ui
  const unread = x.mail.items.filter(m => m.unread && m.kind !== 'applied').length
  const q = x.form.ask ?? ''
  return (
    <Box key="header" flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="column">
          <Text size="title" weight="bold">Career Services</Text>
          <Text size="caption" dimColor>{plural(x.d.roles.filter(r => r.stage !== 'archived').length, 'role')} · {people(x.d.people.length)}</Text>
        </Box>
        <Button key="refresh" dimColor onPress={x.act.refresh}>↻</Button>
      </Box>
      {x.note ? <Text size="caption" color="error" wrap="wrap">{x.note}</Text> : null}
      {Input ? (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1}>
            <Input key="ask" placeholder="Ask about your search" value={q} onInput={v => void x.act.setForm('ask', v)} onSubmit={v => void x.act.ask(v)} />
          </Box>
          <Button key="ask-go" onPress={() => x.act.ask(q)}>Ask</Button>
        </Box>
      ) : null}
      <Box flexDirection="row" gap={0} flexWrap="wrap">
        {TABS.map(([k, text, hk]) => (
          <Button key={`tab-${k}`} hotkey={hk} variant={x.tab === k ? 'primary' : 'secondary'} onPress={x.act.go(k)}>
            {k === 'inbox' && unread ? `${text} ${unread}` : text}
          </Button>
        ))}
      </Box>
    </Box>
  )
}

function roleRow(x: Ctx, r: Role, key: string, extra?: RenderElement) {
  const { Box, Text, Button } = x.ui
  const days = r.deadline ? daysBetween(x.today, r.deadline) : null
  return (
    <Box key={key} flexDirection="row" gap={1} alignItems="center" hover={{ backgroundColor: 'inactive' }}>
      {tile(x, r.company, 30)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text weight="semibold" wrap="truncate-end">{r.title}</Text>
        <Text size="caption" dimColor wrap="truncate-end">{r.company} · {stageLabel(r.stage)}</Text>
      </Box>
      {days !== null && days >= 0 && ['saved', 'applying'].includes(r.stage)
        ? chip(x, days === 0 ? 'due today' : `${days}d left`, days <= 7 ? 'error' : 'warning', `${key}-dl`) : null}
      {extra ?? null}
      <Button key={`${key}-open`} label="›" dimColor onPress={x.act.openRole(r.id)} />
    </Box>
  )
}

// ---------------- first run ----------------
function welcome(x: Ctx) {
  const { Box, Text, Button } = x.ui
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text size="title" weight="bold">Career Services</Text>
      <Box key="welcome" flexDirection="column" gap={1} borderStyle="round" borderColor="success" paddingX={2} paddingY={1}>
        {pic(x, heroSvg(40), 'Start', 40)}
        <Text size="heading" weight="bold" wrap="wrap">Keep your whole search beside the chat.</Text>
        <Text dimColor wrap="wrap">
          Roles and their stages, the people you know at each company, conversations and follow-ups, practice, and your own notes. It all lives in plain files in {x.d.dir}.
        </Text>
        <Button key="setup" variant="primary" onPress={x.act.setup}>Create my folder →</Button>
      </Box>
      {x.note ? <Text size="caption" color="error" wrap="wrap">{x.note}</Text> : null}
    </Box>
  )
}

// ---------------- home ----------------
function home(x: Ctx) {
  const { Box, Text, Button, Link } = x.ui
  const d = x.d
  const moves = nextMoves(d, x.cal.items, x.today)
  const hero: Move = moves[0] ?? (d.roles.length
    ? { key: 'browse', title: 'Pick the next role to apply to', detail: 'Your watch list has everything you have saved.', label: 'Open the watch list', tab: 'jobs' }
    : { key: 'first', title: 'Add your first role', detail: 'Paste the posting link, the company and the deadline. One minute.', label: 'Add a role', tab: 'jobs' })
  const doIt = (m: Move) => (m.role ? x.act.openRole(m.role) : x.act.go(m.tab ?? 'home', m.key === 'first' ? 'add' : m.tab === 'network' ? 'conversations' : undefined))
  const week = appliedThisWeek(d.roles, x.today)
  const coming = x.cal.items.filter(c => c.start.slice(0, 10) >= x.today).slice(0, 5)
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header(x)}
      <Box key="hero" flexDirection="column" gap={1} borderStyle="round" borderColor="success" paddingX={2} paddingY={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {pic(x, heroSvg(40), 'Your next move', 40)}
          {label(x, 'Your next move', 'hero-h')}
        </Box>
        <Text size="title" weight="bold" wrap="wrap">{hero.title}</Text>
        <Text dimColor wrap="wrap">{hero.detail}</Text>
        {hero.href ? <Link key="hero-go" href={hero.href}>{`${hero.label} ↗`}</Link>
          : <Button key="hero-go" variant="primary" onPress={doIt(hero)}>{`${hero.label} →`}</Button>}
      </Box>

      {label(x, 'Your companies', 'co-h')}
      {!d.settings.companies.length ? <Text size="caption" dimColor>Add the companies you are aiming for. Each gets a page with its roles, people and conversations.</Text> : null}
      {d.settings.companies.map((name, i) => {
        const v = companyView(d, name)
        const line = v.roles.length ? `${plural(v.roles.length, 'role')}${v.stage ? ` · ${stageLabel(v.stage)}` : ''}` : 'No roles yet'
        return (
          <Box key={`co-${i}`} flexDirection="row" gap={1} alignItems="center" borderStyle="round" borderDimColor paddingX={1} hover={{ backgroundColor: 'inactive' }}>
            {tile(x, name)}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text weight="semibold">{name}</Text>
              <Text size="caption" dimColor wrap="truncate-end">{line}{v.people.length ? ` · ${people(v.people.length)}` : ''}</Text>
            </Box>
            <Button key={`co-open-${i}`} label="›" dimColor onPress={x.act.openCompany(name)} />
          </Box>
        )
      })}
      <Box key="co-add-row" flexDirection="row" gap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1}>{input(x, 'co-add', '+ Add a company', () => x.act.addCompany(x.form['co-add'] ?? ''))}</Box>
        <Button key="co-add-go" onPress={() => x.act.addCompany(x.form['co-add'] ?? '')}>Add</Button>
      </Box>

      {label(x, 'Coming up', 'cal-h')}
      {feedNote(x, x.cal, 'your calendar', x.act.refreshCal, 'cal-note')}
      {x.cal.status === 'ok' && !coming.length ? <Text size="caption" dimColor>No deadlines, interviews or career events in the next three weeks.</Text> : null}
      {coming.map((c, i) => (
        <Box key={`cal-${i}`} flexDirection="row" gap={1} alignItems="center">
          {pic(x, markSvg(c.kind), c.kind, 26)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Link key={`cal-go-${i}`} href={c.link}>{eventName(c.title)}</Link>
            <Text size="caption" dimColor>{whenText(c.start, c.allDay)}</Text>
          </Box>
        </Box>
      ))}

      <Box key="week" flexDirection="row" gap={1} alignItems="center" borderStyle="round" borderDimColor paddingX={1}>
        {pic(x, ringSvg(week, d.settings.weeklyGoal), `${week} of ${d.settings.weeklyGoal} applications this week`, 60)}
        <Box flexDirection="column" flexShrink={1}>
          <Text weight="semibold">{plural(week, 'application')} this week</Text>
          <Text size="caption" dimColor wrap="wrap">
            {week >= d.settings.weeklyGoal ? 'Goal met.' : `${d.settings.weeklyGoal - week} more reaches your goal by Sunday.`}
          </Text>
        </Box>
      </Box>

      {moves.length > 1 ? label(x, 'Also to do', 'more-h') : null}
      {moves.slice(1, 5).map((m, i) => (
        <Box key={`mv-${m.key}`} flexDirection="row" gap={1} alignItems="center">
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text weight="semibold" wrap="wrap">{m.title}</Text>
            <Text size="caption" dimColor wrap="truncate-end">{m.detail}</Text>
          </Box>
          {m.href ? <Link key={`mv-go-${i}`} href={m.href}>{m.label}</Link> : <Button key={`mv-go-${i}`} dimColor onPress={doIt(m)}>{m.label}</Button>}
        </Box>
      ))}
    </Box>
  )
}

// ---------------- a company ----------------
function companyPage(x: Ctx, name: string) {
  const { Box, Text, Button, Link } = x.ui
  const v = companyView(x.d, name)
  const mail = x.mail.items.filter(m => m.company && sameCompany(m.company, name))
  const followed = x.d.settings.companies.some(c => sameCompany(c, name))
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Button key="back" hotkey="b" dimColor onPress={x.act.back}>← Back</Button>
        {followed ? <Button key="co-remove" dimColor onPress={x.act.removeCompany(name)}>Stop following</Button>
          : <Button key="co-follow" dimColor onPress={() => x.act.addCompany(name)}>+ Follow</Button>}
      </Box>
      <Box flexDirection="row" gap={1} alignItems="center">
        {tile(x, name, 52)}
        <Box flexDirection="column" flexShrink={1}>
          <Text size="title" weight="bold">{name}</Text>
          <Text size="caption" dimColor>{plural(v.roles.length, 'role')} · {people(v.people.length)}{v.stage ? ` · ${stageLabel(v.stage)}` : ''}</Text>
        </Box>
      </Box>

      {label(x, `Roles · ${v.roles.length}`, 'c-roles-h')}
      {v.roles.length ? v.roles.map((r, i) => roleRow(x, r, `c-r-${i}`))
        : <Button key="c-add-role" onPress={async () => { await x.act.setForm('role-company', name); await x.act.go('jobs', 'add')() }}>{`Add a role at ${name}`}</Button>}

      {label(x, `People · ${v.people.length}`, 'c-people-h')}
      {!v.people.length ? <Text size="caption" dimColor wrap="wrap">Nobody at {name} yet. Alumni and people in the role you want are the best first conversations.</Text> : null}
      {v.people.map((p, i) => (
        <Box key={`c-p-${i}`} flexDirection="column">
          <Text weight="semibold">{p.name} <Text size="caption" dimColor>{p.role}</Text></Text>
          {p.how ? <Text size="caption" dimColor wrap="wrap">{p.how}</Text> : null}
        </Box>
      ))}
      <Button key="c-add-person" dimColor onPress={async () => { await x.act.setForm('net-company', name); await x.act.go('network', 'people')() }}>Add someone you know</Button>

      {v.talks.length ? label(x, 'Conversations', 'c-talks-h') : null}
      {v.talks.map((c, i) => (
        <Text key={`c-t-${i}`} size="caption" wrap="wrap">{c.date.slice(5).replace('-', '/')} · {c.person}: {c.topic}{c.replied ? ' · replied' : ''}</Text>
      ))}
      {mail.length ? label(x, 'From your inbox', 'c-mail-h') : null}
      {mail.slice(0, 4).map((m, i) => (
        <Box key={`c-m-${i}`} flexDirection="row" gap={1} alignItems="center">
          {pic(x, markSvg(m.kind), m.kind, 24)}
          <Link key={`c-m-go-${i}`} href={m.url}>{m.subject || m.from}</Link>
        </Box>
      ))}
    </Box>
  )
}

// ---------------- a role ----------------
function roleView(x: Ctx, r: Role) {
  const { Box, Text, Button, Link, Select } = x.ui
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Button key="back" hotkey="b" dimColor onPress={x.act.back}>← Back</Button>
        <Button key="to-company" plain dimColor onPress={x.act.openCompany(r.company)}>{`${r.company} ›`}</Button>
      </Box>
      <Box flexDirection="row" gap={1} alignItems="center">
        {tile(x, r.company, 52)}
        <Box flexDirection="column" flexShrink={1}>
          <Text size="heading" weight="bold" wrap="wrap">{r.title}</Text>
          <Text dimColor wrap="wrap">{r.company}{r.location ? ` · ${r.location}` : ''}{r.deadline ? ` · due ${r.deadline.slice(5).replace('-', '/')}` : ''}</Text>
        </Box>
      </Box>
      {r.url ? <Link key="posting" href={r.url}>Open the posting ↗</Link> : null}
      {Select ? (
        <Select key="stage" label="Stage" value={r.stage} options={STAGES.map(s => ({ value: s.key, label: s.label }))}
          onSelect={v => void x.act.moveRole(r.id, v as Stage)()} />
      ) : <Text>Stage: {stageLabel(r.stage)}</Text>}
      <Box flexDirection="row" gap={0} flexWrap="wrap">
        {progress(r.stage) >= 0 && progress(r.stage) < 2 ? <Button key="mark-applied" variant="primary" onPress={x.act.moveRole(r.id, 'applied')}>I applied</Button> : null}
        <Button key="interview" onPress={x.act.interview.start(r)}>Interview me</Button>
        {r.stage !== 'archived' ? <Button key="archive" dimColor onPress={x.act.moveRole(r.id, 'archived')}>Archive</Button> : null}
      </Box>
      {r.notes ? <Text size="caption" wrap="wrap">{r.notes}</Text> : null}
      {r.history.length ? (
        <Box flexDirection="column">
          {label(x, 'Timeline', 'tl')}
          {r.history.map((step, i) => <Text key={`tl-${i}`} size="caption" dimColor>{step.at.replace('T', ' ').slice(0, 16)} · {stageLabel(step.stage)}</Text>)}
        </Box>
      ) : null}
    </Box>
  )
}

// ---------------- jobs ----------------
function jobs(x: Ctx) {
  const { Box, Text, Button } = x.ui
  const sub = subOf(x, 'jobs')
  const body: RenderElement[] = []
  if (sub === 'watch') {
    const list = x.d.roles.filter(r => r.stage === 'saved' || r.stage === 'applying')
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    if (!list.length) body.push(<Text key="w-empty" dimColor wrap="wrap">Nothing saved yet. Add a role and it shows up here, soonest deadline first.</Text>)
    list.forEach((r, i) => body.push(roleRow(x, r, `w-${i}`, r.stage === 'saved'
      ? <Button key={`w-${i}-start`} dimColor onPress={x.act.moveRole(r.id, 'applying')}>Start</Button>
      : <Button key={`w-${i}-done`} dimColor onPress={x.act.moveRole(r.id, 'applied')}>Applied</Button>)))
  } else if (sub === 'board') {
    for (const st of ['offer', 'interviewing', 'applied', 'rejected'] as Stage[]) {
      const g = x.d.roles.filter(r => r.stage === st)
      if (!g.length) continue
      body.push(label(x, `${stageLabel(st)} · ${g.length}`, `b-h-${st}`))
      g.forEach((r, i) => body.push(roleRow(x, r, `b-${st}-${i}`)))
    }
    if (!body.length) body.push(<Text key="b-empty" dimColor>No applications yet. Roles move here once you mark them applied.</Text>)
  } else {
    body.push(
      <Box key="add" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text weight="semibold">Add a role</Text>
        {input(x, 'role-company', 'Company', x.act.addRole)}
        {input(x, 'role-title', 'Role title', x.act.addRole)}
        {input(x, 'role-url', 'Link to the posting (optional)', x.act.addRole)}
        {input(x, 'role-deadline', 'Deadline, YYYY-MM-DD (optional)', x.act.addRole)}
        <Button key="role-add" variant="primary" onPress={x.act.addRole}>Save it</Button>
      </Box>,
    )
  }
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header(x)}
      {seg(x, 'jobs')}
      {body}
    </Box>
  )
}

// ---------------- network ----------------
function network(x: Ctx) {
  const { Box, Text, Button, Select } = x.ui
  const sub = subOf(x, 'network')
  const body: RenderElement[] = []
  if (sub === 'people') {
    const companies = [...new Set([...x.d.settings.companies, ...x.d.people.map(p => p.company)])]
    const company = x.form['net-company'] || companies[0] || ''
    if (Select && companies.length) {
      body.push(<Select key="net-company" label="People at" value={company} options={companies.map(c => ({ value: c, label: c }))}
        onSelect={v => void x.act.setForm('net-company', v)} />)
    }
    if (!companies.length) body.push(<Text key="n-empty" dimColor wrap="wrap">Follow a company on Home first, then add the people you know there.</Text>)
    const here = x.d.people.filter(p => sameCompany(p.company, company))
    if (company && !here.length) body.push(<Text key="n-none" size="caption" dimColor>Nobody at {company} yet.</Text>)
    here.forEach((p, i) => body.push(
      <Box key={`np-${i}`} flexDirection="row" gap={1} alignItems="center">
        {tile(x, p.company, 28)}
        <Box flexDirection="column" flexShrink={1}>
          <Text weight="semibold">{p.name} <Text size="caption" dimColor>{p.role}</Text></Text>
          {p.how ? <Text size="caption" dimColor wrap="wrap">{p.how}</Text> : null}
        </Box>
      </Box>,
    ))
    if (company) {
      body.push(
        <Box key="n-add" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
          <Text weight="semibold">Add someone you know at {company}</Text>
          {input(x, 'p-name', 'Name', x.act.addPerson(company))}
          {input(x, 'p-role', 'Their role (optional)', x.act.addPerson(company))}
          {input(x, 'p-how', 'How you know them: met at the info session, a friend of a friend…', x.act.addPerson(company))}
          <Button key="p-add" variant="primary" onPress={x.act.addPerson(company)}>Add</Button>
        </Box>,
      )
    }
  } else {
    const talks = x.d.conversations
    const due = talks.filter(c => !c.replied && c.followUp && c.followUp <= x.today)
    body.push(
      <Box key="rate" flexDirection="row" gap={2}>
        <Box flexDirection="column"><Text size="heading" weight="bold" tabular>{talks.length}</Text><Text size="caption" dimColor>reached out</Text></Box>
        <Box flexDirection="column"><Text size="heading" weight="bold" tabular color="success">{talks.filter(c => c.replied).length}</Text><Text size="caption" dimColor>replied</Text></Box>
        <Box flexDirection="column"><Text size="heading" weight="bold" tabular color="warning">{due.length}</Text><Text size="caption" dimColor>follow-ups due</Text></Box>
      </Box>,
    )
    talks.forEach((c, i) => body.push(
      <Box key={`cv-${i}`} flexDirection="row" gap={1} alignItems="center" borderStyle="round" borderDimColor paddingX={1}>
        {tile(x, c.company || c.person, 28)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text weight="semibold" wrap="truncate-end">{c.person} <Text size="caption" dimColor>{c.company}</Text></Text>
          <Text size="caption" dimColor wrap="truncate-end">{c.date.slice(5).replace('-', '/')} · {c.topic}</Text>
        </Box>
        {c.replied ? chip(x, 'Replied', 'success', `cv-${i}-st`)
          : <Button key={`cv-${i}-replied`} dimColor onPress={x.act.markReplied(i)}>{c.followUp && c.followUp <= x.today ? 'Follow up due' : 'Mark replied'}</Button>}
      </Box>,
    ))
    body.push(
      <Box key="t-add" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text weight="semibold">Log a conversation</Text>
        {input(x, 't-person', 'Who', x.act.logTalk)}
        {input(x, 't-company', 'Company', x.act.logTalk)}
        {input(x, 't-topic', 'What about: a 15-minute call, a referral, a thank-you…', x.act.logTalk)}
        <Text size="caption" dimColor>Follow-up is set a week out.</Text>
        <Button key="t-add-go" variant="primary" onPress={x.act.logTalk}>Log it</Button>
      </Box>,
    )
  }
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header(x)}
      {seg(x, 'network')}
      {body}
    </Box>
  )
}

// ---------------- inbox ----------------
const GROUPS: [MailItem['kind'], string][] = [
  ['offer', 'Offers'], ['interview', 'Interview invites'], ['assessment', 'Assessments'], ['update', 'Replies and updates'],
  ['applied', 'Application confirmations'], ['rejection', 'Rejections'],
]

function inbox(x: Ctx) {
  const { Box, Text, Button, Link } = x.ui
  const action = (m: MailItem) => {
    const r = m.company ? x.d.roles.filter(role => sameCompany(role.company, m.company) && role.stage !== 'archived')
      .sort((a, b) => progress(b.stage) - progress(a.stage))[0] : undefined
    if (!r) return <Text key={`mx-${m.id}`} size="caption" dimColor>Not tracked</Text>
    const want: Stage | '' = m.kind === 'applied' ? 'applied' : m.kind === 'interview' || m.kind === 'assessment' ? 'interviewing'
      : m.kind === 'rejection' ? 'rejected' : m.kind === 'offer' ? 'offer' : ''
    if (!want || r.stage === want || (want !== 'rejected' && (r.stage === 'rejected' || progress(r.stage) >= progress(want)))) {
      return chip(x, `${stageLabel(r.stage)} ✓`, 'success', `mx-${m.id}`)
    }
    return <Button key={`mx-${m.id}`} dimColor onPress={x.act.moveRole(r.id, want)}>{`Move to ${stageLabel(want)}`}</Button>
  }
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header(x)}
      <Box key="intro" flexDirection="column" gap={1} borderStyle="round" borderColor="success" paddingX={2} paddingY={1}>
        <Text size="heading" weight="bold">Your inbox does the logging.</Text>
        <Text size="caption" dimColor wrap="wrap">Confirmations, interview invites, assessments and rejections from the last 30 days of Gmail, matched to the roles you track. One tap moves a role. Nothing is sent.</Text>
        <Button key="mail-refresh" onPress={x.act.refreshMail}>{x.mail.status === 'loading' ? 'Reading Gmail…' : 'Refresh'}</Button>
      </Box>
      {feedNote(x, x.mail, 'Gmail', x.act.refreshMail, 'mail-note')}
      {x.mail.status === 'ok' && !x.mail.items.length ? <Text dimColor>No recruiting mail in the last 30 days.</Text> : null}
      {GROUPS.map(([kind, title]) => {
        const items = x.mail.items.filter(m => m.kind === kind)
        if (!items.length) return null
        return (
          <Box key={`mg-${kind}`} flexDirection="column" gap={0}>
            {label(x, `${title} · ${items.length}`, `mg-h-${kind}`)}
            {items.slice(0, 12).map(m => (
              <Box key={`m-${m.id}`} flexDirection="row" gap={1} alignItems="center">
                {pic(x, markSvg(m.kind), m.kind, 26)}
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  <Text weight={m.unread ? 'bold' : 'semibold'} wrap="truncate-end">{m.company || m.from}</Text>
                  <Link key={`m-go-${m.id}`} href={m.url}>{m.subject}</Link>
                </Box>
                <Box flexDirection="column" alignItems="flex-end">
                  <Text size="caption" dimColor>{m.date.slice(5).replace('-', '/')}</Text>
                  {action(m)}
                </Box>
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

// ---------------- prep ----------------
function prep(x: Ctx) {
  const { Box, Text, Button, Select } = x.ui
  const a = x.d.attempts
  const byTopic = TOPICS.map(topic => ({ topic, n: a.filter(t => t.topic === topic).length })).filter(t => t.n > 0)
  const solo = a.filter(t => t.result === 'solo').length
  const interviews = x.cal.items.filter(c => c.kind === 'interview' && c.start.slice(0, 10) >= x.today)
  const active = x.d.roles.filter(r => ['interviewing', 'applied', 'applying'].includes(r.stage)).sort((p, q) => progress(q.stage) - progress(p.stage))
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header(x)}
      {interviews.length ? label(x, 'Interviews coming up', 'iv-h') : null}
      {interviews.map((c, i) => (
        <Box key={`iv-${i}`} flexDirection="row" gap={1} alignItems="center">
          {pic(x, markSvg('interview'), 'interview', 26)}
          <Text wrap="wrap">{c.title} <Text size="caption" dimColor>{whenText(c.start, c.allDay)}</Text></Text>
        </Box>
      ))}
      {interviewBox(x)}
      {label(x, 'Mock interviews', 'mk-h')}
      {!active.length ? <Text size="caption" dimColor>Roles you are applying to or interviewing for show up here.</Text> : null}
      {active.slice(0, 6).map((r, i) => (
        <Box key={`mk-${i}`} flexDirection="row" gap={1} alignItems="center">
          {tile(x, r.company, 28)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text weight="semibold" wrap="truncate-end">{r.company}</Text>
            <Text size="caption" dimColor wrap="truncate-end">{r.title}</Text>
          </Box>
          <Button key={`mk-${i}-go`} onPress={x.act.interview.start(r)}>Interview me</Button>
        </Box>
      ))}
      <Box key="drills" flexDirection="row" gap={1} alignItems="center" borderStyle="round" borderColor="success" paddingX={2} paddingY={1}>
        {pic(x, ringSvg(solo, Math.max(1, a.length)), `${solo} of ${a.length} attempts solved without help`, 60)}
        <Box flexDirection="column" flexShrink={1}>
          <Text size="heading" weight="bold">Practice</Text>
          <Text size="caption" dimColor wrap="wrap">{plural(a.length, 'attempt')} logged, {solo} solved without help.</Text>
        </Box>
      </Box>
      {byTopic.length ? pic(x, topicBars(byTopic, x.width - 24), byTopic.map(t => `${t.topic} ${t.n}`).join(', '), x.width - 24) : null}
      <Box key="log" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text weight="semibold">Log an attempt</Text>
        {input(x, 'a-problem', 'Problem', x.act.logAttempt)}
        {Select ? <Select key="a-topic" label="Topic" value={x.form['a-topic'] || TOPICS[0]!} options={TOPICS.map(t => ({ value: t, label: t }))} onSelect={v => void x.act.setForm('a-topic', v)} /> : null}
        {Select ? <Select key="a-result" label="Result" value={x.form['a-result'] || 'solo'}
          options={[{ value: 'solo', label: 'Solved it alone' }, { value: 'hint', label: 'Needed a hint' }, { value: 'solution', label: 'Read the solution' }]}
          onSelect={v => void x.act.setForm('a-result', v)} /> : null}
        {input(x, 'a-minutes', 'Minutes', x.act.logAttempt)}
        <Button key="a-log" variant="primary" onPress={x.act.logAttempt}>Log it</Button>
      </Box>
      {a.slice(0, 6).map((t, i) => (
        <Text key={`a-${i}`} size="caption" dimColor>{t.date.slice(5).replace('-', '/')} · {t.problem} · {t.topic} · {t.result}{t.minutes ? ` · ${t.minutes} min` : ''}</Text>
      ))}
    </Box>
  )
}

function interviewBox(x: Ctx) {
  const { Box, Text, Button, Input, Markdown } = x.ui
  const iv = x.interview
  if (!iv) return null
  const asked = iv.turns.filter(t => t.who === 'interviewer').length
  return (
    <Box key="iv" flexDirection="column" gap={1} borderStyle="round" borderColor="success" paddingX={1} paddingY={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {tile(x, iv.company, 34)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text weight="bold" wrap="truncate-end">Mock interview · {iv.company}</Text>
          <Text size="caption" dimColor wrap="truncate-end">{iv.title} · question {Math.max(1, asked)} of about {QUESTIONS}</Text>
        </Box>
        <Button key="iv-reset" plain dimColor onPress={x.act.interview.reset}>End</Button>
      </Box>
      {iv.turns.map((t, i) => (t.who === 'interviewer' ? (
        <Box key={`iv-t-${i}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text size="caption" weight="semibold" color="success">Interviewer</Text>
          <Text wrap="wrap">{t.text}</Text>
        </Box>
      ) : (
        <Box key={`iv-t-${i}`} flexDirection="column" paddingLeft={2}>
          <Text size="caption" weight="semibold" dimColor>You</Text>
          <Text dimColor wrap="wrap">{t.text}</Text>
        </Box>
      )))}
      {iv.status === 'thinking' ? <Text size="caption" dimColor>{iv.turns.at(-1)?.who === 'interviewer' ? 'Writing your feedback…' : 'The interviewer is thinking…'}</Text> : null}
      {iv.status === 'error' ? <Text size="caption" color="warning" wrap="wrap">{iv.error}</Text> : null}
      {iv.status === 'waiting' && Input ? (
        <Input key="iv-answer" rows={4} placeholder="Your answer. Write it the way you would say it." value={x.form['iv-answer'] ?? ''}
          onInput={v => void x.act.setForm('iv-answer', v)} onSubmit={v => void x.act.interview.answer(v)} />
      ) : null}
      {iv.status === 'waiting' ? (
        <Box flexDirection="row" gap={0} flexWrap="wrap">
          <Button key="iv-send" variant="primary" onPress={() => x.act.interview.answer(x.form['iv-answer'] ?? '')}>Send answer</Button>
          {iv.turns.some(t => t.who === 'you') ? <Button key="iv-finish" onPress={x.act.interview.finish}>Finish and get feedback</Button> : null}
        </Box>
      ) : null}
      {iv.status === 'done' ? (
        <Box flexDirection="column" gap={1}>
          {label(x, 'Feedback', 'iv-fb-h')}
          {Markdown ? <Markdown key="iv-fb" text={iv.feedback} /> : <Text wrap="wrap">{iv.feedback}</Text>}
          {iv.file ? <Text size="caption" dimColor>Saved to {iv.file}</Text> : null}
          <Button key="iv-done" onPress={x.act.interview.reset}>Done</Button>
        </Box>
      ) : null}
    </Box>
  )
}

// ---------------- playbook ----------------
function playbook(x: Ctx) {
  const { Box, Text, Button, Link, Markdown } = x.ui
  const open = x.d.guides.find(g => g.id === x.guide)
  if (open) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Button key="back" hotkey="b" dimColor onPress={x.act.back}>← Playbook</Button>
        <Text size="caption" weight="semibold" dimColor>{`${open.group.toUpperCase()} · ${open.minutes} MIN`}</Text>
        {open.source ? <Link key="src" href={open.source}>Source ↗</Link> : null}
        {Markdown ? <Markdown key="guide-text" text={open.text} /> : <Text wrap="wrap">{open.text}</Text>}
        <Text size="caption" dimColor wrap="wrap">From {x.d.dir}/guides/{open.id}.md</Text>
      </Box>
    )
  }
  const q = (x.form['guide-q'] ?? '').toLowerCase()
  const shown = x.d.guides.filter(g => !q || `${g.title} ${g.group} ${g.text}`.toLowerCase().includes(q))
  const groups = [...new Set(shown.map(g => g.group))]
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header(x)}
      <Text size="caption" dimColor wrap="wrap">{plural(x.d.guides.length, 'guide')}. Add any markdown file to {x.d.dir}/guides and it appears here.</Text>
      {input(x, 'guide-q', 'Search guides')}
      {groups.map((grp, gi) => (
        <Box key={`gg-${gi}`} flexDirection="column" gap={0}>
          {label(x, grp, `gg-h-${gi}`)}
          {shown.filter(g => g.group === grp).map((g, i) => (
            <Box key={`g-${gi}-${i}`} flexDirection="row" gap={1} alignItems="center" hover={{ backgroundColor: 'inactive' }}>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text weight="semibold" wrap="truncate-end">{g.title}</Text>
                <Text size="caption" dimColor>{g.minutes} min</Text>
              </Box>
              <Button key={`g-${gi}-go-${i}`} label="›" dimColor onPress={x.act.openGuide(g.id)} />
            </Box>
          ))}
        </Box>
      ))}
      {!shown.length ? <Text dimColor>No guide matches.</Text> : null}
    </Box>
  )
}
