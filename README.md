# Career Services

A job-search dashboard that lives in a pane beside your Claude Code chat. It keeps your roles, the people you know at each company, your conversations and follow-ups, interview practice and your own notes in one place. If Gmail and Google Calendar are connected in Claude, it also reads them: recruiting mail is matched to the roles you track, and deadlines and interviews show up under Coming up.

Everything is stored as plain JSON and markdown files in one folder you own (`~/.career-services`). The pane reads your mail and calendar but never sends, deletes or changes anything there.

## What's in the pane

- **Home**: your next move (an interview to prepare for, a deadline in the next few days, follow-ups that are due), the companies you follow, what's coming up on your calendar, and applications this week against a weekly goal.
- **Jobs**: a watch list sorted by deadline, a board of everything you've applied to by stage, and a form to add a role.
- **Company pages**: every role, person and conversation at one company on one page.
- **Network**: the people you know at each company and how you know them, plus a log of who you've reached out to, who replied, and when to follow up.
- **Inbox**: application confirmations, interview invites, assessments and rejections from the last 30 days of Gmail, grouped and matched to your roles. One tap moves the matching role to the right stage.
- **Prep**: a mock interviewer that runs in the pane. Pick a role and it asks one question at a time, then gives feedback on each answer and saves the transcript. There's also a practice log for coding problems, by topic.
- **Playbook**: your own markdown notes, searchable, plus a few starter guides.
- **Ask**: a box at the top that sends a question about your search to the chat, with your data folder as context.

## Install

In a Claude Code terminal session:

```
/plugin install career-services --marketplace reeve1213-cyber/career-services
```

From a shell:

```bash
claude plugin install career-services --marketplace reeve1213-cyber/career-services
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `reeve1213-cyber/career-services`, then **Add plugin**.

The pane opens when a session starts. `/career` brings it back. The first time, press **Create my folder** and it sets up `~/.career-services` with empty files and the starter guides. Set `CAREER_SERVICES_DIR` to keep the folder somewhere else.

## The data folder

| File | What it holds |
|---|---|
| `settings.json` | the companies you follow and your weekly goal |
| `roles.json` | each role: company, title, link, deadline, stage and a dated history of moves |
| `people.json` | people you know, at which company, and how you know them |
| `conversations.json` | who you contacted, when, whether they replied, and the follow-up date |
| `attempts.json` | practice problems by topic, with the result and time |
| `resume.md` | optional; the mock interviewer reads it to ask about your experience |
| `guides/*.md` | your notes; optional front matter sets `title`, `group` and `source` |
| `interviews/*.md` | transcripts and feedback from mock interviews |

The files are meant to be edited by hand too. Press ↻ in the pane after editing one.

## Gmail and Google Calendar

The pane looks for a connected Gmail tool (`search_threads`) and Google Calendar tool (`list_events`) among the session's tools, and falls back to the names of Claude's own connectors. If neither is connected, Inbox and Coming up say so and everything else still works. Mail and event text is only displayed and matched; it is never used as instructions.

## Development

The plugin is a Claude Code mod: a hooks module in `plugins/career-services/hooks/` that draws the pane with the engine's UI elements.

```bash
claude plugin validate plugins/career-services
claude plugin test plugins/career-services
```

`hooks/connectors.ts` and `hooks/data.ts` are pure functions (mail and calendar parsing, stage moves, what to do next, the SVG drawings), so most behavior is covered by plain tests. The pane tests mount it on the desktop and terminal surfaces with an in-memory data folder and recorded connector answers.

## License

MIT
