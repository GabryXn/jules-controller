# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not open a public issue**.

Instead, report it privately by opening a [GitHub Security Advisory](https://github.com/GabryXn/jules-controller/security/advisories/new) in this repository.

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You can expect an acknowledgement within 48 hours and a resolution timeline within 7 days for critical issues.

## Scope

This project orchestrates GitHub Actions workflows and interacts with external services (GitHub API, Google Jules API, Google Calendar). Key security considerations:

- **Secrets**: All credentials (`PAT_TOKEN`, `JULES_API_KEY`, `CLASPRC_JSON`) must be stored as GitHub Actions Secrets — never hardcoded.
- **Prompt Injection**: User-supplied content (Issue titles/bodies, Calendar event descriptions) is delimited with `--- USER REQUEST START/END ---` before being passed to Jules AI.
- **No Auto-Merge**: Jules is explicitly instructed never to merge Pull Requests — all changes require manual human review.
- **Branch Protection**: Automatically enforced on all managed repositories to prevent direct pushes.

## Out of Scope

- Vulnerabilities in third-party services (GitHub, Google Jules, Google Apps Script)
- Issues requiring physical access to the user's machine
- Social engineering attacks
