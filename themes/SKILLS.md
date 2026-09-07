# Blogger themes

- Treat generated theme XML as output. Change the generator/source template in
  `scripts/generate-blogger-themes.mjs`, then run `npm run themes:generate` and
  `npm run themes:check`.
- Preserve valid Blogger XML/entity escaping; verify title text does not expose
  numeric entities literally.
- Applying a theme to a live blog is an external mutation and requires an
  explicitly scoped authorization separate from local generation.
