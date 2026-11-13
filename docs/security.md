# Security

## Access

- Every Apex class is `with sharing`, and every query runs `WITH USER_MODE`. Sharing, object permissions and field-level security are enforced by the platform.
- Records a user cannot see are dropped before any file lookup, so they produce no rows.
- The browser fetches bytes with the user's own session through the REST API. The API applies the same access rules again.

## No data leaves Salesforce

There are no callouts and no third-party servers. Bytes travel from your Salesforce org to your browser, and the zip is written to your Downloads folder.

## The engine page

- `FcEngine` is a Visualforce page that runs in a hidden iframe. It uses the page's session Id to call the REST API on the same origin.
- It only accepts messages from its direct parent window, and only when that parent is on this org's Lightning origin or on the same Visualforce origin (where Salesforce serves flow pages). It replies only to the origin that spoke.
- The builder only accepts a message when it carries the builder's own nonce and comes from the org's exact Visualforce origin, which is derived from the page's own host.
- Granting access to the page (through the permission sets) does not grant access to any file. Access is decided per file by Salesforce.

## SOQL mode

- Only users with the `Fc_Run_SOQL` custom permission can use it. The check is made in Apex, not just in the screen.
- Only a single `SELECT Id FROM <object> ...` statement is accepted. Other select lists, subqueries in the select list, and second statements are rejected.
- The query runs in user mode, so it returns only records the user can already see, and it is capped at 10,000 rows.

## Search

Only letters and digits from the search box are used, each as a prefix-matched word. Nothing typed can act as search syntax.

## Job history

`FcJob__c` is private. A user sees their own runs. `FileCrate_Admin` grants View All. The stored request can contain record Ids and a SOQL string, but never file contents.

## CSV safety

Cells in `manifest.csv` and `errors.csv` that start with `=`, `+`, `-` or `@` (also after leading whitespace) are prefixed with a single quote, so a spreadsheet does not run a file name as a formula.

## File names

Characters that are illegal in Windows or macOS file names, and control characters, are replaced with `_`. Paths inside the zip never contain `..` segments taken from record or file names, because `/` and `\` are replaced before names are joined.

## Reporting a problem

Please open a private security advisory on the repository instead of a public issue.
