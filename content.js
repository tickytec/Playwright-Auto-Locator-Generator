/**
 * @file Content script for a Chrome extension that generates optimal Playwright locators.
 * It features an element picking mode, advanced locator generation strategies including chaining,
 * and a user-friendly UI for displaying and copying the generated locator.
 */

let isPickingMode = false;
let locatorDisplayDiv = null;
let currentFramework = 'pytest'; // 'pytest' or 'js'

// --- UTILITY AND VALIDATION FUNCTIONS ---

/**
 * Determines the implicit ARIA role of an element based on its tag name and attributes.
 * This is a comprehensive mapping based on ARIA in HTML specification.
 * @param {Element} element - The DOM element.
 * @returns {string|null} - The inferred ARIA role or null.
 */
function getImplicitRole(element) {
    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');

    // Explicit role always takes precedence.
    const explicitRole = element.getAttribute('role');
    if (explicitRole) return explicitRole;

    // Role mapping based on tag name.
    const roleMappings = {
        'a': 'link', 'area': 'link', 'button': 'button',
        'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
        'img': 'img', 'textarea': 'textbox', 'select': 'combobox',
        'li': 'listitem', 'ul': 'list', 'ol': 'list',
        'nav': 'navigation', 'form': 'form', 'dialog': 'dialog',
        'table': 'table', 'tr': 'row', 'td': 'cell', 'th': 'columnheader', 'thead': 'rowgroup', 'tbody': 'rowgroup', 'tfoot': 'rowgroup',
        'fieldset': 'group', 'option': 'option', 'optgroup': 'group',
        'progress': 'progressbar', 'meter': 'progressbar',
        'article': 'article', 'aside': 'complementary', 'footer': 'contentinfo', 'header': 'banner', 'main': 'main', 'section': 'region',
        'summary': 'button', 'details': 'group',
    };

    if (roleMappings[tagName]) return roleMappings[tagName];

    // Role mapping for <input> based on its type.
    if (tagName === 'input') {
        const inputTypeRoles = {
            'button': 'button', 'submit': 'button', 'reset': 'button',
            'checkbox': 'checkbox', 'radio': 'radio',
            'text': 'textbox', 'email': 'textbox', 'password': 'textbox', 'search': 'textbox',
            'tel': 'textbox', 'url': 'textbox', 'number': 'spinbutton', 'range': 'slider',
            'date': 'textbox', 'time': 'textbox', 'datetime-local': 'textbox'
        };
        // Default to 'textbox' for other text-like inputs, otherwise null.
        return inputTypeRoles[type] || 'textbox';
    }

    return null;
}

/**
 * Calculates the accessible name for a DOM element.
 * @param {Element} element - The DOM element.
 * @returns {string} - The calculated accessible name, trimmed.
 */
function getAccessibleName(element) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return (label.innerText || label.textContent).trim();
    }

    if (element.tagName.toLowerCase() === 'img') {
        const altText = element.getAttribute('alt');
        if (altText) return altText.trim();
    }

    // Use innerText as it respects visibility, but limit length.
    const text = (element.innerText || "").trim().replace(/\s+/g, ' ');
    if (text && text.length < 120) {
        return text;
    }
    
    const title = element.getAttribute('title');
    if (title) return title.trim();
    
    return '';
}

/**
 * Generates a simple, relative CSS selector for an element.
 * @param {Element} element - The target element.
 * @param {Element} parent - The parent to be relative to.
 * @returns {string} - A simple CSS selector.
 */
function getRelativeCSS(element, parent) {
    let selector = element.tagName.toLowerCase();
    
    // Use classes for specificity, ignoring dynamic/framework-specific ones.
    const stableClasses = Array.from(element.classList)
        .filter(cls => cls && !cls.includes(':') && !cls.includes('[') && cls.length > 2);
    if (stableClasses.length > 0) {
        selector += '.' + stableClasses.join('.');
    }

    const siblings = Array.from(parent.children);
    const elementsWithSameSelector = siblings.filter(sibling => sibling.matches(selector));

    if (elementsWithSameSelector.length > 1) {
        const index = elementsWithSameSelector.indexOf(element);
        selector += `:nth-of-type(${index + 1})`;
    }
    
    return selector;
}

