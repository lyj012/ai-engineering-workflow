# Delivery Report: Add `--greet <name>`

## Final Status

`DELIVERED`

## Verification

The sanitized example delivery expects:

```bash
cd examples/minimal-target
bash ./test.sh
```

The completed implementation should print `ALL PASSED`.

## Changed Files

- `app.sh`
- `test.sh`

## Diff Apply Check

`git apply --check examples/artifacts/delivery-success/changes.diff` passes when run from `examples/minimal-target`.

## Open Items

None in this sanitized example.

## Notes

This artifact is illustrative. It contains no customer code and no author-machine absolute paths.
