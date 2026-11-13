# Architecture

## The one rule

Apex returns file **metadata** only. File **bytes** go from Salesforce straight to the browser, which builds the zip. The Apex heap limit (6 MB synchronous) therefore never limits how big a zip can be.

## Pieces

| Piece | Role |
|---|---|
| `fcCrateBuilder` (LWC) | Options, size preview, progress. Asks Apex for file rows, hands them to the engine, saves the zips it gets back. |
| `fcRecordFiles` (LWC) | Record page wrapper around the builder for the current record. |
| `fcCrateTab` (LWC) | Object and list view pickers around the builder. |
| `FileCrate_Download_From_List` (flow) | Receives the Ids ticked in a list view and shows the builder. |
| `FcFileQueryService` (Apex) | File rows for up to 200 records per call. |
| `FcRecordService` (Apex) | Record names, object list, list views. |
| `FcSettingsService` (Apex) | Settings with defaults. |
| `FcEngine` (Visualforce page) | Hidden iframe. Fetches bytes over REST and zips with fflate. |
| `fcCore` + `engine/fcEngine.js` | The logic, shared and unit tested. |

## Why a Visualforce page

A Lightning component cannot read file bytes itself: the normal download URLs redirect to a separate file domain and the browser blocks the cross-origin read. A Visualforce page has a session that works with the REST API, and the REST blob endpoints (`/sobjects/ContentVersion/{id}/VersionData`, `/sobjects/Attachment/{id}/Body`) return bytes directly. So the engine lives in a Visualforce page inside a hidden iframe.

## Messages

The builder and the engine talk with `window.postMessage`. Every message is `{ fc: 1, type, ... }`.

| Direction | type | Purpose |
|---|---|---|
| engine → builder | `ready` | Engine loaded |
| builder → engine | `listview` | Resolve a list view to record Ids |
| engine → builder | `ids` | Those Ids |
| builder → engine | `start`, `rows`, `cancel` | Run a job; rows arrive in pages of 500 |
| engine → builder | `progress`, `part`, `done`, `fatal` | Progress, a finished zip as a Blob, the outcome |

## A download, step by step

1. The builder calls `FcFileQueryService.getFiles` with record Ids in chunks of 200.
2. It filters rows in the browser and shows the count, size and number of zips.
3. On Download it sends the options and rows to the engine.
4. The engine plans the parts, fetches each file (small files up to four at a time), and writes it into the zip. Already compressed types are stored; the rest are deflated.
5. Each part gets its own `manifest.csv`. The last part also gets `errors.csv` if anything failed.
6. The engine posts each finished zip to the builder as a Blob, and the builder saves it.

## Flow pages

Salesforce serves `/flow/...` pages on the org's Visualforce domain, not the Lightning domain. The engine therefore accepts two parent origins: the org's Lightning origin and its own Visualforce origin.
