# Limits

| Limit | Value | How FileCrate handles it |
|---|---|---|
| Apex heap | 6 MB sync | Apex never loads file bytes |
| SOQL rows | 50,000 per transaction | Record Ids go to Apex 200 at a time |
| `ContentDocumentLink` filter rule | Must filter on `LinkedEntityId` or similar | Always queried by `LinkedEntityId IN` a chunk of Ids |
| Zip format | 4 GB and 65,535 entries per classic zip | Parts are capped at 3,500 MB and 60,000 files |
| Browser memory | Varies | Parts default to 1,500 MB and 500 files |
| A single huge file | Bigger than the part size | Not zipped; listed in `manifest.csv` with a link. Folder output has no such limit. |
| API requests | One per file, against the org's daily limit | Shown on the FileCrate Setup tab |
| Related records | 2,000 per relationship path | Configure narrower paths if you hit it |
| Search results | 200 records | Refine the search |
| SOQL mode | 10,000 records | Add a WHERE clause or LIMIT |
| Org file sources | 5,000 rows per load | Filter by folder, library, event type or date |

## What has been checked

- A 50 MB file downloads and matches the original byte for byte.
- A run forced into three parts produces three valid zips, each with its own manifest.
- Runs of a few dozen files across Files, Attachments, Notes and Enhanced Notes.
- SOQL mode, search, static resources, job history and the setup page, in Chrome.
- Folder output from a Lightning page and from a flow page, with a test folder standing in for the native picker.

## What has not been checked yet

- Runs of several GB, and the 5,000 file target.
- Firefox and Safari.
- Professional Edition.
- Related records on a record page, Documents, Library files and Event Log files in a browser (they have unit tests).
- The native folder picker dialog itself.

Each zip part is built in browser memory before it is saved, and each file is held in memory while it is added. Lower **Max Zip MB** if a browser struggles.
