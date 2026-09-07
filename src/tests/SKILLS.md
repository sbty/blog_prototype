# Test guidance

- Test observable invariants and stop conditions, especially mutation boundaries,
  persistence after reload, target identity, and partial batch failure.
- Use the smallest fixture that exposes the behavior. Reuse established helpers;
  do not copy large operational JSON files into tests.
- Never relax a production guard merely to make a fixture pass. Update stale
  fixtures only when current behavior is independently established.
- Run focused Vitest files while iterating; run the repository validation suite
  once after the implementation is stable.
