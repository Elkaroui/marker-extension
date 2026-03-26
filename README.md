# Marker

Marker is a browser extension that lets you highlight text on any website with a floating color menu and a modern popup UI.

## Stack

- React + TypeScript
- Tailwind CSS
- Vite
- `@crxjs/vite-plugin` for the Chrome extension build

## Features

- Floating menu appears when you select text
- Preset palette plus custom color picker
- Multiple highlights on the same page
- Highlights persist in extension storage and restore on reload
- Popup UI to change the default color and clear the current page

## Run

```bash
npm install
npm run build
```

Then load the unpacked extension from [`dist`](D:\Doc\marker\dist) in Chrome or Edge.

## Develop

```bash
npm run dev
```

## Publish To GitHub

Initialize and commit locally:

```bash
git init -b main
git add .
git commit -m "Initial Marker extension"
```

Then connect your GitHub repo and push:

```bash
git remote add origin <your-github-repo-url>
git push -u origin main
```
