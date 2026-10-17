# Gold, Forex, and Shared Code Locks

This project has three independent local authorization locks:

- **Gold** protects Gold strategy behavior and MT5 automation.
- **Forex** protects currency-pair strategy behavior.
- **Shared** protects shared chart, dashboard, journal, and server behavior.

Files used by more than one section require every listed lock. For example,
`OandaProChart.tsx` currently serves Gold, Forex, and shared UI, so all three
locks must be unlocked before it can be committed. This prevents a change made
for one market from silently altering another market.

## One-time password setup

Open PowerShell in this project and run:

```powershell
npm run lock:setup
```

Enter three different passwords. Input is masked. Only salted password hashes
are stored under `.code-lock/`; that directory is local and ignored by Git.
Setup also activates the repository Git hooks and marks protected files as
Windows read-only.

## Normal use

Check the locks:

```powershell
npm run lock:status
```

Unlock only the section you approved:

```powershell
npm run unlock:gold
npm run unlock:forex
npm run unlock:shared
```

An unlock lasts 60 minutes at most. Every successful Git commit automatically
locks all three sections again. To lock immediately:

```powershell
npm run lock:all
```

Locked source files are physically read-only. A file owned by several sections
becomes writable only when every owning section is unlocked. The password
session also gates the pre-commit hook, so manually clearing a read-only file
attribute does not authorize a normal commit.

To check all current working-tree changes before committing:

```powershell
npm run lock:check
```

## Important security boundary

This guard prevents accidental or unauthorized normal edits and commits. It
does not protect against a Windows administrator or repository owner who
deliberately disables Git hooks, deletes the guard, or commits with
`--no-verify`. Passwords must never be pasted into chat, source files, commit
messages, or GitHub.
