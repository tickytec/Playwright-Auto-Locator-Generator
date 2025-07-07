let isPickingModeActive = {}; // Use an object to track state per tab

chrome.action.onClicked.addListener((tab) => {
    // Inject content.js if it's not already injected (idempotent operation)
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error injecting content script:', chrome.runtime.lastError.message);
            return;
        }

        // Toggle picking mode for the current tab
        isPickingModeActive[tab.id] = !isPickingModeActive[tab.id];
        const action = isPickingModeActive[tab.id] ? "enablePickingMode" : "disablePickingMode";

        chrome.tabs.sendMessage(tab.id, { action: action, framework: 'pytest' }) // You can change 'pytest' to 'js' here if needed
            .catch(error => {
                // This catch handles errors if the content script is not yet ready,
                // or if the tab navigated away, etc.
                if (error.message.includes("Could not establish connection. Receiving end does not exist.")) {
                    console.warn(`Content script not ready or page changed for tab ${tab.id}. Please refresh the page and try again.`);
                    // Optionally, reset state if connection failed
                    isPickingModeActive[tab.id] = false;
                } else {
                    console.error('Error sending message to content script:', error);
                }
            });
    });
});

// Listener for messages from content.js (e.g., when an element is picked)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "elementPickedAndGenerated") {
        console.log("Locator generated:", message.locator);
        // You could extend this to save to storage, send to an external service, etc.
        // For now, it just logs and disables picking mode for the current tab
        if (sender.tab && sender.tab.id) {
            isPickingModeActive[sender.tab.id] = false; // Reset state after picking
        }
    }
});

// Clean up state when a tab is closed or navigated away from
chrome.tabs.onRemoved.addListener((tabId) => {
    delete isPickingModeActive[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && isPickingModeActive[tabId]) {
        // If the page starts loading while picking mode is active, disable it
        // This prevents lingering crosshair or incorrect state
        isPickingModeActive[tabId] = false;
        // Optionally, send a message to content.js to clean up if it's still alive
        chrome.tabs.sendMessage(tabId, { action: "disablePickingMode" }).catch(() => {});
    }
});