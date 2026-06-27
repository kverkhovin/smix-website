# smix-website

Landing page for **smix** — a wrapper for Elixir's [Mix](https://hexdocs.pm/mix/Mix.html)
that extends it with additional capabilities.

The first headline feature is smarter compiler-warning handling:

1. **Ignore all warnings** from the compiler.
2. **Show only warnings for changes on the current branch.**
3. **Mute a specific warning** by leaving a comment in code.

(A second capability is TBD.)

The site is a single static landing page built with [Astro](https://astro.build)
and deployed to GitHub Pages.

## Local development

Requires Node.js 18+.

```sh
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:4321/smix-website)
npm run build    # build the static site into dist/
npm run preview  # preview the production build locally
```

## Project structure

```
src/
  layouts/Base.astro       # HTML shell, <head> meta / OG tags, global styles
  pages/index.astro        # the landing page, composing the sections below
  components/
    Hero.astro             # name, tagline, CTA, demo terminal
    Features.astro         # the three warning-management capabilities
    Install.astro          # install + quick-start commands
    Roadmap.astro          # available vs. coming-soon (TBD)
    Footer.astro           # links and copyright
    Terminal.astro         # reusable terminal/code block
  styles/global.css        # design tokens + base styles (plain CSS)
public/favicon.svg
.github/workflows/deploy.yml
```

## Deployment

Pushing to `main` (or `claude/smix-website-q7kxgb`) triggers
`.github/workflows/deploy.yml`, which builds the site with Astro and publishes it
to GitHub Pages.

> **One-time setup:** in the repository's **Settings → Pages**, set the build and
> deployment **Source** to **GitHub Actions**. The site is then served at
> `https://kverkhovin.github.io/smix-website`.

If the published URL ever changes (e.g. a custom domain or a different repo name),
update `site` and `base` in `astro.config.mjs` accordingly.

## Content note

smix is in early development, so the exact install command, CLI flag names, and the
mute-with-a-comment syntax shown on the site are representative placeholders. Update
the relevant components in `src/components/` once the real commands are finalized.
