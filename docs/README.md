# Event Documents Folder

Place event-specific PDFs and CSVs here so the Tracker app can display them
automatically when that event is selected.

## Folder structure

```
docs/
  <event_code>/
    file1.pdf
    file2.csv
    ...
```

The `<event_code>` must exactly match the event code stored in the database
(e.g. `LDV-100-2026-0001`).  Only `.pdf` and `.csv` files are served.

## Example

```
docs/
  LDV-100-2026-0001/
    Course_Map.pdf
    Aid_Station_Contacts.pdf
    Volunteer_Roster.csv
  KH-SOB-2026-0003/
    Aid_Station_Guide.pdf
    Runners.csv
```

When the operator selects "Leona Divide 100 (LDV-100-2026-0001)" from the
event dropdown, the Tracker footer automatically shows clickable links to
every file in `docs/LDV-100-2026-0001/`.

## Notes

- File names are displayed as-is; use readable names (e.g. `Course_Map.pdf`).
- Files are served directly by the web server; no database changes needed.
- If the folder for an event does not exist the documents section is hidden.
