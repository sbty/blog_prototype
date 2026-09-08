# Configuration

- Keep parsing and validation centralized and fail closed on missing, malformed,
  or contradictory safety settings.
- Samples must use fake IDs and URLs; credentials and signed-in profile data must
  never enter tracked configuration.
- When changing Blogger selectors, update typed defaults and
  `config/blogger-selectors.json` consistently, covering supported Japanese and
  English UI labels only where evidence exists.
