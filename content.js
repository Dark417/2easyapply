// easyapply content script injecting into LinkedIn

console.log("easyapply: Content script loaded into LinkedIn.");

// 1. Inject the floating UI
function injectFloatingUI() {
    if (document.getElementById('easyapply-floating-ui')) return;

    const uiContainer = document.createElement('div');
    uiContainer.id = 'easyapply-floating-ui';
    uiContainer.innerHTML = `
    <div class="ea-header">
      <span class="ea-title">⚡ easyapply</span>
      <span id="ea-status-indicator" class="ea-status-active"></span>
    </div>
    <div class="ea-body">
      <p id="ea-current-action">Waiting for Easy Apply modal...</p>
    </div>
  `;
    document.body.appendChild(uiContainer);
}

// 2. Poll for the Easy Apply Modal
function pollForModal() {
    setInterval(() => {
        // LinkedIn usually wraps their modals heavily, we look for identifying markers of the Easy Apply flow
        const modalFound = document.querySelector('.jobs-easy-apply-modal') || document.querySelector('[data-test-modal-id="easy-apply-modal"]');
        const statusText = document.getElementById('ea-current-action');

        if (modalFound) {
            if (statusText) statusText.innerText = "Modal detected. Analyzing fields...";
            attemptAutofill(modalFound);
        } else {
            if (statusText) statusText.innerText = "Waiting for Easy Apply modal...";
        }
    }, 1500);
}

// 3. Mock logic to attempt autofill (to be expanded in future iterations)
function attemptAutofill(modalNode) {
    chrome.storage.local.get(['profileData', 'settings'], (result) => {
        if (!result.settings || !result.settings.autopilotEnabled) return;

        // Example: Look for generic text inputs inside the modal
        const inputs = modalNode.querySelectorAll('input[type="text"], input[class*="fb-single-line-text"]');
        let filledSomething = false;

        inputs.forEach(input => {
            // Extremely naive autofill logic (just checking if empty and putting a mock value based on labels)
            if (input.value === "") {
                const parentText = input.parentElement.innerText.toLowerCase();
                if (parentText.includes("first name") && result.profileData.firstName) {
                    input.value = result.profileData.firstName;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    filledSomething = true;
                }
                // ... expanding this is the real challenge due to DOM obfuscation
            }
        });

        // 4. Auto-progress to 'Next' if we filled something or if conditions are met
        if (filledSomething) {
            const nextButton = modalNode.querySelector('button[aria-label="Continue to next step"], button span.artdeco-button__text');
            if (nextButton && nextButton.innerText.trim().includes("Next")) {
                console.log("easyapply: Auto-clicking Next.");
                // nextButton.parentElement.click(); // Commented out for safety during boilerplate verification
            }
        }
    });
}

// Initialize
injectFloatingUI();
pollForModal();
