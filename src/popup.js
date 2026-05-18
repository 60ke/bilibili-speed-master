document.addEventListener('DOMContentLoaded', () => {
    const persistCheckbox = document.getElementById('persistSpeed');
    const manualSpeedInput = document.getElementById('manualSpeed');

    const CONFIG = {
        storageKey: 'bilibili_speed_master_rate',
        persistKey: 'persist_speed_enabled'
    };

    // Load initial state
    chrome.storage.local.get([CONFIG.storageKey, CONFIG.persistKey], (result) => {
        persistCheckbox.checked = result[CONFIG.persistKey] !== false;
        manualSpeedInput.value = result[CONFIG.storageKey] || 1.0;
    });

    // Handle manual speed change
    manualSpeedInput.addEventListener('change', () => {
        const val = parseFloat(manualSpeedInput.value);
        if (!isNaN(val) && val > 0 && val <= 16) {
            chrome.storage.local.set({ [CONFIG.storageKey]: val }, () => {
                // Broadcast to active tabs
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_SPEED', speed: val });
                    }
                });
            });
        }
    });

    // Save persistence state
    persistCheckbox.addEventListener('change', () => {
        chrome.storage.local.set({ [CONFIG.persistKey]: persistCheckbox.checked });
    });
});
