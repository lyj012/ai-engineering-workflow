# Contributing

Thank you for improving this workflow project.

Before opening a pull request:

1. Keep changes scoped to the workflow, docs, examples, or checks you are updating.
2. Do not include customer repositories, local run output, secrets, personal memory, or machine-specific absolute paths.
3. Run:

```bash
node scripts/self-check.mjs
```

4. When changing `.claude/workflows/*.js`, keep each workflow self-contained and runnable from the repository root.
5. When adding examples, use tiny synthetic code only. Do not use real customer code.

Generated runtime directories under `evidence/runs/`, `evidence/plans/`, and `evidence/deliveries/` are intentionally ignored.
