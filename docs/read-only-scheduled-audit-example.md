# Disabled recurring audit example

Phase 5 does not enable unattended posting. If recurring monitoring is desired, schedule only the read-only `audit-published-post` command and create the task in the disabled state first.

Example Windows Task Scheduler action:

```text
Program: C:\Program Files\nodejs\node.exe
Arguments: dist\cli\index.js audit-published-post --blog examples\blog.example.json --article data\phase6-confirmation-acceptance-article.json
Start in: C:\codex\auto google blogger
Initial task state: Disabled
```

Before manually enabling this read-only task:

- use an OS account with read access to the project and outbound HTTPS only;
- keep `ENABLE_DRAFT_SAVE=false` and `ENABLE_SCHEDULED_POST=false` in its environment;
- do not pass `execute-schedule`, credentials, evidence hashes, or a browser profile;
- send nonzero exit codes and logs to a human-reviewed notification channel;
- choose a low frequency such as once daily.

A recurring publish task is intentionally not provided. The current execution command requires per-job confirmation and sealed evidence and is not an unattended scheduler interface.
