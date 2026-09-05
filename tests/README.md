# Journal verification

Run from the project root with Node.js 22+ and an installed Chrome:

```powershell
node tests/journal-browser.cjs
```

Set `CHROME_PATH` if Chrome is installed elsewhere. The test launches a hidden,
isolated headless profile and a loopback-only server. Supabase is replaced by a
synthetic in-memory implementation in the served test page. HTTPS requests are
blocked. The production HTML on disk and the user's Supabase account are never
modified by the test.

Checks cover incomplete/contradictory scores, result-independent discipline,
plan snapshots, draft restoration, successful and failed saves, historical field
preservation, Learn rules, date/environment filters, and mobile overflow. PNGs
for visual inspection are written to the temporary `tif-journal-qa` folder.

Optional: point `TRADE_FIXTURE` at a local trade export to verify that opening and
saving each historical trade preserves every original field. The test uses
copies, replaces embedded screenshots with empty strings, and prints only the
number of records and field names on failure. Do not commit private exports.
