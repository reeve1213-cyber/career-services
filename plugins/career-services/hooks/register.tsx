import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CalItem, Data, Feed, Interview, MailItem, Role, Stage, Tab } from '../types'
import { MAIL_QUERY, mcpJson, serversFor, shapeEvents, shapeMail } from './connectors'
import {
  COACH_SYSTEM, FILES, STARTER_GUIDES, STARTER_SETTINGS, TOPICS, askPrompt, interviewMarkdown, interviewerSystem, parseGuide, shapeData, slug,
  stageLabel, transcript, withRole, withStage,
} from './data'
import type { Guide } from '../types'
import { render } from './views'
import type { Act, Ctx, UI } from './views'

// Career Services: a job-search pane beside the chat. Its data is plain JSON and markdown in one folder
// (~/.career-services, or $CAREER_SERVICES_DIR); Gmail and Google Calendar are read, never written.
const PANE = 'career-services'
const TITLE = 'Career Services'
const TABS: Tab[] = ['home', 'jobs', 'network', 'inbox', 'prep', 'playbook']

const data = atom({ plugin: 'career-services', key: 'data' } as const, null as Data | null)
const mail = atom({ plugin: 'career-services', key: 'mail' } as const, { status: 'idle', items: [], at: '', error: '' } as Feed<MailItem>)
const cal = atom({ plugin: 'career-services', key: 'cal' } as const, { status: 'idle', items: [], at: '', error: '' } as Feed<CalItem>)
const tab = atom({ plugin: 'career-services', key: 'tab' } as const, 'home' as Tab)
const sub = atom({ plugin: 'career-services', key: 'sub' } as const, {} as Record<string, string>)
const selected = atom({ plugin: 'career-services', key: 'selected' } as const, '')
const company = atom({ plugin: 'career-services', key: 'company' } as const, '')
const guide = atom({ plugin: 'career-services', key: 'guide' } as const, '')
const form = atom({ plugin: 'career-services', key: 'form' } as const, {} as Record<string, string>)
const notice = atom({ plugin: 'career-services', key: 'notice' } as const, '')
const interview = atom({ plugin: 'career-services', key: 'interview' } as const, null as Interview | null)

type Dollar = EngineInterface
type Raw = Record<string, unknown>

// The runtime's clock is UTC; a deadline "today" means today where the person is
const localDay = (now: number) => new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const localStamp = (now: number) => new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function folder($: Dollar): Promise<string> {
  return (await $.env.get('CAREER_SERVICES_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.career-services`
}

async function load($: Dollar) {
  const dir = await folder($)
  const files: Partial<Record<keyof typeof FILES, Raw>> = {}
  const broken: string[] = []
  for (const [k, name] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const text = await $.fs.read(`${dir}/${name}`).catch(() => '')
    if (!text) continue
    try { files[k] = JSON.parse(text) as Raw } catch { broken.push(name) }
  }
  const guides: Guide[] = []
  for (const entry of await $.fs.list(`${dir}/guides`).catch(() => [])) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) guides.push(parseGuide(entry.name, await $.fs.read(`${dir}/guides/${entry.name}`)))
  }
  await update($, data, () => shapeData(dir, files, guides.sort((a, b) => a.title.localeCompare(b.title))))
  await update($, notice, () => (broken.length ? `Not valid JSON, so left out: ${broken.join(', ')}. Fix the file and press ↻.` : ''))
}

async function save($: Dollar, file: keyof typeof FILES, body: unknown) {
  const d = await read($, data)
  if (!d) return
  await $.fs.write(`${d.dir}/${FILES[file]}`, `${JSON.stringify(body, null, 2)}\n`)
  await load($)
}

// Hosts name the same connector differently, so look for the tool first and fall back to the usual name
async function mcp($: Dollar, tool: string, about: RegExp, fallback: string, args: Raw) {
  const tools = await $.tool.list().catch(() => [])
  let last = ''
  for (const server of serversFor(tools, tool, about, fallback)) {
    const r = await $.mcp.call(server, tool, args).catch((err: unknown) => { last = errText(err); return null })
    if (!r) continue
    if (r.isError) throw new Error(r.content.find(b => b.type === 'text')?.text?.slice(0, 160) ?? 'the connector reported an error')
    return mcpJson(r)
  }
  throw new Error(/no connected MCP tool/.test(last) ? 'connect it in Claude to see it here' : last)
}

async function refreshMail($: Dollar) {
  await update($, mail, x => ({ ...x, status: 'loading' as const }))
  try {
    const items = shapeMail(await mcp($, 'search_threads', /gmail/i, 'claude.ai Gmail', { query: MAIL_QUERY, pageSize: 40, view: 'THREAD_VIEW_SUMMARY' }))
    const at = localStamp(await $.clock.now())
    await update($, mail, () => ({ status: 'ok' as const, items, at, error: '' }))
  } catch (err) {
    await update($, mail, x => ({ ...x, status: 'error' as const, error: errText(err) }))
  }
}

