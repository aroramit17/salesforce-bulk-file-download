# Contributing to FileCrate

Thanks for helping. A few rules keep the project healthy.

## Ground rules

- **Clean-room only.** FileCrate is built from public Salesforce documentation. Do not copy code, screens, wording, icons or help text from any commercial product, and do not describe FileCrate in terms of another product.
- **Apex never touches file bytes.** Apex returns metadata. The browser fetches and zips.
- **Respect sharing.** Every Apex class is `with sharing` and every query uses `WITH USER_MODE`.
- **No silent skips.** A file that cannot be fetched goes into `errors.csv`.
- **All user-facing text is a Custom Label**, exposed to components through `lwc/fcLabels`.

## Workflow

1. Write a failing test first. Jest for JavaScript, Apex tests for Apex.
2. Make it pass with the smallest change.
3. Run `npm run build` if you touched `lwc/fcCore/fcCore.js` or `engine/fcEngine.js`. The generated bundle is committed, and a test fails when it is stale.
4. Run `npm test` and the Apex tests before opening a pull request.

## Where things live

| Path | What |
|---|---|
| `force-app/main/default/lwc/fcCore` | Pure logic: names, folders, CSV, part planning. No imports, no DOM. |
| `engine/fcEngine.js` | Fetch queue and zip writer. Dependencies are injected so Jest can run it. |
| `scripts/build-bundle.js` | Builds the static resource the engine page loads. |
| `force-app/main/default/pages/FcEngine.page` | Thin host for the engine. |
| `force-app/main/default/lwc/fcCrateBuilder` | Options, preview, progress, saving. |
| `force-app/main/default/classes` | Metadata-only Apex services and tests. |
