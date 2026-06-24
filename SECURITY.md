# Security Policy

## Reporting

Please report security-sensitive issues privately to the repository owner instead of opening a public issue.

Security-sensitive issues include:

- leaked credentials or tokens;
- customer code or private data in examples or evidence;
- workflow behavior that writes outside its sandbox;
- unsafe file deletion, git push, force push, or credential handling;
- payment, permission, authentication, or irreversible-state workflows that can be modified without human review.

## Supported Scope

This repository provides Claude Code workflow scripts and methodology. It does not claim to sandbox the host operating system by itself. Treat generated diffs as untrusted until a human reviews them.

`deliver-from-plan` is designed to work in a copied sandbox and produce a diff. It must not commit, merge, push, or modify the original target repository.
