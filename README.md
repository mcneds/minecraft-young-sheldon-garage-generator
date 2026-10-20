# Minecraft GIF Maker

[Open the generator](https://mcneds.github.io/minecraft-young-sheldon-garage-generator/)

Put up to 12 Minecraft skins into the Young Sheldon garage animation. Enter Java usernames or upload skin PNGs, choose positions, then download a GIF or still image. Rendering runs in your browser.

## Development

Requires Node.js 24 and npm.

```sh
cd web
npm ci
npm run dev
```

## Checks and build

```sh
cd web
npm test
python3 -m unittest discover -s tests -p test_web_template.py
npx playwright install chromium
npm run test:browser
npm run build
```

The static site is built into `web/dist/`. Prepared animation assets are included; no Minecraft installation, Blender or backend is required.

## Deployment

GitHub Actions tests, builds and deploys the site to GitHub Pages on changes to `web/` or the deployment workflow on `main`. The workflow can also be run manually. Pages uses **GitHub Actions** as its publishing source and the build uses `/minecraft-young-sheldon-garage-generator/` as its base path.

See [the app documentation](web/README.md) for controls, skin lookup, privacy and prepared asset details. Third-party notices are in [web/public/THIRD_PARTY_NOTICES.txt](web/public/THIRD_PARTY_NOTICES.txt).
