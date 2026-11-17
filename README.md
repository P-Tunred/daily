# Daily

**A personal operating system for my day.** Daily is a self-hosted dashboard that brings
together tasks, calendar, important email, study time and exam progress, routines, projects
and a daily score. It runs as a Node service on my own Linux VM (reachable only through a
private network) and shows up as a translucent Electron window on my Mac, in the browser,
and as an iPhone/Mac widget.

Next to it runs an AI agent, Hermes, which exports mail and calendar, writes a morning
briefing and maintains my Markdown second brain. The rule between them is strict:
**Daily displays and computes, Hermes writes**, and only through an authenticated API,
never into Daily's files. My learning app
[LearnHarness](https://github.com/P-Tunred/LearningHarness) feeds study progress in, so
Daily can tell me per exam how much time is left, how much work remains at my measured
pace, and which topics to push next.

## Highlights

- React 19 + TypeScript front end (Vite, Tailwind), Electron shell for the Mac window
- A framework-free Node server with ~45 endpoints
- Atomic file storage with daily snapshots, plus a three-way merge for offline edits
- Voice control: on-device Whisper transcription and a pattern-first command parser
  (milliseconds instead of a model round trip)
- AI calls behind a server proxy with automatic fallback
- One-command deploy that only reports success after a read-only health gate passes
- Native macOS widget (Swift / WidgetKit) and an iOS widget
- Several hundred automated tests (`npm test`)

Design decisions are written down as ADRs in [`docs/adr/`](docs/adr/).

## About this repository

This is a **sanitized public mirror** of my private working repository. It is exported
from the private `main` branch by a script that removes personal data (calendar, tasks,
notes), replaces server addresses with placeholders, and refuses to publish if anything
personal or secret is left. Its history therefore starts later than the real one.

Not included, because I can't redistribute them: the theme fonts, background images and
sounds. The app falls back to system fonts and plain backgrounds. Much of the UI and the
code comments are in German, because Daily is built for my own day.

## Run it locally

```bash
npm install
cp .env.example .env    # add your own API keys
npm run dev
```

Production runs as a systemd service on a Linux VM; see [`deploy/`](deploy/).

## How it's built

I build Daily with Claude Code as a pair programmer: I decide what Daily should do, how it
is structured and what ships; the agent speeds up the implementation and writes tests
alongside. Built since June 2026.
