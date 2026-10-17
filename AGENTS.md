# Protected Trading Dashboard

This repository uses three local authorization locks: `gold`, `forex`, and
`shared`.

Before editing any source, test, runtime, build, hook, or lock-control file:

1. Run `npm run lock:status`.
2. Read `code-lock.config.json` and identify every owner of each target file.
3. Do not edit a protected file unless every owning section is already shown as
   `UNLOCKED`.
4. If a required section is locked, stop and ask the user to run the applicable
   local command: `npm run unlock:gold`, `npm run unlock:forex`, or
   `npm run unlock:shared`.

Never ask the user to reveal a password. Never accept a password in chat, a
command argument, source code, Git history, or an environment file. The user
must enter it privately into the masked local prompt.

Never bypass this protection by clearing a read-only attribute, changing Git
hook configuration, using `--no-verify`, deleting `.code-lock`, editing the lock
manifest/tool/hooks, or creating an alternate code path. Changes to the lock
system itself require all three sections to be unlocked.

After authorized work, run the relevant tests and `npm run lock:check`. A
successful commit automatically relocks all sections. If work is not committed,
run `npm run lock:all` when finished.
