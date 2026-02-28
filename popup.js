// DOM Elements
const autopilotToggle = document.getElementById('autopilotToggle');
const firstNameInput = document.getElementById('firstName');
const lastNameInput = document.getElementById('lastName');
const phoneInput = document.getElementById('phone');
const saveBtn = document.getElementById('saveBtn');
const statusMessage = document.getElementById('statusMessage');

// Load existing data from Chrome Storage on popup open
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['profileData', 'settings'], (result) => {
        if (result.settings) {
            autopilotToggle.checked = result.settings.autopilotEnabled || false;
        }
        if (result.profileData) {
            firstNameInput.value = result.profileData.firstName || '';
            lastNameInput.value = result.profileData.lastName || '';
            phoneInput.value = result.profileData.phone || '';
        }
    });
});

// Save user preferences
saveBtn.addEventListener('click', () => {
    const profileData = {
        firstName: firstNameInput.value.trim(),
        lastName: lastNameInput.value.trim(),
        phone: phoneInput.value.trim()
    };

    const settings = {
        autopilotEnabled: autopilotToggle.checked
    };

    chrome.storage.local.set({ profileData, settings }, () => {
        statusMessage.innerText = "Configuration saved successfully!";
        setTimeout(() => {
            statusMessage.innerText = "";
        }, 2000);
    });
});
