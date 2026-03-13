# Abby User Manual

Welcome to **Abby**, your automated, privacy-first LinkedIn Easy Apply copilot. Abby consists of a Chrome extension that binds directly to the LinkedIn Easy Apply interface, offering live form-filling capabilities, and a headless Python automation script that handles job discovery, deduplication, and rate-limiting.

---

## 1. The Extension Popup (Browser Toolbar)
Click the ⚡ icon in your Chrome toolbar to open the Abby mini-menu. This is your quick-access operations center.

### **Features**
* **Enable Abby Switch**: Toggle the extension on or off. When enabled, Abby watches for LinkedIn job search pages and injects its overlay.
* **Light/Dark Theme Switch**: Instantly toggles the appearance of the Abby overlay on LinkedIn pages.
* **Statistics**: Displays counts for your Saved Answers, Saved Locations (Searches), and Ignored Keywords.
* **Search Controls**: 
  * Type a new search (e.g. `software engineer san francisco`) and click **Save**.
  * Use the dropdown to select a saved search.
  * Click the **Search** (Run) button to instantly open a new LinkedIn job search tab with your Easy Apply parameters setup.
* **Settings Access**: Click `Info` or `Search` at the bottom to open the full-page Settings dashboard (`settings.html`).

---

## 2. Full Settings Page (`settings.html`)
The settings dashboard allows you to configure advanced search pacing and manage your stored profile answers in bulk.

### **2.1 Profiles (Sidebar)**
* Create up to 10 distinct profiles (e.g., "Full Stack Dev", "Frontend Dev").
* Set the Profile Name, First Name, Last Name, and Phone Number.
* Easily delete or switch profiles (note: you must keep at least one).

### **2.2 Info Pane (Answer Management)**
* Displays all your cached answers grouped logically by their appearance in the Easy Apply flow (e.g., *Contact info*, *Voluntary self identification*, *Additional questions*).
* **Save, Edit, or Delete**: You can manually adjust any answer string or completely remove a row. Always click **Save All** at the top right to persist changes.

### **2.3 Search Pane (`/params` Configuration)**
Abby's automation relies on a shared `params` configuration state. This pane lets you tune the exact behavior of the Python automation loop.
* **Search Context**: Manage your queue of saved searches.
* **Ignore Keywords**: A comma-separated or newline list of terms (e.g., `founding, machine learning`). Any job listing title containing these words will be visually ignored by the extension and safely skipped by the automation.
* **Timing & Delays**:
  * *Random Delay (min/max)*: Adds humanized scatter delays between steps (in milliseconds).
  * *Detail Scroll Seconds*: How long the bot spends scrolling a job description to replicate human reading.
* **Rate Limits (Safety Guardrails)**:
  * Restrict how many applications the script is allowed to submit `Per Minute`, `Per Hour`, and `Per Day`.
* **Burst Rest**:
  * Configure Abby to "take a break" (e.g., rest for 5-10 seconds every 5 applications).

---

## 3. The Floating Panel (On LinkedIn)
When you browse `https://www.linkedin.com/jobs/search/`, the ⚡ Abby UI docks via a draggable, floating glassmorphism panel.

### **3.1 Step Tab (Live Form Assistant)**
* **Standing By**: When you click on a job, Abby watches for the "Easy Apply" modal to open.
* **Live Extraction**: As soon as the modal opens, Abby scans the Shadow DOM, bypassing hidden strings, and builds a clean table of the fields (Input, Dropdowns, Radios) on the current step.
* **Fill**: If Abby recognizes questions from your `CANONICAL_QUESTIONS` or previous saves, click **Fill** and it maps the answers instantly into the LinkedIn DOM.
* **Save**: Type directly into Abby's table (or the LinkedIn modal natively; they live-sync) and click **Save** to persist these answers to your Info table forever.

### **3.2 Info Tab (Quick Edits)**
* A stripped-down version of the Settings Info pane.
* Read, edit, or delete previously saved answers without needing to leave the LinkedIn search page.

### **3.3 Filter Tab (Auto-Skip Engine)**
* Add words to your "Blocked Keywords" list.
* The extension continuously scans the LinkedIn job feed. If a title matches a blocked keyword, it aggressively dims the card and appends a red `❌ SKIP` badge.

---

## 4. Automation & Workflows 

Behind the extension sits `util/lk.py`, a robust Python orchestrator that runs via the Chrome DevTools Protocol (CDP).

### **4.1 Manual Application Flow**
1. Navigate to LinkedIn Job Search.
2. Click Easy Apply.
3. Review Abby's extracted fields in the Step tab. 
4. Click **Fill** to map answers, correct anything missing, click **Save**, and manually click **Next/Submit**.

### **4.2 "lk search" (Shorthand Testing)**
* In your chat context, instruct the agent with `lk search`.
* The AI will execute a background skill that opens 3 distinct tabs in your debug browser targeting specific geographical locations (San Francisco, San Jose, Seattle) with Easy Apply filters turned on. 

### **4.3 Full Automation Tracking (`app-log.xlsx`)**
When running automation scripts (e.g. `python util/lk.py run --search "software engineer"`):
1. The script reads the `params` file.
2. Navigates to the search URL and scrapes all job cards.
3. Drops any card whose title hits the "Ignore Keywords" list.
4. Generates a **Unique SHA-1 Hash ID** based on the job url, title, and company to deduplicate.
5. Verifies the ID hasn't been submitted previously by checking `app-log.xlsx`.
6. Clicks the job, scrolls naturally, triggers the Easy Apply UI flow, and waits for a `submitted` POST message state from the extension.
7. Safely logs the submission back to `app-log.xlsx` to ensure you never double-apply, even across different cached search queries.
8. Enforces the Rate Limiter (waiting out slots if the Per Minute / Per Hour ceilings are hit).
