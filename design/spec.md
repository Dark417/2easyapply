# easyapply Chrome Extension - MVP Specification

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