async function refreshCal($: Dollar) {
  await update($, cal, x => ({ ...x, status: 'loading' as const }))
  try {
    const today = localDay(await $.clock.now())
    const end = new Date(Date.parse(today) + 21 * 86_400_000).toISOString().slice(0, 10)
    const items = shapeEvents(await mcp($, 'list_events', /calendar/i, 'claude.ai Google Calendar', {
      startTime: `${today}T00:00:00`, endTime: `${end}T00:00:00`, orderBy: 'startTime', pageSize: 250,
    }))
    const at = localStamp(await $.clock.now())
    await update($, cal, () => ({ status: 'ok' as const, items, at, error: '' }))
  } catch (err) {
    await update($, cal, x => ({ ...x, status: 'error' as const, error: errText(err) }))
  }
}

// The interviewer runs in the pane: one model call per turn, and one for the feedback at the end.
// A resume.md in the data folder, if there is one, gives it something to ask about.
async function interviewerTurn($: Dollar, r: Role) {
  const iv = await read($, interview)
  if (!iv) return
  const resume = await $.fs.read(`${await folder($)}/resume.md`).catch(() => '')
  const reply = await $.model.complete({
    model: 'sonnet', system: interviewerSystem(r, resume), maxTokens: 400, timeoutMs: 90_000,
    prompt: iv.turns.length ? `${transcript(iv.turns)}\n\nWrite the interviewer's next message.` : 'Open the interview: greet the candidate in one sentence and ask your first question.',
  })
  await update($, interview, cur => cur && (reply.isAnswered
    ? { ...cur, status: 'waiting' as const, turns: [...cur.turns, { who: 'interviewer' as const, text: reply.text.trim() }] }
    : { ...cur, status: 'error' as const, error: `No answer from the model (${reply.reason})` }))
}

