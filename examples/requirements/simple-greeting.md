# Example Requirement

Add a CLI flag `--greet <name>` to the sample shell app.

Acceptance criteria:

- `./app.sh --greet Alice` prints `Hello, Alice!`.
- `./app.sh` keeps the current default output.
- Unknown flags still return a non-zero exit code.
- Add a verification script that checks both the new behavior and the existing default behavior.
