# Operational data

- This directory contains evidence and generated operational artifacts, not the
  application specification. Start from the exact manifest/report named by the
  task and follow only its direct references; never bulk-read the directory.
- Treat prior audit reports as immutable evidence. Write a new versioned output
  or explicitly approved destination instead of rewriting history.
- Prefer one compact aggregate JSON plus item details only when needed. Record
  status, reason, target ID, source provenance, and timestamp without screenshots
  or copied HTML unless required for diagnosis.
- Never store credentials, cookies, tokens, or signed-in profile contents here.
