# Application workflows

- Services orchestrate domain checks, repositories, and browser adapters. Keep
  selectors, CLI parsing, and direct process/environment access out of them.
- Make mutation scope explicit in inputs and fail closed before external work.
  One item failing must not silently mark a batch successful.
- Preserve successful items during recovery and emit compact structured results
  suitable for one aggregate report.
- Use injected adapters for external behavior so focused tests can prove stop
  conditions without weakening production guards.
