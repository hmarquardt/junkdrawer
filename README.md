# Hank's Junk Drawer of Random Pages

A playful GitHub Pages landing page for a repository full of standalone single-page experiments, tools, demos, and assorted digital weirdness.

The goal is simple: drop new `.html` files into the repo and let the home page discover them automatically, so you do **not** have to manually edit `index.html` every time you add another page.

## What It Does

This project provides a single-page `index.html` that:

- Displays a modern, fun landing page titled **Hank's Junk Drawer of Random Pages**
- Uses the GitHub REST API to inspect the public repository contents
- Automatically finds `.html` files in the repo
- Builds a menu/card grid linking to those pages
- Skips `index.html` so the homepage does not list itself
- Supports optional metadata through `junk-drawer.json`
- Works well as a GitHub Pages repo-based site

## Why the GitHub API Is Needed

GitHub Pages is static hosting. That means JavaScript running in the browser cannot directly ask the server, “What files are in this directory?”

Instead, this page uses GitHub's public repository API to list files in the repo, then builds the menu in the browser.

This works best when the repository is public.

## Basic Repo Structure

A simple setup might look like this:

```text
/
├── index.html
├── favicon.ico
├── junk-drawer.json        optional
├── timer.html
├── absurdities.html
├── camera-monitor.html
└── assets/
    ├── favicon-16.png
    ├── favicon-32.png
    └── apple-touch-icon.png
```

Each standalone page can simply live as its own `.html` file.

## Setup

1. Add the generated `index.html` file to the root of your repo.
2. Add your standalone `.html` pages to the repo.
3. Enable GitHub Pages for the repository.
4. Visit your GitHub Pages URL.

For a repo named `junk-drawer`, the URL would usually be:

```text
https://YOUR-USERNAME.github.io/junk-drawer/
```

## Configuration

Inside `index.html`, look for the configuration block:

```js
const CONFIG = {
  owner: "hmarquardt",
  repo: "your-repo-name",
  branch: "main",
  rootPath: "",
  maxDepth: 3
};
```

### `owner`

Your GitHub username or organization name.

Example:

```js
owner: "hmarquardt"
```

### `repo`

The repository name.

Example:

```js
repo: "junk-drawer"
```

### `branch`

Usually `main`, unless your GitHub Pages site is published from another branch.

```js
branch: "main"
```

### `rootPath`

Use an empty string if your pages are in the repo root.

```js
rootPath: ""
```

If your pages are inside a subfolder, use something like:

```js
rootPath: "pages"
```

### `maxDepth`

Controls how deeply the index page searches folders for `.html` files.

```js
maxDepth: 3
```

For a simple repo, `1` or `2` may be enough. For a repo with nested folders, use `3` or higher.

## Optional Page Metadata

You can add a `junk-drawer.json` file to customize how discovered pages appear.

Example:

```json
{
  "pages": {
    "timer.html": {
      "title": "RWS Time Block Timer",
      "description": "A countdown helper for recurring timesheet blocks.",
      "emoji": "⏱️"
    },
    "absurdities.html": {
      "title": "Collection of Absurdities",
      "description": "A local-first time capsule for weirdness, links, media, and notes.",
      "emoji": "🌀"
    },
    "private-test.html": {
      "hide": true
    }
  }
}
```

### Supported Metadata Fields

| Field | Purpose |
|---|---|
| `title` | Display name for the page card |
| `description` | Short explanation shown under the title |
| `emoji` | Fun visual marker for the card |
| `hide` | If `true`, the page is not shown |

If no metadata exists for a page, the index will generate a readable title from the file name.

For example:

```text
rws-time-block-timer.html
```

becomes something like:

```text
Rws Time Block Timer
```

## Favicon Support

You can use a favicon on GitHub Pages without a custom domain.

Recommended files:

```text
/favicon.ico
/assets/favicon-16.png
/assets/favicon-32.png
/assets/apple-touch-icon.png
```

Add this to the `<head>` of `index.html` and any standalone pages:

```html
<link rel="icon" href="./favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="./assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="./assets/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="./assets/apple-touch-icon.png">
```

Use relative paths like `./favicon.ico`, not `/favicon.ico`, because repo-based GitHub Pages sites live under a path like:

```text
https://YOUR-USERNAME.github.io/REPO-NAME/
```

A root-relative path would point to the account-level root instead of the repo site.

## Adding a New Page

To add a new page:

1. Create a new `.html` file.
2. Commit and push it to the repo.
3. The homepage should discover it automatically.
4. Optionally add metadata for it in `junk-drawer.json`.

Example:

```text
weird-camera-viewer.html
```

Optional metadata:

```json
{
  "pages": {
    "weird-camera-viewer.html": {
      "title": "Weird Camera Viewer",
      "description": "A strange little RTSP/ONVIF viewer experiment.",
      "emoji": "📹"
    }
  }
}
```

## Notes and Limitations

Because the menu is built using the GitHub API:

- The repo generally needs to be public.
- API responses may be cached briefly.
- GitHub API rate limits may apply.
- Very large repositories may need a lower `maxDepth` or a more curated structure.
- If using a custom domain, automatic repo detection may not work and the config should be filled in manually.

## Suggested Naming Style

Use clear, descriptive filenames:

```text
time-block-timer.html
collection-of-absurdities.html
rtsp-monitor.html
keto-meal-randomizer.html
```

Avoid spaces in filenames. Hyphens are easiest to read and work well in URLs.

## Project Philosophy

This is not meant to be precious.

It is a junk drawer: a useful, chaotic, half-brilliant, half-questionable pile of tools, toys, experiments, demos, rabbit holes, prototypes, and “I made this because I wanted it to exist” pages.

Add weird things. Break stuff. Fix some of it. Keep going.
