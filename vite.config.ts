import { defineConfig } from 'vite';

/**
 * `base` is the path the built site is served from. A GitHub Pages *project* site lives at
 * `https://<user>.github.io/<repo>/`, so every asset URL needs that prefix baked in at
 * build time — a site built for `/` 404s on everything when served from a subpath.
 *
 * `BASE_PATH` overrides it for the other hosting shapes: `/` for a user site
 * (`<user>.github.io`) or a custom domain, or `/<other-repo>/` if the build is published
 * from a different repository.
 *
 * It applies in dev too, deliberately: serving dev from the same subpath as production is
 * how a base-path mistake gets caught before it reaches Pages.
 */
const base = process.env['BASE_PATH'] ?? '/shadows-threejs/';

export default defineConfig({
  base,
  server: { host: true },
  build: { target: 'es2022' },
});
