export type Tab = 'home' | 'jobs' | 'network' | 'inbox' | 'prep' | 'playbook'

export type Stage = 'saved' | 'applying' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'archived'

export type Role = {
  id: string
  company: string
  title: string
  url: string
  location: string
  deadline: string
  stage: Stage
  notes: string
  history: { stage: Stage; at: string }[]
}

export type Person = { name: string; company: string; role: string; how: string; added: string }

export type Conversation = { date: string; person: string; company: string; topic: string; replied: boolean; followUp: string }

export type Attempt = { date: string; problem: string; topic: string; result: 'solo' | 'hint' | 'solution'; minutes: number }

export type Guide = { id: string; title: string; group: string; source: string; minutes: number; text: string }

export type Settings = { companies: string[]; weeklyGoal: number }

// Everything the pane keeps, read from plain JSON and markdown files in one folder (~/.career-services by default)
export type Data = {
  dir: string
  ready: boolean
  settings: Settings
  roles: Role[]
  people: Person[]
  conversations: Conversation[]
  attempts: Attempt[]
  guides: Guide[]
}

export type MailKind = 'interview' | 'assessment' | 'offer' | 'rejection' | 'applied' | 'update'
export type MailItem = {
  id: string; kind: MailKind; company: string; subject: string; from: string; date: string; url: string; unread: boolean
}
export type CalKind = 'deadline' | 'interview' | 'event'
export type CalItem = { id: string; kind: CalKind; title: string; start: string; allDay: boolean; link: string }
export type Feed<T> = { status: 'idle' | 'loading' | 'ok' | 'error'; items: T[]; at: string; error: string }

// A mock interview run inside the pane: the model plays the interviewer one question at a time
export type Turn = { who: 'interviewer' | 'you'; text: string }
export type Interview = {
  roleId: string; company: string; title: string; turns: Turn[]
  status: 'thinking' | 'waiting' | 'done' | 'error'; feedback: string; error: string; file: string
}

export type Move = { key: string; title: string; detail: string; label: string; href?: string; role?: string; tab?: Tab }

declare module 'claude-code' {
  interface PluginState {
    'career-services': {
      data: Data | null
      mail: Feed<MailItem>
      cal: Feed<CalItem>
      tab: Tab
      sub: Record<string, string>
      selected: string
      company: string
      guide: string
      form: Record<string, string>
      notice: string
      interview: Interview | null
    }
  }
}
