# Final Plan: Add `--greet <name>`

## Goal

Add `./app.sh --greet <name>` so the app prints `Hello, <name>!`.

## Current Behavior

- `examples/minimal-target/app.sh` handles the default case and `--help`.
- `examples/minimal-target/test.sh` verifies default output, help output, and unknown-option failure.

## Implementation

Modify `app.sh`:

- Add a `--greet` branch.
- Require a non-empty second argument.
- Preserve current default, help, and unknown-option behavior.

Modify `test.sh`:

- Add a new-feature assertion for `./app.sh --greet Alice`.
- Keep regression checks for default output and unknown options.

## Risk

Low. This is a local CLI behavior change with no persistence, permissions, network, payment, or file deletion.

## Verification

Run:

```bash
cd examples/minimal-target
bash ./test.sh
```

## Status

`readinessForDev=ready`
