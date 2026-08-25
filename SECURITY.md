# Security Policy

## Supported Versions

Glyph is currently an early-stage project.

Security fixes are generally focused on the latest released version.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ⚠️ Best effort |
| Development builds | ❌ |

---

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub Issues.

If you believe you have found a security vulnerability in Glyph, please contact the project maintainer privately through the security contact listed on the GitHub repository.

When reporting a vulnerability, please include:

- A clear description of the issue.
- Steps to reproduce it.
- The affected Glyph version.
- Your operating system and version.
- The potential impact.
- A proof of concept, if safe to provide.
- Any suggested mitigation.

Please avoid including sensitive personal information.

---

## What to Expect

After receiving a security report:

1. The report will be reviewed.
2. The issue will be investigated and reproduced where possible.
3. The severity and impact will be assessed.
4. A fix or mitigation will be developed when appropriate.
5. A patched release may be published if necessary.

Please allow reasonable time for investigation before publicly disclosing the vulnerability.

---

## Scope

Security reports related to the following areas are especially important:

- PTY and shell execution
- Tauri IPC commands
- Native filesystem access
- Process management
- Clipboard integration
- Privilege boundaries
- Terminal escape sequence handling
- Dependency vulnerabilities
- Application packaging

---

## Responsible Disclosure

Please avoid publicly disclosing an exploitable vulnerability before a fix or mitigation is available.

Thank you for helping keep Glyph and its users safe.