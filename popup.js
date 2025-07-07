document.addEventListener('DOMContentLoaded', function() {
    // === Elements for Locator Generator ===
    const pickElementButton = document.getElementById('pickElementButton');
    const locatorOutputDiv = document.getElementById('locatorOutput');
    const copyLocatorButton = document.getElementById('copyLocatorButton');
    const frameworkSelector = document.querySelectorAll('input[name="framework"]');

    // === Elements for Selector Verifier ===
    const checkButton = document.getElementById('checkButton');
    const locatorInput = document.getElementById('locatorInput');
    const messageDiv = document.getElementById('message');

    let currentLocator = '';
    let selectedFramework = 'pytest';

    // --- Part 0: Load stored preferences and locator ---
    chrome.storage.local.get(['lastGeneratedLocator', 'selectedFramework'], function(result) {
        if (result.lastGeneratedLocator) {
            locatorOutputDiv.textContent = result.lastGeneratedLocator;
            currentLocator = result.lastGeneratedLocator;
            copyLocatorButton.style.display = 'block';
        } else {
            locatorOutputDiv.textContent = 'Click "Pick Element" to start.';
        }
        if (result.selectedFramework) {
            selectedFramework = result.selectedFramework;
            document.getElementById(selectedFramework).checked = true;
        }
    });

    // --- Part 1: Locator Generator Logic ---
    frameworkSelector.forEach(radio => {
        radio.addEventListener('change', function() {
            selectedFramework = this.value;
            chrome.storage.local.set({ selectedFramework: selectedFramework });
        });
    });

    pickElementButton.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: "togglePickingMode", framework: selectedFramework }, function(response) {
                if (chrome.runtime.lastError) {
                    locatorOutputDiv.textContent = 'Error: Could not connect. Please refresh the page.';
                    return;
                }
                if (response && response.status === "enabled") {
                    window.close();
                }
            });
        });
    });

    copyLocatorButton.addEventListener('click', function() {
        if (currentLocator) {
            navigator.clipboard.writeText(currentLocator).then(() => {
                copyLocatorButton.textContent = 'Copied!';
                setTimeout(() => { copyLocatorButton.textContent = 'Copy Locator'; }, 1500);
            });
        }
    });

    // --- Part 2: Selector Verifier Logic (RESTORED) ---
    checkButton.addEventListener('click', function() {
        const selector = locatorInput.value.trim();
        messageDiv.style.display = 'block'; // Show message area
        if (!selector) {
            messageDiv.textContent = 'Please enter a CSS selector.';
            messageDiv.style.color = '#d9534f'; // Red
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) {
                messageDiv.textContent = 'No active tab found.';
                messageDiv.style.color = '#d9534f';
                return;
            }
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: highlightElements,
                args: [selector]
            }, (results) => {
                if (chrome.runtime.lastError) {
                    messageDiv.textContent = `Error: ${chrome.runtime.lastError.message}`;
                    messageDiv.style.color = '#d9534f';
                } else if (results && results[0] && results[0].result !== undefined) {
                    const count = results[0].result;
                    if (count > 0) {
                        messageDiv.textContent = `Found and highlighted ${count} element(s).`;
                        messageDiv.style.color = '#5cb85c'; // Green
                    } else {
                        messageDiv.textContent = 'No elements found with this selector.';
                        messageDiv.style.color = '#f0ad4e'; // Orange
                    }
                }
            });
        });
    });

    // This function is injected into the page to find and highlight elements
    function highlightElements(selector) {
        // Clear previous highlights first
        document.querySelectorAll('[data-locator-checker-highlight]').forEach(el => {
            el.style.outline = '';
            el.removeAttribute('data-locator-checker-highlight');
        });

        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.outline = '3px solid #ff4757'; // A bright red outline
                el.dataset.locatorCheckerHighlight = 'true';
            });
            return elements.length;
        } catch (e) {
            // This will catch invalid CSS selectors
            return 0;
        }
    }


    // --- Part 3: Listen for messages from content script ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "elementPickedAndGenerated") {
            const generatedLocator = request.locator;
            locatorOutputDiv.textContent = generatedLocator;
            currentLocator = generatedLocator;
            chrome.storage.local.set({ lastGeneratedLocator: generatedLocator });
            copyLocatorButton.style.display = 'block';
        }
    });
});