/**
 * Checks if a locator is unique within a given scope (or document).
 * @param {string} locator - The locator method (e.g., 'getByRole').
 * @param {any} value - The primary value for the locator.
 * @param {Element} targetElement - The element we expect to find.
 * @param {Element} [scope=document] - The scope to search within.
 * @returns {boolean} - True if the locator finds only the targetElement within the scope.
 */
function isLocatorUniqueInScope(locator, value, targetElement, scope = document) {
    // This is a simplified check. A full-blown Playwright engine is not available.
    // We check for the most common cases.
    if (locator === 'getByRole') {
        const elements = Array.from(scope.querySelectorAll('*')).filter(el => getImplicitRole(el) === value);
        return elements.length === 1 && elements[0] === targetElement;
    }
    return false;
}


// --- CORE LOCATOR GENERATION LOGIC ---

/**
 * The main function to generate the best possible Playwright locator.
 * @param {Element} element - The target DOM element.
 * @param {string} framework - The target framework ('pytest' or 'js').
 * @returns {string|null} - The generated Playwright locator string or null on failure.
 */
function generateBestLocator(element, framework) {
    const isPytest = framework === 'pytest';
    const escapeStr = (str) => str.replace(/"/g, '\\"');

    const formatLocator = (method, value, options = null) => {
        const methodName = isPytest ? method.replace(/([A-Z])/g, '_$1').toLowerCase() : method;
        const formattedValue = `"${escapeStr(value)}"`;

        if (!options) {
            return `page.${methodName}(${formattedValue})`;
        }
        
        const optionsStr = isPytest
            ? Object.entries(options).map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'True' : 'False') : `"${escapeStr(v)}"`}`).join(', ')
            : `{ ${Object.entries(options).map(([k, v]) => `${k}: ${typeof v === 'boolean' ? v : `"${escapeStr(v)}"`}`).join(', ')} }`;
            
        return `page.${methodName}(${formattedValue}, ${optionsStr})`;
    };

    // --- Strategy 1: Test ID (Highest Priority) ---
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-qa') || element.getAttribute('data-test');
    if (testId) {
        return formatLocator('getByTestId', testId);
    }

    const role = getImplicitRole(element);
    const accName = getAccessibleName(element);

    // --- Strategy 2: Role + Accessible Name (Very Robust) ---
    if (role && accName) {
        return formatLocator('getByRole', role, { name: accName, exact: true });
    }

    // --- Strategy 3: Other Semantic `getBy` Locators ---
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return formatLocator('getByPlaceholder', placeholder, { exact: true });

    const altText = element.getAttribute('alt');
    if (altText) return formatLocator('getByAltText', altText, { exact: true });

    if (accName) return formatLocator('getByText', accName, { exact: true });
    
    // --- Strategy 4: Role without Name (if globally unique) ---
    if (role && isLocatorUniqueInScope('getByRole', role, element, document)) {
        return formatLocator('getByRole', role);
    }
    
    // --- Strategy 5: Chaining (Parent-Child) ---
    let parentElement = element.parentElement;
    for (let i = 0; i < 4 && parentElement && parentElement.tagName !== 'BODY'; i++) {
        const parentLocator = generateBestLocator(parentElement, framework);
        // Ensure the parent locator is stable (not a CSS fallback)
        if (parentLocator && !parentLocator.includes('locator(') && !parentLocator.includes('WARNING')) {
            // Now, find a simple, relative locator for the child.
            let childLocator;
            if (role) {
                // Check if getByRole is unique *within this parent*
                if (isLocatorUniqueInScope('getByRole', role, element, parentElement)) {
                    childLocator = formatLocator('getByRole', role).replace(/^page\./, '');
                    return `${parentLocator}.${childLocator}`;
                }
            }

            // Fallback to a simple relative CSS for the child
            const relativeCSS = getRelativeCSS(element, parentElement);
            if (parentElement.querySelectorAll(relativeCSS).length === 1) {
                const childCssLocator = `locator("${escapeStr(relativeCSS)}")`;
                return `${parentLocator}.${childCssLocator}`;
            }
        }
        parentElement = parentElement.parentElement;
    }
    
    // --- Strategy 6: CSS Selector (Last Resort) ---
    const cssSelector = getRelativeCSS(element, element.parentElement);
    const locator = `page.locator("${escapeStr(cssSelector)}")`;
    const comment = isPytest 
        ? "# WARNING: CSS selector fallback. Consider adding a data-testid or a more specific parent." 
        : "// WARNING: CSS selector fallback. Consider adding a data-testid or a more specific parent.";
    return `${locator} ${comment}`;
}


// --- EVENT HANDLERS AND UI (largely unchanged, but with English strings) ---

function handlePageClick(event) {
    if (!isPickingMode) return;
    event.preventDefault();
    event.stopPropagation();

    try {
        const generatedLocator = generateBestLocator(event.target, currentFramework);
        if (generatedLocator) {
            displayLocatorOnPage(generatedLocator);
            chrome.runtime.sendMessage({ action: "elementPicked", locator: generatedLocator });
        } else {
            displayLocatorOnPage("Could not generate a unique locator.", true);
        }
    } catch (error) {
        console.error("Error during locator generation:", error);
        displayLocatorOnPage(`An error occurred: ${error.message}`, true);
    } finally {
        disablePickingMode();
    }
}

function enablePickingMode(framework) {
    if (isPickingMode) return;
    isPickingMode = true;
    currentFramework = framework;
    document.addEventListener('click', handlePageClick, { capture: true, once: true });
    document.body.style.cursor = 'crosshair';
    hideLocatorDisplay();
}

function disablePickingMode() {
    if (!isPickingMode) return;
    isPickingMode = false;
    document.removeEventListener('click', handlePageClick, { capture: true });
    document.body.style.cursor = 'default';
}

function displayLocatorOnPage(text, isError = false) {
    hideLocatorDisplay();
    locatorDisplayDiv = document.createElement('div');
    const panelColor = isError ? '#e06c75' : '#61afef'; // Red for error, blue for success
    locatorDisplayDiv.style.cssText = `
        position: fixed; top: 20px; right: 20px; background-color: #282c34;
        color: #abb2bf; padding: 16px; border-radius: 8px; border-left: 4px solid ${panelColor};
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 14px;
        z-index: 2147483647; box-shadow: 0 8px 20px rgba(0,0,0,0.3);
        display: flex; align-items: center; gap: 15px; max-width: 600px;
    `;

    const locatorText = document.createElement('code');
    locatorText.textContent = text;
    locatorText.style.cssText = 'white-space: pre-wrap; word-break: break-all; user-select: all; flex-grow: 1;';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px;';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.style.cssText = `background-color: #61afef; color: #282c34; border: none; padding: 6px 12px; border-radius: 5px; cursor: pointer; font-size: 13px; font-weight: bold;`;
    copyButton.onclick = () => {
        const pureLocator = text.split(/ (#|\/\/)/)[0].trim();
        navigator.clipboard.writeText(pureLocator).then(() => {
            copyButton.textContent = 'Copied!';
            copyButton.style.backgroundColor = '#98c379';
            setTimeout(() => {
                copyButton.textContent = 'Copy';
                copyButton.style.backgroundColor = '#61afef';
            }, 2000);
        });
    };

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = `background-color: #4b5263; color: #abb2bf; border: none; padding: 6px 12px; border-radius: 5px; cursor: pointer; font-size: 13px;`;
    closeButton.onclick = hideLocatorDisplay;

    locatorDisplayDiv.appendChild(locatorText);
    if (!isError) {
        buttonContainer.appendChild(copyButton);
    }
    buttonContainer.appendChild(closeButton);
    locatorDisplayDiv.appendChild(buttonContainer);
    
    document.body.appendChild(locatorDisplayDiv);
}

function hideLocatorDisplay() {
    if (locatorDisplayDiv) {
        locatorDisplayDiv.remove();
        locatorDisplayDiv = null;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "togglePickingMode") {
        if (isPickingMode) {
            disablePickingMode();
            sendResponse({ status: "disabled" });
        } else {
            enablePickingMode(request.framework);
            sendResponse({ status: "enabled" });
        }
        return true;
    }
});

// Initial state
disablePickingMode();
hideLocatorDisplay();