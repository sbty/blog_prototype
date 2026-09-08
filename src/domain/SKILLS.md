# Domain logic

- Keep domain code deterministic and side-effect free: no browser, filesystem,
  network, process environment, clocks, or logging without an explicit value.
- Model safety decisions and invariants as strict, readable results. Unknown or
  contradictory evidence is not success.
- Put Blogger-specific stored-content normalization in the existing explicit
  normalization boundary; do not hide real content or permalink differences.
- Add small table-driven tests for each new rule and its negative cases.
