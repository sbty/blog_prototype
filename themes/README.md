# Blogger themes

`Japan Practical Answers` is intentionally excluded while that blog is on hold.

| Blog config | Blogger theme |
| --- | --- |
| `compatibility-database.blog.json` | `compatibility-database-blueprint.xml` |
| `desk-gear-lab.blog.json` | `desk-gear-lab-geek.xml` |
| `game-platform-lab.blog.json` | `game-platform-lab-platform-grid.xml` |
| `global-app-spec-lab.blog.json` | `global-app-spec-lab-app-console.xml` |
| `pc-game-troubleshooting.blog.json` | `pc-game-troubleshooting-diagnostic.xml` |
| `repair-maintenance-lab.blog.json` | `repair-maintenance-lab-workshop.xml` |
| `service-change-alternatives.blog.json` | `service-change-alternatives-status.xml` |
| `travel-rules-lab.blog.json` | `travel-rules-lab-passport.xml` |

The seven generated variants use `desk-gear-lab-geek.xml` as their shared Blogger
layout. Regenerate them after changing the shared layout or theme definitions:

```sh
npm run themes:generate
npm run themes:check
```

Before importing a theme in Blogger, download a backup of the blog's current
theme. Importing an XML theme changes layout and widget settings; it does not set
the blog favicon. Favicons are stored separately in `assets/favicons`.
