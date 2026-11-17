import { expect, test } from 'claude-code/testing'

import { classify, companyOf, eventName, serversFor, shapeEvents, shapeMail } from '../hooks/connectors'
import { appliedThisWeek, nextMoves, parseGuide, sameCompany, shapeData, withRole, withStage } from '../hooks/data'

const PANE = {
  plugin: 'career-services',
  component: 'Pane',
  requestId: 'career-services',
  props: { title: 'Career Services', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const msg = (id: string, subject: string, sender: string, name: string, snippet: string, date: string) => ({
  id, viewUrl: `https://mail.example/${id}`,
  messages: [{ subject, sender, snippet, date, labelIds: ['UNREAD', 'INBOX'], addressDisplayNames: [{ displayName: name, emailAddress: sender }] }],
})
const GMAIL = {
  threads: [
    msg('t1', 'Thank you for applying to Acme!', 'no-reply@greenhouse.io', 'Acme Recruiting', 'We have received your application', '2026-11-16T15:00:00Z'),
    msg('t2', 'Interview invitation', 'talent@globex.com', 'Globex Talent', 'Please share your availability for a phone screen', '2026-11-15T15:00:00Z'),
    msg('t3', 'Update on your application', 'jobs@initech.com', 'Initech Careers', 'Unfortunately we will not be moving forward', '2026-11-14T15:00:00Z'),
    msg('t4', 'You are a top applicant for 12 new roles', 'alerts@board.example', 'Job Board', 'New jobs for you', '2026-11-13T15:00:00Z'),
  ],
}
const GCAL = {
  events: [
    { id: 'c1', summary: 'CS 2201 lecture', start: { dateTime: '2026-11-18T09:00:00-06:00' }, htmlLink: 'https://cal.example/c1' },
    { id: 'c2', summary: 'DEADLINE 11:59 PM — Acme Software Engineering Intern', start: { date: '2026-11-19' }, htmlLink: 'https://cal.example/c2' },
    { id: 'c3', summary: 'Globex phone screen', start: { dateTime: '2026-11-20T14:00:00-06:00' }, htmlLink: 'https://cal.example/c3' },
    { id: 'c4', summary: 'Career fair', start: { date: '2026-11-21' }, htmlLink: 'https://cal.example/c4' },
  ],
}

type On = Parameters<Parameters<typeof test>[1]>[1]
function world(on: On) {
  const files = new Map<string, string>()
  const prompts: string[] = []
  on('command.register', () => ({ value: { command: 'career' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('clock.now', () => ({ value: Date.parse('2026-11-17T18:00:00Z') }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home/test' : undefined }))
  on('fs.read', (_, e) => {
    const text = files.get((e as { path: string }).path)
    return text === undefined ? { deny: 'no such file' } : { value: text }
  })
  on('fs.write', (_, e) => { const w = e as { path: string; text: string }; files.set(w.path, w.text); return { value: undefined } })
  on('fs.list', (_, e) => {
    const dir = `${(e as { path: string }).path}/`
    const names = [...files.keys()].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')).map(p => p.slice(dir.length))
    return { value: names.map(name => ({ name, kind: 'file' })) }
  })
  on('tool.list', () => ({ value: [
    { name: 'mcp__mail__search_threads', description: 'Search Gmail threads', mcp: true },
    { name: 'mcp__cal__list_events', description: 'List Google Calendar events', mcp: true },
  ] }))
  on('mcp.call', (_, e) => {
    const c = e as { server: string; tool: string }
    const body = c.server === 'mail' && c.tool === 'search_threads' ? GMAIL : c.server === 'cal' && c.tool === 'list_events' ? GCAL : null
    return body ? { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } } : { deny: 'no connected MCP tool' }
  })
  on('prompt.submit', (_, e) => { prompts.push(String((e as { text?: string }).text ?? '')); return { text: '' } })
  return { files, prompts }
}

test('mail is classified, matched to a company, and job-board marketing is dropped', () => {
  const items = shapeMail(GMAIL)
  expect(items.map(m => m.kind)).toEqual(['applied', 'interview', 'rejection'])
  expect(items.map(m => m.company)).toEqual(['Acme', 'Globex', 'Initech'])
  expect(classify('Thank you for your interest', 'Unfortunately, we decided not to proceed')).toBe('rejection')
  expect(companyOf('Hello', '', 'people@umbrella.com')).toBe('Umbrella')
})

test('the calendar keeps deadlines, interviews and career events and drops classes', () => {
  const events = shapeEvents(GCAL)
  expect(events.map(e => [e.id, e.kind])).toEqual([['c2', 'deadline'], ['c3', 'interview'], ['c4', 'event']])
  expect(eventName(events[0]!.title)).toBe('Acme Software Engineering Intern')
})

test('connectors are found by tool name before the usual name is tried', () => {
  const tools = [{ name: 'mcp__abc__search_threads', description: 'Gmail search' }, { name: 'mcp__other__search_threads', description: 'Slack search' }]
  expect(serversFor(tools, 'search_threads', /gmail/i, 'claude.ai Gmail')).toEqual(['abc', 'claude.ai Gmail'])
  expect(serversFor([], 'list_events', /calendar/i, 'claude.ai Google Calendar')).toEqual(['claude.ai Google Calendar'])
})

test('roles move through stages with a dated history, and the week counts applications', () => {
  const { roles } = withRole([], { company: 'Acme', title: 'SWE Intern', url: '', deadline: '2026-11-20' }, '2026-11-16T10:00')
  const moved = withStage(roles, roles[0]!.id, 'applied', '2026-11-17T09:00').roles
  expect(moved[0]!.history.map(h => h.stage)).toEqual(['saved', 'applied'])
  expect(appliedThisWeek(moved, '2026-11-17')).toBe(1)
  expect(appliedThisWeek(moved, '2026-11-24')).toBe(0)
  expect(sameCompany('Acme', 'Acme Inc')).toBe(true)
  expect(sameCompany('Acme', 'Acmesoft')).toBe(false)
  const d = shapeData('/d', { settings: {}, roles: { roles } }, [])
  const moves = nextMoves(d, shapeEvents(GCAL), '2026-11-17')
  expect(moves.map(m => m.key)).toEqual(['cal-c2', `dl-${roles[0]!.id}`])
  expect(parseGuide('a-note.md', '# My note\n\nText').title).toBe('My note')
  expect(parseGuide('b.md', '---\ntitle: Set title\ngroup: Plan\n---\nBody').group).toBe('Plan')
})

test('a first run sets up the folder, then a role goes from added to applied from the inbox', async ($, on) => {
  const { files, prompts } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Text', text: /Keep your whole search beside the chat/ })).toBeTruthy()
      await ui.press({ key: 'setup' })
      expect(files.has('/home/test/.career-services/settings.json')).toBe(true)
      expect(files.has('/home/test/.career-services/guides/weekly-routine.md')).toBe(true)
    }
    await ui.press({ key: 'tab-home' })
    expect(await ui.find({ type: 'Text', text: /YOUR NEXT MOVE/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Acme Software Engineering Intern/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /CS 2201/ })).toBeFalsy()

    if (surface === 'desktop') {
      await ui.input({ key: 'co-add', text: 'Acme', kind: 'change' })
      await ui.press({ key: 'co-add-go' })
      expect(JSON.parse(files.get('/home/test/.career-services/settings.json')!).companies).toEqual(['Acme'])
      await ui.press({ key: 'tab-jobs' })
      await ui.press({ key: 'sub-jobs-add' })
      await ui.input({ key: 'role-company', text: 'Acme', kind: 'change' })
      await ui.input({ key: 'role-title', text: 'Software Engineering Intern', kind: 'change' })
      await ui.input({ key: 'role-deadline', text: '2026-11-19', kind: 'change' })
      await ui.press({ key: 'role-add' })
      expect(JSON.parse(files.get('/home/test/.career-services/roles.json')!).roles).toHaveLength(1)
      await ui.press({ key: 'tab-inbox' })
      await ui.press({ key: 'mx-t1' })
      expect(JSON.parse(files.get('/home/test/.career-services/roles.json')!).roles[0].stage).toBe('applied')
    }

    await ui.press({ key: 'tab-inbox' })
    expect(await ui.find({ type: 'Text', text: /INTERVIEW INVITES · 1/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Applied ✓/ })).toBeTruthy()
    await ui.press({ key: 'tab-jobs' })
    await ui.press({ key: 'sub-jobs-board' })
    expect(await ui.find({ type: 'Text', text: /^APPLIED · 1$/ })).toBeTruthy()
    await ui.press({ key: 'tab-network' })
    await ui.press({ key: 'sub-network-conversations' })
    expect(await ui.find({ type: 'Text', text: /reached out/ })).toBeTruthy()
    await ui.press({ key: 'tab-prep' })
    expect(await ui.find({ type: 'Text', text: /^Practice$/ })).toBeTruthy()
    await ui.press({ key: 'tab-playbook' })
    expect(await ui.find({ type: 'Text', text: /START HERE/ })).toBeTruthy()
    await ui.press({ key: 'g-0-go-0' })
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeTruthy()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  expect(prompts).toEqual([])
})

test('people, conversations and practice are saved to their files', async ($, on) => {
  const { files, prompts } = world(on)
  files.set('/home/test/.career-services/settings.json', JSON.stringify({ companies: ['Globex'], weeklyGoal: 5 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-network' })
  await ui.input({ key: 'p-name', text: 'Sam Lee', kind: 'change' })
  await ui.input({ key: 'p-how', text: 'Met at the info session', kind: 'change' })
  await ui.press({ key: 'p-add' })
  expect(JSON.parse(files.get('/home/test/.career-services/people.json')!).people[0]).toMatchObject({ name: 'Sam Lee', company: 'Globex' })
  await ui.press({ key: 'sub-network-conversations' })
  await ui.input({ key: 't-person', text: 'Sam Lee', kind: 'change' })
  await ui.input({ key: 't-topic', text: '15-minute call', kind: 'change' })
  await ui.press({ key: 't-add-go' })
  const talk = JSON.parse(files.get('/home/test/.career-services/conversations.json')!).conversations[0]
  expect(talk.followUp).toBe('2026-11-24')
  await ui.press({ key: 'tab-prep' })
  await ui.input({ key: 'a-problem', text: 'Two Sum', kind: 'change' })
  await ui.input({ key: 'a-minutes', text: '18', kind: 'change' })
  await ui.press({ key: 'a-log' })
  expect(JSON.parse(files.get('/home/test/.career-services/attempts.json')!).attempts[0]).toMatchObject({ problem: 'Two Sum', minutes: 18, result: 'solo' })
  await ui.input({ key: 'ask', text: 'Which follow-ups are due?', kind: 'change' })
  await ui.press({ key: 'ask-go' })
  expect(prompts[0]).toContain('Which follow-ups are due?')
  expect(prompts[0]).toContain('Do not send messages or submit anything')
  await ui.unmount()
})

test('a mock interview runs in the pane and saves its feedback', async ($, on) => {
  const { files } = world(on)
  files.set('/home/test/.career-services/settings.json', JSON.stringify({ companies: [], weeklyGoal: 5 }))
  files.set('/home/test/.career-services/roles.json', JSON.stringify({ roles: [{ id: 'acme-swe', company: 'Acme', title: 'SWE Intern', stage: 'applied', history: [] }] }))
  let asked = 0
  on('model.complete', (_, e) => {
    const coach = String((e as { system?: string }).system ?? '').includes('interview coach')
    const text = coach ? '## Overall\nClear and specific.' : `Question ${++asked}: walk me through a project you are proud of.`
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-prep' })
  await ui.press({ key: 'mk-0-go' })
  expect(await ui.find({ type: 'Text', text: /^Question 1: walk me through/ })).toBeTruthy()
  await ui.input({ key: 'iv-answer', text: 'I built a scheduling tool for my club.', kind: 'change' })
  await ui.press({ key: 'iv-send' })
  expect(await ui.find({ type: 'Text', text: /^Question 2/ })).toBeTruthy()
  await ui.press({ key: 'iv-finish' })
  expect(await ui.find({ type: 'Text', text: /^FEEDBACK$/ })).toBeTruthy()
  expect(files.get('/home/test/.career-services/interviews/2026-11-17_acme.md')).toContain('I built a scheduling tool for my club.')
  await ui.unmount()
})
