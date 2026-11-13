# Limits

| Limit | Value | How FileCrate handles it |
|---|---|---|
| Apex heap | 6 MB sync | Apex never loads file bytes |
| SOQL rows | 50,000 per transaction | Record Ids go to Apex 200 at a time |
| `ContentDocumentLink` filter rule | Must filter on `LinkedEntityId` or similar | Always queried by `LinkedEntityId IN` a chunk of Ids |
| Zip format | 4 GB and 65,535 entries per classic zip | Parts are capped at 3,500 MB and 60,000 files |
| Browser memory | Varies | Parts default to 1,500 MB and 500 files |
| A single huge file | Bigger than the part size | Not zipped; listed in `manifest.csv` with a link |

## What has been checked

- A 50 MB file downloads and matches the original byte for byte.
- A run forced into three parts produces three valid zips, each with its own manifest.
- Runs of a few dozen files across Files, Attachments, Notes and Enhanced Notes.

## What has not been checked yet

- Runs of several GB, and the 5,000 file target.
- Firefox and Safari.
- Professional Edition.

Each zip part is built in browser memory before it is saved, and each file is held in memory while it is added. Lower **Max Zip MB** if a browser struggles.