async function interviewFeedback($: Dollar) {
  const iv = await read($, interview)
  if (!iv) return
  await update($, interview, cur => cur && { ...cur, status: 'thinking' as const })
  const reply = await $.model.complete({ model: 'sonnet', system: COACH_SYSTEM, prompt: transcript(iv.turns), maxTokens: 1200, timeoutMs: 120_000 })
  if (!reply.isAnswered) {
    await update($, interview, cur => cur && { ...cur, status: 'error' as const, error: `No feedback from the model (${reply.reason})` })
    return
  }
  const now = await $.clock.now()
  const path = `${await folder($)}/interviews/${localDay(now)}_${slug(iv.company)}.md`
  const file = await $.fs.write(path, interviewMarkdown(iv, iv.turns, reply.text.trim(), localStamp(now).replace('T', ' '))).then(() => path, () => '')
  await update($, interview, cur => cur && { ...cur, status: 'done' as const, feedback: reply.text.trim(), file })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'career', description: 'Open Career Services: your next move, roles, people, inbox, practice and notes' })
    void load($)
    // claude.ai connectors finish connecting a few seconds after the chat starts
    void (async () => {
      for (const wait of [10_000, 30_000, 60_000]) {
        await Promise.all([refreshMail($), refreshCal($)])
        if ((await read($, mail)).status === 'ok' && (await read($, cal)).status === 'ok') return
        await $.clock.sleep(wait)
      }
    })()
    $.clock.every(900_000, () => void Promise.all([load($), refreshMail($), refreshCal($)]).catch(() => undefined))
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'career' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => undefined)
    return { text: `${TITLE} opened.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const ui: UI = {
      Box: el.Box, Text: el.Text, Button: el.Button, Link: el.Link,
      Svg: 'Svg' in el ? el.Svg : undefined,
      Input: 'Input' in el ? el.Input : undefined,
      Select: 'Select' in el ? el.Select : undefined,
      Markdown: 'Markdown' in el ? el.Markdown : undefined,
    }
    const d = await read($, data)
    if (!d) {
      const { Box, Text } = ui
      return <Box padding={1}><Text dimColor>Loading Career Services…</Text></Box>
    }
    const now = await $.clock.now()
    const today = localDay(now)
    const f = await read($, form)
    const setForm = async (k: string, v: string) => { await update($, form, cur => ({ ...cur, [k]: v })) }
    const clearForm = async (...keys: string[]) => { await update($, form, cur => ({ ...cur, ...Object.fromEntries(keys.map(k => [k, ''])) })) }
    const clear = async () => { await update($, selected, () => ''); await update($, company, () => ''); await update($, guide, () => '') }
    const settings = { ...d.settings }
    const act: Act = {
      go: (t, value) => async () => {
        await clear()
        await update($, tab, () => t)
        if (value) await update($, sub, m => ({ ...m, [t]: value }))
      },
      setSub: (t, value) => async () => { await update($, sub, m => ({ ...m, [t]: value })) },
      openRole: id => async () => { await update($, selected, () => id) },
      openCompany: name => async () => { await update($, selected, () => ''); await update($, company, () => name) },
      openGuide: id => async () => { await update($, guide, () => id) },
      back: async () => {
        if (await read($, selected)) await update($, selected, () => '')
        else await clear()
      },
      setForm,
      setup: async () => {
        const dir = d.dir
        await $.fs.write(`${dir}/${FILES.settings}`, `${JSON.stringify(STARTER_SETTINGS, null, 2)}\n`)
        for (const [k, key] of [['roles', 'roles'], ['people', 'people'], ['conversations', 'conversations'], ['attempts', 'attempts']] as const) {
          if (!(await $.fs.read(`${dir}/${FILES[k]}`).catch(() => ''))) await $.fs.write(`${dir}/${FILES[k]}`, `${JSON.stringify({ [key]: [] }, null, 2)}\n`)
        }
        for (const [name, text] of Object.entries(STARTER_GUIDES)) await $.fs.write(`${dir}/guides/${name}`, text)
        await load($)
      },
      refresh: async () => { await Promise.all([load($), refreshMail($), refreshCal($)]) },
      refreshMail: () => refreshMail($),
      refreshCal: () => refreshCal($),
      moveRole: (id, stage: Stage) => async () => {
        await save($, 'roles', withStage(d.roles, id, stage, localStamp(await $.clock.now())))
        $.ui.toast(`Moved to ${stageLabel(stage)}`)
      },
      addRole: async () => {
        const fields = {
          company: (f['role-company'] ?? '').trim(), title: (f['role-title'] ?? '').trim(),
          url: (f['role-url'] ?? '').trim(), deadline: (f['role-deadline'] ?? '').trim(),
        }
        if (!fields.company || !fields.title) return void $.ui.toast('A role needs a company and a title')
        if (fields.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(fields.deadline)) return void $.ui.toast('Write the deadline as YYYY-MM-DD')
        await save($, 'roles', withRole(d.roles, fields, localStamp(await $.clock.now())))
        await clearForm('role-company', 'role-title', 'role-url', 'role-deadline')
        await update($, sub, m => ({ ...m, jobs: 'watch' }))
      },
      addCompany: async name => {
        const n = name.trim()
        if (!n || settings.companies.some(c => c.toLowerCase() === n.toLowerCase())) return
        await save($, 'settings', { ...settings, companies: [...settings.companies, n] })
        await clearForm('co-add')
      },
      removeCompany: name => async () => {
        await save($, 'settings', { ...settings, companies: settings.companies.filter(c => c !== name) })
        await clear()
      },
      addPerson: co => async () => {
        const name = (f['p-name'] ?? '').trim()
        if (!name) return
        await save($, 'people', { people: [...d.people, { name, company: co, role: (f['p-role'] ?? '').trim(), how: (f['p-how'] ?? '').trim(), added: today }] })
        await clearForm('p-name', 'p-role', 'p-how')
      },
      logTalk: async () => {
        const person = (f['t-person'] ?? '').trim()
        if (!person) return
        const followUp = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10)
        const talk = { date: today, person, company: (f['t-company'] ?? '').trim(), topic: (f['t-topic'] ?? '').trim(), replied: false, followUp }
        await save($, 'conversations', { conversations: [talk, ...d.conversations] })
        await clearForm('t-person', 't-company', 't-topic')
      },
      markReplied: i => async () => {
        await save($, 'conversations', { conversations: d.conversations.map((c, k) => (k === i ? { ...c, replied: true } : c)) })
      },
      logAttempt: async () => {
        const problem = (f['a-problem'] ?? '').trim()
        if (!problem) return
        const attempt = {
          date: today, problem, topic: f['a-topic'] || TOPICS[0]!, result: f['a-result'] || 'solo', minutes: Number(f['a-minutes'] || 0) || 0,
        }
        await save($, 'attempts', { attempts: [attempt, ...d.attempts] })
        await clearForm('a-problem', 'a-minutes')
      },
      ask: async q => {
        if (!q.trim()) return
        await clearForm('ask')
        await $.prompt.submit({ text: askPrompt(q.trim(), d.dir) })
        $.ui.toast('Sent to the chat')
      },
      interview: {
        start: r => async () => {
          await update($, interview, () => ({ roleId: r.id, company: r.company, title: r.title, turns: [], status: 'thinking' as const, feedback: '', error: '', file: '' }))
          await clear()
          await update($, tab, () => 'prep')
          await interviewerTurn($, r)
        },
        answer: async text => {
          const iv = await read($, interview)
          const r = d.roles.find(role => role.id === iv?.roleId)
          if (!iv || !r || iv.status !== 'waiting' || !text.trim()) return
          await clearForm('iv-answer')
          await update($, interview, cur => cur && { ...cur, status: 'thinking' as const, turns: [...cur.turns, { who: 'you' as const, text: text.trim() }] })
          await interviewerTurn($, r)
        },
        finish: () => interviewFeedback($),
        reset: async () => { await update($, interview, () => null) },
      },
    }
    const stored = await read($, tab)
    const x: Ctx = {
      ui, act, d,
      mail: await read($, mail),
      cal: await read($, cal),
      tab: TABS.includes(stored) ? stored : 'home',
      sub: await read($, sub),
      selected: await read($, selected),
      company: await read($, company),
      guide: await read($, guide),
      form: f,
      note: await read($, notice),
      interview: await read($, interview),
      today,
      width: Math.max(300, Math.min(620, ((e.viewport?.columns ?? 60) - 4) * 8)),
    }
    return render(x)
  })
}
