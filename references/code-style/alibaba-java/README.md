# Alibaba Java guidelines — injection slot (PLACEHOLDER, NOT LOADED)

> ⚠️ This is a **placeholder only**. The actual《阿里巴巴 Java 开发手册》text has **NOT** been provided to
> the pipeline. Do not assume it is loaded. Do not claim any check was performed against it.

For Java target projects, the Alibaba Java guidelines are the **default external reference** — but only at
precedence rank 3 (see `../README.md`): the customer's own conventions and the project's prevailing style
always win over it, and it never justifies broad refactors of existing code.

## Status

- Spec text present: **NO** (placeholder).
- Pipeline behavior while this stays a placeholder: treat Alibaba guidelines as **not loaded**; record
  `阿里规范：未接入（占位）` in `project-code-style` / `delivery-manifest.codeStyle.specSource`; fall back to
  generic Java best practices for style judgments; never state "checked against Alibaba guidelines".

## To activate

Add the real specification content into this directory (e.g. `manual.md`, or chapter files), then the
pipeline's detection step will see real spec text and switch `specSource` to `阿里规范：已接入`. Respect the
source's license before committing any copyrighted text; if license-restricted, keep the spec out of git and
inject it at runtime instead.
