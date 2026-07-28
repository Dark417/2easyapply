# easyapply Chrome Extension - MVP Specification

Platform-specific architecture: [Workday Auto Apply Flow](task2-workday-flow.md).

# LinkedIn posted-time filter

The floating `Search` tab starts with two linked horizontal time controls: Hours (`0–24`, including decimal values such as `0.3`) and Days (`0–30`). The most recently edited control is authoritative. Clicking **OK** converts that value to seconds, writes LinkedIn's `f_TPR=r<seconds>` URL parameter, and reloads the current page; zero removes the parameter. The same persisted value is also added when Eve opens a new LinkedIn search.

Search controls are ordered as: posted time, ignore keywords, search mode, location, saved locations, Search, then click/delay and rate-limit settings.

# Auto Apply activation

The floating `Apply` tab exposes an Auto Apply switch backed by `eveApplyMode`. Switching it on only arms automation. The user must click **Auto Apply** to start or resume; switching it off immediately cancels all scheduled selection and click actions. LinkedIn and Workday use the same mode setting and interaction contract.

## 1. Overview
`easyapply` is a locally-used Chrome Extension designed to streamline the job application process on LinkedIn. The long-term goal is to achieve feature parity with top-tier autofill extensions like "Simplify Copilot" but tailored strictly for local command and personalized use.

## 2. Competitive Research: "Simplify" Chrome Extension
To build the "ultimate copy," here is a deep dive into the core features of the "Simplify" Chrome extension:
- **Universal Autofill:** Automatically fills in repetitive information (name, contact details, education, work experience, EEO questions) and uploads resumes across various ATS platforms.
- **Multi-page Form Automation:** Capable of continuously autofilling multi-page application forms, auto-progressing through steps until submission.
- **LinkedIn Integration Flow:** Integrates directly into job boards (like LinkedIn) parsing specific job descriptions to help tailor the application.
- **AI-Powered Assistance:** Uses AI to answer unique "custom questions" on applications based on saved profile data, reducing the need to manually type out behavioral or technical answers.
- **Application Tracking:** Automatically logs submitted applications into a centralized dashboard for tracking statuses.

## 3. MVP Features for `easyapply`
For the initial MVP, the extension will focus specifically on handling LinkedIn's "Easy Apply" flows, ensuring the user doesn't have to repeatedly fill out dropped/forgotten data fields.

### Core Functionality
1. **Activation:**
   - Automatically activates when the browser navigates to the `linkedin.com` domain.
   - Can also be triggered manually via an extension popup.
   - When active, the plugin UI stays pinned/docked to the top right of the page.
   - Automation itself has a hard two-part gate: Apply Mode must be **Auto**, and the user must explicitly click the Eve **Apply** button to start or resume. Native Easy Apply clicks, modal appearance, page load, and legacy bootstrap state never start automation.
   - Switching Apply Mode to Manual or disabling Eve immediately cancels active and pending automated filling, selection, and clicking. Re-enabling does not restart anything until the user clicks Apply again.

2. **Smart Autofill & Continuity:**
   - **Problem:** LinkedIn's Easy Apply sometimes forgets user inputs between sessions or drops custom dropdown selections.
   - **Solution:** `easyapply` will detect when a form field (input text, dropdown, radio button) is empty or requires re-entry.
   - It will automatically read from a local configuration (or saved state) to autofill standard fields.
   - It will auto-select predefined answers for dropdown menus (e.g., "Yes" to sponsorship, "10+" years of experience).

3. **Auto-Progression:**
   - Once all required fields on the current popup page are filled, the extension will automatically click the "Next" or "Review" button to proceed to the subsequent step, creating an "autopilot" feel.

## 4. Technical Architecture (Proposed)
- **Manifest V3:** Adherence to modern Chrome Extension standards.
- **Content Scripts:** Injected into `linkedin.com` to read the DOM, detect Easy Apply modals, fill input fields, and trigger click events.
- **Background Service Worker:** To manage activation state and message passing between the popup and content scripts.
- **Popup UI (Top Right):** A vanilla HTML/CSS/JS interface injected into the webpage or managed via the action button to show current status (e.g., "Autofilling Step 2/4").
- **Local Storage:** `chrome.storage.local` to securely save the user's answers and profile data locally.

## 5. Upcoming Implementation Milestones
- [ ] Scaffold Manifest V3 extension.
- [ ] Build Content Script to detect LinkedIn "Easy Apply" modals.
- [ ] Implement robust DOM selectors for LinkedIn's specific input types (standard inputs, custom LinkedIn dropdowns `select` or `div`-based listboxes).
- [ ] Build the sticky/docked UI overlay.
- [ ] Implement auto-click sequence for the "Next" button.
# Workday integration note

For URLs containing `myworkdayjobs.com`, use the isolated Workday adapter documented in [task2-workday-flow.md](task2-workday-flow.md). In this project, **sim** means the Simplify extension. Workday automation is user-activated only, applies a two-second minimum delay between automated interactions, delegates most application pages to sim, and owns the fixed My Information page using the separate `workdaySavedAnswers` store.
