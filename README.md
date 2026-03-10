# 2easyapply

Chrome extension + automation helpers for LinkedIn Easy Apply workflows.

## Download And Install
1. Clone the repo:
   - `git clone git@github.com:Dark417/2easyapply.git`
2. Go into the project:
   - `cd 2easyapply`
3. Open Chrome extension page:
   - `chrome://extensions/`
4. Enable **Developer mode** (top-right).
5. Click **Load unpacked**.
6. Select the extension folder path:
   - `<your-cloned-repo>/abby`
7. Pin Abby from the Chrome toolbar (optional, recommended).

## Local File Persistence (Required)
Abby can save search/apply configuration into a local file named `params` in the repo root.

1. Start the local params API bridge:
   - `python util/lk.py serve`
2. Keep it running while using Abby.
3. Abby will read/write local file data through:
   - `http://127.0.0.1:8765/params`
4. The persisted file is:
   - `<your-cloned-repo>/params`

## How To Use Abby
### 1. Open the correct LinkedIn page
Abby UI/automation is available only on LinkedIn Jobs pages:
- `https://www.linkedin.com/jobs/search/...`
- `https://www.linkedin.com/jobs/view/...`

### 2. Use the extension menu (toolbar popup)
1. Click Abby from Chrome toolbar to open the popup menu.
2. In popup:
   - Turn on **Enable Abby**.
   - Set or select your search location.
   - Click **Search** to open/apply search setup.
3. Use **Settings** button in popup to open full settings page.

### 3. Use the full Settings page
In `settings.html`, configure:
- Global toggles: **Enable Abby**, **Dark Theme**
- **Profile Name**
- Saved answers grouped by step/section
- Search and apply pacing/rate limits
- Ignore keywords for job cards

When editing saved answers:
- Abby saves per canonical mapping where applicable.
- Abby keeps step-specific answers scoped (for fields that are not canonical).

### 4. Auto apply behavior
1. From LinkedIn jobs search/view page, open an **Easy Apply** job.
2. Abby floating panel appears on supported pages.
3. In Abby panel:
   - Use **Apply** to run auto apply loop.
   - Use **Step** tab to inspect current Easy Apply fields.
   - Use **Save** to persist answers.
4. Abby only progresses on Easy Apply modal flows and uses saved answers when field mappings match.

## Notes
- Extension source is under `abby/`.
- File-based persistence is through the repo `params` file (bridge mode).
- Some UI state and saved answers are also kept in Chrome local extension storage.
