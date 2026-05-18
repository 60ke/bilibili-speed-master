// Listen for speed updates from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPDATE_BADGE') {
        const text = message.speed === 1 ? '' : message.speed.toString() + 'x';
        chrome.action.setBadgeText({ 
            text: text,
            tabId: sender.tab.id 
        });
        chrome.action.setBadgeBackgroundColor({ 
            color: '#fb7299',
            tabId: sender.tab.id
        });
    }
});
