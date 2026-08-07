# Security Policy

## Supported version

Security fixes are applied to the latest commit on the protected `main` branch. Older commits and local acceptance artifacts are not maintained as separate release lines.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/sbty/blog_prototype/security/advisories/new) for security-sensitive reports.

Do not open a public issue containing:

- credentials, cookies, tokens, or `.env` values;
- real Blogger blog or post identifiers;
- private blog URLs, browser profiles, screenshots, or runtime evidence;
- a procedure that could publish, schedule, modify, or delete a real post.

Include the affected commit, impact, reproduction conditions, and a minimal sanitized example. Use fictional identifiers and `example.blogspot.com` whenever possible.

## Scope

Reports about authentication boundaries, STOP handling, evidence integrity, duplicate prevention, timezone validation, URL validation, filesystem containment, CI permissions, and dependency vulnerabilities are in scope.

Do not test against a Blogger account or blog that you do not own. Do not perform a live Blogger mutation while researching or demonstrating a report without explicit authorization for that exact operation.

## Handling

Reports are evaluated privately. A fix should be developed on a short-lived branch, pass dependency audit and the complete verification gate, and merge through the protected pull-request workflow. Public disclosure should avoid real identifiers and occur only after a fix is available.
