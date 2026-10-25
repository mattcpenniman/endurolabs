# Race results links and attachments

The authenticated `/races` page has a **Results & keepsakes** card for each Garmin race activity. Save, replace, or clear an HTTP(S) online-results URL; upload/download/remove PDF, JPEG, or PNG certificates and photos. Maximum 5 MiB per file, 10 files per race. Uploads check both filename extension and file signature. The results URL is a link only; the server never fetches it.

## Deployment

Apply `scripts/add-race-resources.sql` (idempotent) or `npm run db:push` before deploying. No extra storage credentials, filesystem volume, or package dependency is needed. `race_resources` stores the URL and `race_attachments` stores metadata and base64 file contents in PostgreSQL. Include both tables in normal database backups; base64 adds roughly one-third to raw file size. Deleting an activity cascades to its resources.

## API and privacy

- `GET /api/races/[activityId]/resources`: URL and attachment metadata, never file contents.
- `PATCH` on the same route: `{ "resultsUrl": "https://..." }`; null/empty clears it.
- `POST` on the same route: multipart `file`. Streamed body is bounded to 5 MiB plus 64 KiB multipart overhead. Concurrent uploads lock the activity row to enforce the count limit.
- `GET /api/races/[activityId]/attachments/[attachmentId]`: authenticated download, attachment disposition, private/no-store and nosniff headers.
- `DELETE` on the download route removes one attachment.

All operations require the current account to own the race activity. Resources are not included in public race shares or prediction evidence and uploading a certificate does not change verification status. Supported formats are signature-checked, not malware-scanned; downloads are forced attachments rather than embedded previews.
