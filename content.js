/**
 * @file content.js
 * This script is injected into web pages. It handles two main features:
 * 1. The "Locator Generator": An element picking mode to automatically generate a stable Playwright locator.
 * 2. The "Selector Verifier": An engine to find and highlight elements on the page based on a manually entered locator string (CSS or Playwright).
 */

// --- STATE VARIABLES ---
let isPickingMode = false;
let locatorDisplayDiv = null;
let currentFramework = 'pytest';

// --- UTILITY FUNCTIONS ---

function getImplicitRole(element) {
    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    const explicitRole = element.getAttribute('role');
    if (explicitRole) return explicitRole;

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

    if (tagName === 'input') {
        const inputTypeRoles = {
            'button': 'button', 'submit': 'button', 'reset': 'button',
            'checkbox': 'checkbox', 'radio': 'radio',
            'text': 'textbox', 'email': 'textbox', 'password': 'textbox', 'search': 'textbox',
            'tel': 'textbox', 'url': 'textbox', 'number': 'spinbutton', 'range': 'slider',
            'date': 'textbox', 'time': 'textbox', 'datetime-local': 'textbox'
        };
        return inputTypeRoles[type] || 'textbox';
    }
    return null;
}

function getAccessibleName(element) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return (label.innerText || label.textContent).trim();
    }

    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');

    // =================================================================
    // ADDED THIS BLOCK TO CORRECTLY GET THE NAME FROM <input type="submit">
    // =================================================================
    if (tagName === 'input' && ['submit', 'button', 'reset'].includes(type)) {
        if (element.value) {
            return element.value.trim();
        }
    }

    if (tagName === 'img') {
        const altText = element.getAttribute('alt');
        if (altText) return altText.trim();
    }

    const text = (element.innerText || "").trim().replace(/\s+/g, ' ');
    if (text && text.length < 120) return text;
    
    const title = element.getAttribute('title');
    if (title) return title.trim();
    
    return '';
}

function getRelativeCSS(element, parent) {
    let selector = element.tagName.toLowerCase();
    const stableClasses = Array.from(element.classList)
        .filter(cls => cls && !cls.includes(':') && !cls.includes('[') && cls.length > 2);
    if (stableClasses.length > 0) selector += '.' + stableClasses.join('.');

    const siblings = Array.from(parent.children);
    const elementsWithSameSelector = siblings.filter(sibling => sibling.matches(selector));

    if (elementsWithSameSelector.length > 1) {
        const index = elementsWithSameSelector.indexOf(element);
        selector += `:nth-of-type(${index + 1})`;
    }
    return selector;
}

function isLocatorUniqueInScope(locator, value, targetElement, scope = document) {
    if (locator === 'getByRole') {
        const elements = Array.from(scope.querySelectorAll('*')).filter(el => getImplicitRole(el) === value);
        return elements.length === 1 && elements[0] === targetElement;
    }
    return false;
}

