# Minecraft GIF Maker

A static app that puts 1–12 Minecraft skins into the train-room animation. It uses the v7 poses, camera path, clean backgrounds and railway masks. Three.js supplies interactive skin rendering; a worker encodes the GIF on the visitor's device. There is no backend, account system or local rendering companion.

## Run locally

Use Node.js 24 or later:

```sh
cd web
npm ci
npm run dev
```

Open the Local URL printed by Vite (normally `http://127.0.0.1:5173`). Add Java usernames separated by commas or spaces, or choose **Add skin**. Positions fill center, left, right, then supporting positions. Changing a position swaps its current occupant; removing a player leaves that position empty. Duplicate names remain independent cast entries.

Uploads accept 64×64 and legacy 64×32 PNGs. They override fetched skins and stay on the device. Automatic arm width uses the fetched profile; an upload without a profile defaults to classic. Use **Arm width** to override it. Legacy skins are mirrored and normalized using the same vanilla alpha rules as the Java exporter. The page does not retain cast entries after reload.

Use **Find in scene** on a player card to jump to that position’s clear appearance window. Scrub or pause the preview, then generate a 256×256 or 498×498 looping GIF. **Save PNG** downloads the selected frame as PNG. All 85 original frame delays are retained (2,830 ms total). Changing the cast, positions, model widths or export resolution invalidates the previous GIF download. Cancel stops the encoding worker; only one frame is sent at a time. Encoding speed depends on the device.

The app needs WebGL 2, Web Workers, Canvas 2D and modern browser image decoding. A missing WebGL 2 context produces an explanatory message. Reduced-motion preference starts the preview paused. Browser lighting approximates the Blender render; geometry, skin scale, camera and authored timing come from the baked scene.

## Build and publish to GitHub Pages

```sh
cd web
npm run build
npm run preview
```

`web/dist/` is the complete static site. Its normal build uses relative URLs so it can be served from a subdirectory. It requires an HTTP server; opening `index.html` with `file://` does not load the assets correctly.

The repository's `pages.yml` workflow installs Node dependencies, checks the prepared assets, runs unit and browser tests, builds, and deploys **only `web/dist/`**. It runs on pushes to `main` affecting the app and supports manual dispatch. In the GitHub repository's **Settings → Pages**, choose **GitHub Actions** as the source. The workflow selects `/repository-name/` automatically, or `/` for a `*.github.io` repository. Set the repository Actions variable `BASE_PATH` to `/` when using a custom domain, or to another required path including leading and trailing slashes.

The live website is https://mcneds.github.io/minecraft-young-sheldon-garage-generator/. This repository contains the browser app and prepared scene assets.

## Skin lookup and privacy

Username lookups go directly from the visitor's browser to [PlayerDB](https://playerdb.co/). The texture metadata supplies the classic/slim model and Minecraft texture URL. Textures are fetched as CORS blobs from `textures.minecraft.net`; profiles without a texture use [Crafthead](https://crafthead.net/) as a default-skin fallback. Successful lookups are cached in page memory. Public API failures, timeouts and rate limits show an upload alternative; there is no API key or secret in the frontend. Uploaded skins and generated images are never sent to these services. Rendering after skins and template assets are loaded is local.

## Prepared scene assets

`public/template/` is included in source and is sufficient for a normal frontend build. It contains:

- 24 skin-free GLBs: classic/slim rig and animation for each of 12 fixed positions.
- Six lossless WebP atlases per background layer, each containing up to 16 frames.
- A versioned manifest with camera samples, position labels, original frame delays, asset paths and readable appearance windows.
- Full-cast validation results for all 264 slot/model pairings per frame and conservative combined classic/slim visibility.

Only two atlases per layer are decoded at a time; the fixed set of compressed atlas blobs is cached in memory to avoid repeated network requests while looping. GLB geometry is reused when a position is revisited. Textures and skeleton resources are disposed when actors change; exported object URLs and workers are released on replacement, cancellation or page close. The GIF encoder uses one palette sampled across the animation, then streams frames sequentially to bound memory.

The prepared assets are included; Blender and the original animation pipeline are not needed to build or run this website. Template regeneration happens separately in the original animation project.

The browser template shifts the right lead 0.12 units to the right to keep the rear-right player readable with either arm width. All original v7 outputs stay unchanged.

The browser template checks both arm widths for every position, including clothing. Self-intersection within one skin is permitted; inter-player intersections are forbidden. Each supporting position needs a continuous readable appearance of at least 600 ms; the leads must remain readable throughout. Removing players can only improve those occlusion bounds. Preview bones are sampled at `frame / 30`; playback and export use the separate original GIF delays.

## Verification

```sh
cd web
npm test
npx playwright install chromium
npm run test:browser
npm run build
python3 -m unittest discover -s tests -p test_web_template.py
```

Browser tests use deterministic fixture skins and mocked profile responses, so CI does not depend on third-party availability. They cover cast counts, duplicate names, width inference, occupied/empty position moves, upload overrides, legacy conversion, lookup failure, mobile layout, missing WebGL, cancellation, repeated GIF export, stale downloads and PNG export. The generated GIF is parsed independently to verify both dimensions, all 85 frame delays and its loop flag. The prepared-asset tests verify every exported animation's root position and duration, preventing accidental action sharing across slots. Browser tests also compare 1,152 posed body-part bounds to evaluated Blender geometry, including reverse timeline sampling.
