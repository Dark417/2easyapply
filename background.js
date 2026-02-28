chrome.runtime.onInstalled.addListener(() => {
    console.log("easyapply MVP installed locally.");

    // Seed initial configuration into storage if empty
    chrome.storage.local.get(['profileData', 'settings'], (result) => {
        if (!result.profileData) {
            chrome.storage.local.set({
                profileData: {
                    firstName: "John",
                    lastName: "Doe",
                    phone: "1234567890"
                },
                settings: {
                    autopilotEnabled: true
                }
            });
            console.log("Initialized default mock profile data for easyapply.");
        }
    });
});