function generateBestLocator(element, framework) {
    const isPytest = framework === 'pytest';
    const escapeStr = (str) => str.replace(/"/g, '\\"');

    const formatLocator = (method, value, options = null) => {
        const methodName = isPytest ? method.replace(/([A-Z])/g, '_$1').toLowerCase() : method;
        const formattedValue = `"${escapeStr(value)}"`;
        if (!options) return `page.${methodName}(${formattedValue})`;
        const optionsStr = isPytest
            ? Object.entries(options).map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'True' : 'False') : `"${escapeStr(v)}"`}`).join(', ')
            : `{ ${Object.entries(options).map(([k, v]) => `${k}: ${typeof v === 'boolean' ? v : `"${escapeStr(v)}"`}`).join(', ')} }`;
        return `page.${methodName}(${formattedValue}, ${optionsStr})`;
    };

    const testId = element.getAttribute('data-testid') || element.getAttribute('data-qa') || element.getAttribute('data-test');
    if (testId) return formatLocator('getByTestId', testId);

    const role = getImplicitRole(element);
    const accName = getAccessibleName(element);

    if (role && accName) return formatLocator('getByRole', role, { name: accName, exact: true });

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return formatLocator('getByPlaceholder', placeholder, { exact: true });

    const altText = element.getAttribute('alt');
    if (altText) return formatLocator('getByAltText', altText, { exact: true });

    if (accName) return formatLocator('getByText', accName, { exact: true });
    
    if (role && isLocatorUniqueInScope('getByRole', role, element, document)) {
        return formatLocator('getByRole', role);
    }
    
    let parentElement = element.parentElement;
    for (let i = 0; i < 4 && parentElement && parentElement.tagName !== 'BODY'; i++) {
        const parentLocator = generateBestLocator(parentElement, framework);
        if (parentLocator && !parentLocator.includes('locator(') && !parentLocator.includes('WARNING')) {
            let childLocator;
            if (role && isLocatorUniqueInScope('getByRole', role, element, parentElement)) {
                childLocator = formatLocator('getByRole', role).replace(/^page\./, '');
                return `${parentLocator}.${childLocator}`;
            }
            const relativeCSS = getRelativeCSS(element, parentElement);
            if (parentElement.querySelectorAll(relativeCSS).length === 1) {
                const childCssLocator = `locator("${escapeStr(relativeCSS)}")`;
                return `${parentLocator}.${childCssLocator}`;
            }
        }
        parentElement = parentElement.parentElement;
    }
    
    const cssSelector = getRelativeCSS(element, element.parentElement);
    const locator = `page.locator("${escapeStr(cssSelector)}")`;
    const comment = isPytest 
        ? "# WARNING: CSS selector fallback. Consider adding a data-testid." 
        : "// WARNING: CSS selector fallback. Consider adding a data-testid.";
    return `${locator} ${comment}`;
}

function findAndHighlight(locatorString) {
    document.querySelectorAll('[data-playwright-verifier-highlight]').forEach(el => {
        el.style.outline = '';
        el.removeAttribute('data-playwright-verifier-highlight');
    });

    let foundElements = [];
    try {
        const cssElements = Array.from(document.querySelectorAll(locatorString));
        if (cssElements.length > 0 && !locatorString.includes('getBy')) {
            foundElements = cssElements;
        }
    } catch (e) { /* Ignore invalid CSS selector errors */ }

    if (foundElements.length === 0) {
        const locatorMatch = locatorString.match(/(getBy[A-Za-z]+)\s*\((.*)\)/);
        const locatorCssMatch = locatorString.match(/locator\s*\(\s*(['"`])(.*?)\1\s*\)/);

        if (locatorCssMatch) {
            foundElements = Array.from(document.querySelectorAll(locatorCssMatch[2]));
        } else if (locatorMatch) {
            const method = locatorMatch[1];
            const rawArgs = locatorMatch[2].trim();
            const argMatch = rawArgs.match(/['"`](.*?)['"`]/);
            if (argMatch) {
                const value = argMatch[1];
                const allVisibleElements = Array.from(document.querySelectorAll('*')).filter(el => el.offsetParent !== null);
                foundElements = allVisibleElements.filter(el => {
                    // For the verifier, we use a slightly different logic to match user intent
                    switch (method) {
                        case 'getByRole':
                            // Allow matching by role AND name if provided in options
                            const nameMatch = rawArgs.match(/name\s*:\s*['"`](.*?)['"`]/);
                            if (nameMatch) {
                                return getImplicitRole(el) === value && getAccessibleName(el).includes(nameMatch[1]);
                            }
                            return getImplicitRole(el) === value;
                        case 'getByText': return (el.innerText || el.textContent || "").trim().includes(value);
                        case 'getByLabel': return getAccessibleName(el).includes(value);
                        case 'getByPlaceholder': return el.getAttribute('placeholder') === value;
                        case 'getByAltText': return el.getAttribute('alt') === value;
                        case 'getByTitle': return el.getAttribute('title') === value;
                        case 'getByTestId': return (el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-test')) === value;
                        default: return false;
                    }
                });
            }
        }
    }
    
    foundElements.forEach(el => {
        el.style.outline = '3px solid #ff4757';
        el.setAttribute('data-playwright-verifier-highlight', 'true');
    });
    return foundElements.length;
}

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
    const panelColor = isError ? '#e06c75' : '#61afef';
    locatorDisplayDiv.style.cssText = `position: fixed; top: 20px; right: 20px; background-color: #282c34; color: #abb2bf; padding: 16px; border-radius: 8px; border-left: 4px solid ${panelColor}; font-family: 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 14px; z-index: 2147483647; box-shadow: 0 8px 20px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 15px; max-width: 600px;`;
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

disablePickingMode();
hideLocatorDisplay();