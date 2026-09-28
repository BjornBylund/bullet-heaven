// Single place the PixiJS version is pinned. Every other module imports from here,
// so bumping the version is a one-line change. ESM caches by URL, so this is one fetch.
export * from 'https://cdn.jsdelivr.net/npm/pixi.js@8.20.1/dist/pixi.min.mjs';
