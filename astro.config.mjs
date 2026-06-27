// @ts-check
import { defineConfig } from 'astro/config';

// Deployed as a GitHub Pages *project* page:
//   https://kverkhovin.github.io/smix-website
// `site` + `base` ensure asset/link paths resolve under the /smix-website prefix.
export default defineConfig({
  site: 'https://kverkhovin.github.io',
  base: '/smix-website',
});
