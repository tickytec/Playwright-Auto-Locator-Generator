/**
 * @file popup.js
 * This script manages the UI and interactions within the extension's popup.
 * It communicates with the content script (content.js) to trigger actions on the page.
 */
document.addEventListener('DOMContentLoaded', function() {
    // === UI Elements ===
    const pickElementButton = document.getElementById('pickElementButton');
    const locatorOutputDiv = document.getElementById('locatorOutput');
    const copyLocatorButton = document.getElementById('copyLocatorButton');
    const frameworkSelector = document.querySelectorAll('input[name="framework"]');
    const checkButton = document.getElementById('checkButton');
    const locatorInput = document.getElementById('locatorInput');
    const messageDiv = document.getElementById('message');

    // === State Variables ===
    let currentLocator = '';
    let selectedFramework = 'pytest';

    // --- Part 1: Initialization ---
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

    // --- Part 2: Locator Generator Logic ---
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
                    window.close(); // Close popup to allow user to click on the page
                }
            });
        });
    });

    copyLocatorButton.addEventListener('click', function() {
        if (currentLocator) {
            const pureLocator = currentLocator.split(/ (#|\/\/)/)[0].trim();
            navigator.clipboard.writeText(pureLocator).then(() => {
                copyLocatorButton.textContent = 'Copied!';
                setTimeout(() => { copyLocatorButton.textContent = 'Copy Locator'; }, 1500);
            });
        }
    });

    // --- Part 3: Selector Verifier Logic ---
    checkButton.addEventListener('click', function() {
        const selector = locatorInput.value.trim();
        messageDiv.style.display = 'block';
        if (!selector) {
            messageDiv.textContent = 'Please enter a selector or locator.';
            messageDiv.style.color = '#d9534f';
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (!tabs.length) {
                messageDiv.textContent = 'No active tab found.';
                messageDiv.style.color = '#d9534f';
                return;
            }
            
            // =================================================================
            // THIS IS THE CORRECTED PART
            // =================================================================
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                // We pass an anonymous function that will be executed on the page.
                // This function can then call `findAndHighlight` because it exists on the page.
                func: (selectorToFind) => {
                    // This code runs inside the web page's context
                    return findAndHighlight(selectorToFind);
                },
                args: [selector] // Pass the user's input as an argument to our anonymous function
            }, (results) => {
                if (chrome.runtime.lastError) {
                    messageDiv.textContent = `Error: ${chrome.runtime.lastError.message}. Try refreshing the page.`;
                    messageDiv.style.color = '#d9534f';
                } else if (results && results[0] && results[0].result !== undefined) {
                    const count = results[0].result;
                    if (count > 0) {
                        messageDiv.textContent = `Found and highlighted ${count} element(s).`;
                        messageDiv.style.color = '#5cb85c';
                    } else {
                        messageDiv.textContent = 'No elements found with this locator.';
                        messageDiv.style.color = '#f0ad4e';
                    }
                } else {
                    // This case handles when the script injection itself fails without a chrome.runtime error
                    messageDiv.textContent = 'Could not execute script on the page. It may be protected.';
                    messageDiv.style.color = '#d9534f';
                }
            });
        });
    });

    // --- Part 4: Listen for messages from content script ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "elementPicked") {
            const generatedLocator = request.locator;
            locatorOutputDiv.textContent = generatedLocator;
            currentLocator = generatedLocator;
            chrome.storage.local.set({ lastGeneratedLocator: generatedLocator });
            copyLocatorButton.style.display = 'block';
        }
    });
});