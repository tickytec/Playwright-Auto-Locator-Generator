let isPickingMode = false;
let locatorDisplayDiv = null;
let currentFramework = 'pytest';

/**
 * Checks if a given CSS selector is unique on the page and targets the specific element.
 * @param {string} selector - The CSS selector to verify.
 * @param {Element} targetElement - The element that should be found.
 * @returns {boolean} - True if the selector finds exactly one element, and it's the target.
 */
function isSelectorUnique(selector, targetElement) {
    try {
        const elements = document.querySelectorAll(selector);
        return elements.length === 1 && elements[0] === targetElement;
    } catch (e) {
        // console.warn(`Invalid selector check: ${selector}`, e);
        return false; // Invalid selector syntax
    }
}

/**
 * Gets the implicit ARIA role for an element based on its tag and attributes,
 * considering explicit role first.
 * @param {Element} element - The DOM element.
 * @returns {string|null} - The inferred role or null.
 */
function getImplicitRole(element) {
    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    const role = element.getAttribute('role'); // Explicit role takes precedence

    if (role) return role; // Explicit role is always preferred

    switch (tagName) {
        case 'button': return 'button';
        case 'a': return 'link';
        case 'img': return 'img';
        case 'textarea': return 'textbox';
        case 'select': return 'combobox';
        case 'input':
            if (['button', 'submit', 'reset'].includes(type)) return 'button';
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            // Playwright treats number, date, range, color, tel, email, url, search as textbox
            if (['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'range', 'color'].includes(type)) return 'textbox';
            break; // No implicit role for other input types
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
        case 'li': return 'listitem';
        case 'ul': case 'ol': return 'list';
        case 'nav': return 'navigation';
        case 'form': return 'form';
        case 'dialog': return 'dialog';
        case 'menu': return 'menu';
        case 'menuitem': return 'menuitem';
        case 'tab': return 'tab';
        case 'table': return 'table';
        case 'th': case 'td': return 'cell';
        case 'tr': return 'row';
        case 'fieldset': return 'group';
        case 'option': return 'option';
        case 'meter': case 'progress': return 'progressbar';
        case 'article': return 'article';
        case 'aside': return 'complementary';
        case 'footer': return 'contentinfo';
        case 'header': return 'banner';
        case 'main': return 'main';
        case 'section': return 'region';
        case 'output': return 'status';
        case 'summary': return 'button'; // A <summary> element with a parent <details> implies a button role
        case 'datalist': return 'listbox';
    }
    return null;
}

/**
 * Gets a robust accessible name for Playwright's getByRole or getByLabel/Text.
 * Considers aria-label, aria-labelledby, associated label, text content, alt text, title, and value for inputs.
 * @param {Element} element - The DOM element.
 * @returns {string} - The accessible name or empty string.
 */
function getAccessibleName(element) {
    // 1. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // 2. aria-labelledby
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
        try {
            const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
            const labelTexts = ids.map(id => {
                const labelEl = document.getElementById(id);
                return labelEl ? (labelEl.innerText || labelEl.textContent || '').trim() : '';
            }).filter(Boolean);
            if (labelTexts.length > 0) return labelTexts.join(' ').trim();
        } catch (e) {
            console.warn("Error resolving aria-labelledby:", e);
        }
    }

    // 3. <label for="..."> association
    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return (label.innerText || label.textContent || '').trim();
    }

    // 4. Input value for specific types
    const tagName = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    if (tagName === 'input' && ['submit', 'reset', 'button'].includes(type)) {
        if (element.value) return element.value.trim();
    }
    if ((tagName === 'input' && ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(type)) ||
        tagName === 'textarea') {
        if (element.value) return element.value.trim();
    }
    
    // 5. Image alt text
    if (tagName === 'img') {
        const altText = element.getAttribute('alt');
        if (altText) return altText.trim();
    }

    // 6. Visible text content (innerText is generally better than textContent for visible text)
    // Ensure element is visible and not script/style content
    if (element.nodeType === Node.ELEMENT_NODE && element.offsetParent !== null && !element.hidden) {
        let textContent = element.innerText || element.textContent || '';
        textContent = textContent.trim();

        // Filter out text from child script/style tags or text that is just whitespace or too long
        if (textContent.length > 0 && textContent.length < 80) {
            // Further refinement: remove text from script/style tags for a cleaner text representation
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = element.innerHTML;
            Array.from(tempDiv.querySelectorAll('script, style')).forEach(n => n.remove());
            const cleanText = (tempDiv.innerText || tempDiv.textContent || '').trim();
            if (cleanText.length > 0 && cleanText.length < 80) {
                return cleanText;
            }
        }
    }
    
    // 7. Title attribute
    const title = element.getAttribute('title');
    if (title && title.length > 0 && title.length < 80) return title.trim();

    return '';
}

/**
 * Tries to "validate" if a Playwright locator would likely be unique without running Playwright.
 * This is a heuristic based on DOM traversal and accessible properties.
 * It's not 100% accurate but much better than just checking a single attribute.
 * @param {Element} targetElement - The element we expect to be unique.
 * @param {string} method - The Playwright method (e.g., 'getByRole', 'getByText').
 * @param {string} value - The primary value for the locator.
 * @param {Object} [options={}] - Additional options like name, exact, etc.
 * @returns {boolean} - True if we believe the locator would be unique for the targetElement.
 */
function validatePlaywrightLocatorUniqueness(targetElement, method, value, options = {}) {
    let candidates = [];
    const exactMatch = options.exact === true;

    try {
        const allElements = Array.from(document.querySelectorAll('*'));

        candidates = allElements.filter(el => {
            // Always ignore elements that are not visible or are script/style
            if (el.offsetParent === null || el.hidden || el.tagName.toLowerCase() === 'script' || el.tagName.toLowerCase() === 'style') {
                return false;
            }

            if (method === 'getByRole') {
                const desiredRole = value;
                const actualRole = el.getAttribute('role') || getImplicitRole(el);
                if (actualRole !== desiredRole) return false;

                if (options.name !== undefined) { // Check if name option is provided
                    const accessibleName = getAccessibleName(el);
                    const nameMatches = exactMatch 
                        ? accessibleName === options.name 
                        : accessibleName.includes(options.name);
                    return nameMatches;
                }
                return true; // No name option provided, all elements with this role are candidates
            } else if (method === 'getByText') {
                const text = getAccessibleName(el); // Use accessible name for text as well for consistency
                if (!text) return false;
                return exactMatch ? text === value : text.includes(value);
            } else if (method === 'getByLabel') {
                const label = getAccessibleName(el); // getAccessibleName covers label for/aria-label
                if (!label) return false;
                return exactMatch ? label === value : label.includes(value);
            } else if (method === 'getByPlaceholder') {
                const placeholderText = el.getAttribute('placeholder');
                if (!placeholderText) return false;
                return exactMatch ? placeholderText === value : placeholderText.includes(value);
            } else if (method === 'getByAltText') {
                if (el.tagName.toLowerCase() !== 'img') return false;
                const altText = el.getAttribute('alt');
                if (!altText) return false;
                return exactMatch ? altText === value : altText.includes(value);
            } else if (method === 'getByTitle') {
                const titleText = el.getAttribute('title');
                if (!titleText) return false;
                return exactMatch ? titleText === value : titleText.includes(value);
            } else if (method === 'getByTestId') {
                const testId = el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-test');
                return testId === value;
            }
            return false; // Unknown method
        });
        
        return candidates.length === 1 && candidates[0] === targetElement;

    } catch (e) {
        console.warn(`Error validating Playwright locator (${method}, ${value}):`, e);
        return false;
    }
}

/**
 * Generates a unique CSS selector path for an element.
 * Prioritizes ID, then a combination of tag, classes, and nth-of-type for uniqueness.
 * @param {Element} element - The target element.
 * @returns {string} - A CSS selector path.
 */
function generateCSSPath(element) {
    if (!element || element.nodeType !== 1) return '';

    // If element has a unique ID, use it and stop. This is the strongest CSS selector.
    if (element.id) {
        const idSelector = `#${CSS.escape(element.id)}`;
        if (document.querySelectorAll(idSelector).length === 1) {
            return idSelector;
        }
    }

    const path = [];
    let current = element;

    while (current && current !== document.body && current.nodeType === 1) {
        let selector = current.tagName.toLowerCase();

        // Try to use a unique ID first if not already handled
        if (current.id) {
             const idSelector = `#${CSS.escape(current.id)}`;
             if (document.querySelectorAll(idSelector).length === 1) {
                 path.unshift(idSelector);
                 break; // Found a unique ID for this ancestor, path is complete
             }
        }

        const classes = Array.from(current.classList).filter(cls => cls.length > 0);
        if (classes.length > 0) {
            selector += classes.map(cls => `.${CSS.escape(cls)}`).join('');
        }

        // Check for uniqueness among siblings using the current selector (tag + classes)
        // If not unique, add :nth-of-type
        const parent = current.parentNode;
        if (parent) {
            const siblingsMatchingSelector = Array.from(parent.children).filter(child => {
                let tempSelector = child.tagName.toLowerCase();
                const tempClasses = Array.from(child.classList).filter(cls => cls.length > 0);
                if (tempClasses.length > 0) {
                    tempSelector += tempClasses.map(cls => `.${CSS.escape(cls)}`).join('');
                }
                return tempSelector === selector;
            });

            if (siblingsMatchingSelector.length > 1) {
                // Find the index of the current element among siblings that match the current selector
                const index = siblingsMatchingSelector.indexOf(current) + 1;
                if (index > 0) {
                    selector += `:nth-of-type(${index})`;
                }
            }
        }
        
        path.unshift(selector);
        current = current.parentElement;
    }
    
    // If we stopped at document.body or current is null, ensure path is not empty and try to prepend body/html if appropriate
    if (current === document.body && path.length > 0 && path[0] !== 'body') {
        path.unshift('body');
    } else if (current === document.documentElement && path.length > 0 && path[0] !== 'html') {
         path.unshift('html');
    }

    return path.join(' > ');
}

/**
 * The main function to generate the best, unique locator for an element.
 * Prioritizes Playwright's semantic locators, then data-test attributes, then chained locators,
 * and finally falls back to CSS selectors.
 * @param {Element} element - The clicked element.
 * @param {string} framework - 'pytest' or 'js'.
 * @returns {string} - The final, best locator string.
 */
function generateBestLocator(element, framework) {
    const isPytest = framework === 'pytest';
    const escapeStr = (str) => str.replace(/"/g, '\\"');
    
    // Helper function to format locator string based on framework
    const formatLocator = (method, value, options = null) => {
        const methodName = isPytest ? 
            method.replace(/([A-Z])/g, '_$1').toLowerCase() : 
            method;
        
        let optionsStr = '';
        if (options) {
            if (isPytest) {
                optionsStr = Object.entries(options).map(([k, v]) => {
                    if (k === 'name') return `name="${escapeStr(v)}"`;
                    if (k === 'hasText') return `has_text="${escapeStr(v)}"`; // Playwright Python uses has_text
                    if (k === 'exact') return `exact=${v}`;
                    return `${k}="${escapeStr(v)}"`; // For other string options
                }).join(', ');
            } else { // JavaScript
                optionsStr = Object.entries(options).map(([k, v]) => {
                    if (typeof v === 'boolean') return `${k}: ${v}`;
                    return `${k}: "${escapeStr(v)}"`;
                }).join(', ');
            }
        }

        const formattedValue = `"${escapeStr(value)}"`;
        if (optionsStr) {
            return `page.${methodName}(${formattedValue}, ${optionsStr})`;
        }
        return `page.${methodName}(${formattedValue})`;
    };

    // Helper to format locator for chained calls (removes "page." from child part)
    const formatChainedLocator = (parentLocatorPart, childLocatorPart) => {
        const cleanChild = childLocatorPart.startsWith('page.') ? childLocatorPart.substring(5) : childLocatorPart;
        // If the child locator is already a simple CSS selector, it can be passed directly to .locator()
        if (cleanChild.startsWith('locator("') && cleanChild.endsWith('")')) {
            return `${parentLocatorPart}.${cleanChild}`;
        }
        // For getBy* methods, we need to adapt them to be relative
        const byMethodMatch = cleanChild.match(/^(getBy[A-Z][a-zA-Z]*)\("(.+?)"(?:, (.+))?\)$/);
        if (byMethodMatch) {
            const method = byMethodMatch[1];
            const value = escapeStr(byMethodMatch[2].replace(/\\"/g, '"')); // Unescape value for re-escaping
            const options = byMethodMatch[3] ? JSON.parse(`{${byMethodMatch[3].replace(/(\w+):\s*(true|false|"\w+")/g, '"$1":$2')}}`) : null;
            
            // Reformat options for relative context
            let relativeOptionsStr = '';
            if (options) {
                if (isPytest) {
                    relativeOptionsStr = Object.entries(options).map(([k, v]) => {
                        if (k === 'name') return `name="${escapeStr(v)}"`;
                        if (k === 'hasText') return `has_text="${escapeStr(v)}"`;
                        if (k === 'exact') return `exact=${v}`;
                        return `${k}="${escapeStr(v)}"`;
                    }).join(', ');
                } else { // JavaScript
                    relativeOptionsStr = Object.entries(options).map(([k, v]) => {
                        if (typeof v === 'boolean') return `${k}: ${v}`;
                        return `${k}: "${escapeStr(v)}"`;
                    }).join(', ');
                }
            }
            
            const relativeMethod = isPytest ? method.replace(/([A-Z])/g, '_$1').toLowerCase() : method;
            
            if (relativeOptionsStr) {
                return `${parentLocatorPart}.${relativeMethod}(${formattedValue}, ${relativeOptionsStr})`;
            }
            return `${parentLocatorPart}.${relativeMethod}(${formattedValue})`;

        }
        return `${parentLocatorPart}.${cleanChild}`; // Fallback for other cases
    };

    // --- Strategy 1: Test ID (Highest priority for stability) ---
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-qa') || element.getAttribute('data-test');
    if (testId && validatePlaywrightLocatorUniqueness(element, 'getByTestId', testId)) {
        return formatLocator('getByTestId', testId);
    }

    // --- Strategy 2: By Role with unique Accessible Name (Highly semantic) ---
    const role = element.getAttribute('role') || getImplicitRole(element);
    const accessibleName = getAccessibleName(element);

    if (role) {
        if (accessibleName) {
            // Try exact match with name
            if (validatePlaywrightLocatorUniqueness(element, 'getByRole', role, { name: accessibleName, exact: true })) {
                return formatLocator('getByRole', role, { name: accessibleName, exact: true });
            }
            // Try partial match with name if exact fails
            if (validatePlaywrightLocatorUniqueness(element, 'getByRole', role, { name: accessibleName })) {
                return formatLocator('getByRole', role, { name: accessibleName });
            }
        }
        // If no accessible name, or name not unique, try by role alone if unique enough
        if (validatePlaywrightLocatorUniqueness(element, 'getByRole', role)) {
            return formatLocator('getByRole', role);
        }
    }

    // --- Strategy 3: By Label (for form elements) ---
    // Use accessibleName as it covers <label for> and aria-label
    // Exclude buttons/links as getByRole is usually preferred for them if name exists
    if (accessibleName && !['button', 'a'].includes(element.tagName.toLowerCase())) {
        if (validatePlaywrightLocatorUniqueness(element, 'getByLabel', accessibleName, { exact: true })) {
            return formatLocator('getByLabel', accessibleName, { exact: true });
        }
        if (validatePlaywrightLocatorUniqueness(element, 'getByLabel', accessibleName)) {
            return formatLocator('getByLabel', accessibleName);
        }
    }

    // --- Strategy 4: By Placeholder ---
    if (element.placeholder) {
        if (validatePlaywrightLocatorUniqueness(element, 'getByPlaceholder', element.placeholder, { exact: true })) {
            return formatLocator('getByPlaceholder', element.placeholder, { exact: true });
        }
        if (validatePlaywrightLocatorUniqueness(element, 'getByPlaceholder', element.placeholder)) {
            return formatLocator('getByPlaceholder', element.placeholder);
        }
    }

    // --- Strategy 5: By Alt Text (for images) ---
    if (element.tagName.toLowerCase() === 'img') {
        const altText = element.getAttribute('alt');
        if (altText) {
            if (validatePlaywrightLocatorUniqueness(element, 'getByAltText', altText, { exact: true })) {
                return formatLocator('getByAltText', altText, { exact: true });
            }
            if (validatePlaywrightLocatorUniqueness(element, 'getByAltText', altText)) {
                return formatLocator('getByAltText', altText);
            }
        }
    }

    // --- Strategy 6: By Title ---
    if (element.title && element.title.length > 0 && element.title.length < 80) {
        if (validatePlaywrightLocatorUniqueness(element, 'getByTitle', element.title, { exact: true })) {
            return formatLocator('getByTitle', element.title, { exact: true });
        }
        if (validatePlaywrightLocatorUniqueness(element, 'getByTitle', element.title)) {
            return formatLocator('getByTitle', element.title);
        }
    }
    
    // --- Strategy 7: By Text (using accessible name for robustness) ---
    const textContent = getAccessibleName(element); // Re-use accessible name for text content
    if (textContent && textContent.length > 0 && textContent.length < 80) { // Limit length to avoid full paragraphs
        if (validatePlaywrightLocatorUniqueness(element, 'getByText', textContent, { exact: true })) {
            return formatLocator('getByText', textContent, { exact: true });
        }
        // If exact text is not unique, we can try partial later as a fallback with a warning
    }

    // --- Strategy 8: Chained Locator Strategy (unique parent + relative child) ---
    // This is powerful for elements that are not unique on their own but have unique parents.
    let currentParent = element.parentElement;
    for (let i = 0; i < 3 && currentParent && currentParent !== document.body && currentParent !== document.documentElement; i++) { // Check up to 3 levels up
        let parentLocatorCandidate = null;
        
        // Try parent by Test ID
        const parentTestId = currentParent.getAttribute('data-testid') || currentParent.getAttribute('data-qa') || currentParent.getAttribute('data-test');
        if (parentTestId && validatePlaywrightLocatorUniqueness(currentParent, 'getByTestId', parentTestId)) {
            parentLocatorCandidate = formatLocator('getByTestId', parentTestId);
        } 
        
        // Try parent by unique ID
        if (!parentLocatorCandidate && currentParent.id && isSelectorUnique(`#${CSS.escape(currentParent.id)}`, currentParent)) {
            parentLocatorCandidate = `page.locator("#${CSS.escape(currentParent.id)}")`;
        }

        // Try parent by Role with Name
        if (!parentLocatorCandidate) {
            const parentRole = currentParent.getAttribute('role') || getImplicitRole(currentParent);
            const parentAccessibleName = getAccessibleName(currentParent);
            if (parentRole && parentAccessibleName) {
                if (validatePlaywrightLocatorUniqueness(currentParent, 'getByRole', parentRole, { name: parentAccessibleName, exact: true })) {
                    parentLocatorCandidate = formatLocator('getByRole', parentRole, { name: parentAccessibleName, exact: true });
                } else if (validatePlaywrightLocatorUniqueness(currentParent, 'getByRole', parentRole, { name: parentAccessibleName })) {
                    parentLocatorCandidate = formatLocator('getByRole', parentRole, { name: parentAccessibleName });
                }
            }
        }

        // Try parent by Text
        if (!parentLocatorCandidate) {
            const parentTextContent = getAccessibleName(currentParent);
            if (parentTextContent && parentTextContent.length > 0 && parentTextContent.length < 80) {
                if (validatePlaywrightLocatorUniqueness(currentParent, 'getByText', parentTextContent, { exact: true })) {
                    parentLocatorCandidate = formatLocator('getByText', parentTextContent, { exact: true });
                }
            }
        }
        
        // If a unique parent locator is found, try to find a relative child locator
        if (parentLocatorCandidate) {
            let childLocatorPart = null;

            // Priority for child:
            // 1. Child Test ID
            if (testId && currentParent.querySelector(`[data-testid="${CSS.escape(testId)}"]`) === element) {
                childLocatorPart = formatLocator('getByTestId', testId).replace('page.', '');
            }
            
            // 2. Child Role with Name
            if (!childLocatorPart && role && accessibleName) {
                const roleCandidatesInParent = Array.from(currentParent.querySelectorAll('*')).filter(el => {
                    const actualRole = el.getAttribute('role') || getImplicitRole(el);
                    if (actualRole !== role) return false;
                    const elAccessibleName = getAccessibleName(el);
                    return elAccessibleName === accessibleName && el === element; // Ensure it's the target element
                });
                if (roleCandidatesInParent.length === 1) { // It means this specific role + name combination is unique WITHIN THIS PARENT
                    childLocatorPart = formatLocator('getByRole', role, { name: accessibleName, exact: true }).replace('page.', '');
                }
            }

            // 3. Child Exact Text
            if (!childLocatorPart && textContent && textContent.length < 80) {
                const textCandidatesInParent = Array.from(currentParent.querySelectorAll('*')).filter(el => {
                    const elText = getAccessibleName(el);
                    return elText === textContent && el === element; // Ensure it's the target element
                });
                if (textCandidatesInParent.length === 1) { // Unique text WITHIN THIS PARENT
                    childLocatorPart = formatLocator('getByText', textContent, { exact: true }).replace('page.', '');
                }
            }

            // 4. Child CSS Selector (as last resort for child, relative to parent)
            if (!childLocatorPart) {
                // Generate a simple CSS selector for the child relative to its immediate parent
                let simpleChildCss = element.tagName.toLowerCase();
                if (element.id && currentParent.querySelector(`:scope > #${CSS.escape(element.id)}`) === element) {
                     simpleChildCss = `#${CSS.escape(element.id)}`;
                } else {
                    const elementClasses = Array.from(element.classList).filter(cls => cls.length > 0);
                    if (elementClasses.length > 0) {
                        simpleChildCss += elementClasses.map(cls => `.${CSS.escape(cls)}`).join('');
                    }
                    
                    const siblingsOfSameSelector = Array.from(currentParent.children).filter(child => {
                        let tempCss = child.tagName.toLowerCase();
                        const tempClasses = Array.from(child.classList).filter(cls => cls.length > 0);
                        if (tempClasses.length > 0) {
                            tempCss += tempClasses.map(cls => `.${CSS.escape(cls)}`).join('');
                        }
                        return tempCss === simpleChildCss;
                    });

                    if (siblingsOfSameSelector.length > 1) {
                        // Find position among similar direct children
                        const indexInSiblings = Array.from(currentParent.children).filter(child => child.tagName === element.tagName).indexOf(element) + 1;
                        if (indexInSiblings > 0) {
                             simpleChildCss = `${element.tagName.toLowerCase()}:nth-of-type(${indexInSiblings})`;
                        }
                    }
                }
                
                // Validate if this simple CSS is unique within the parent
                if (currentParent.querySelector(`:scope > ${simpleChildCss}`) === element) {
                     childLocatorPart = `locator("${simpleChildCss}")`;
                }
            }
            
            if (childLocatorPart) {
                return formatChainedLocator(parentLocatorCandidate, childLocatorPart);
            }
        }
        currentParent = currentParent.parentElement;
    }

    // --- Fallback Strategies (will include warnings if not ideal) ---

    // 9. Generic ByText (if text content exists but isn't unique enough for exact match)
    if (textContent && textContent.length > 0 && textContent.length < 80) {
        const locator = formatLocator('getByText', textContent);
        const comment = isPytest ? 
            "# WARNING: This getByText locator might not be unique. Consider adding exact=True or a more specific locator if possible." : 
            "// WARNING: This getByText locator might not be unique. Consider adding exact: true or a more specific locator if possible.";
        return `${locator} ${comment}`;
    }

    // 10. CSS Selector (Last resort if no semantic or chained locator is unique)
    const cssSelector = generateCSSPath(element);
    if (cssSelector) {
        const locator = `page.locator("${cssSelector}")`;
        const comment = isPytest ? 
            "# WARNING: Generic CSS selector. Prefer semantic locators (getByRole, getByText, etc.) or data-test attributes." : 
            "// WARNING: Generic CSS selector. Prefer semantic locators (getByRole, getByText, etc.) or data-test attributes.";
        return `${locator} ${comment}`;
    }
    
    // 11. Absolute final fallback: Tag name with a strong warning
    const tagName = element.tagName.toLowerCase();
    const comment = isPytest ? 
        "# CRITICAL WARNING: Very generic locator (tag name only). This is highly unstable. Find a more specific attribute!" : 
        "// CRITICAL WARNING: Very generic locator (tag name only). This is highly unstable. Find a more specific attribute!";
    return `page.locator("${tagName}") ${comment}`;
}

// --- Event Handlers and DOM manipulation (unchanged as they relate to UI interaction and message passing) ---

/**
 * Handles the click event when picking mode is active.
 * Generates and displays the best locator for the clicked element.
 * @param {MouseEvent} event - The click event.
 */
function handlePageClick(event) {
    if (!isPickingMode) return;

    event.preventDefault(); // Prevent default browser action (e.g., navigating links)
    event.stopPropagation(); // Stop propagation to prevent parent elements from also being clicked

    const element = event.target;
    const generatedLocator = generateBestLocator(element, currentFramework);

    displayLocatorOnPage(generatedLocator);

    // Send message to background script or popup
    chrome.runtime.sendMessage({
        action: "elementPickedAndGenerated",
        locator: generatedLocator
    });

    disablePickingMode(); // Disable picking mode after an element is picked
}

/**
 * Enables the locator picking mode.
 * @param {string} framework - The framework ('pytest' or 'js') for locator generation.
 */
function enablePickingMode(framework) {
    if (isPickingMode) return; // Prevent re-enabling if already active
    isPickingMode = true;
    currentFramework = framework;
    document.addEventListener('click', handlePageClick, true); // Use capture phase for earlier interception
    document.body.style.cursor = 'crosshair'; // Change cursor to indicate picking mode
    hideLocatorDisplay(); // Hide any previously displayed locator
}

/**
 * Disables the locator picking mode.
 */
function disablePickingMode() {
    if (!isPickingMode) return; // Prevent disabling if already inactive
    isPickingMode = false;
    document.removeEventListener('click', handlePageClick, true);
    document.body.style.cursor = 'default'; // Restore default cursor
}

/**
 * Displays the generated locator in a floating div on the page.
 * @param {string} locator - The generated locator string.
 */
function displayLocatorOnPage(locator) {
    hideLocatorDisplay(); // Ensure only one display div is active at a time
    locatorDisplayDiv = document.createElement('div');
    locatorDisplayDiv.style.cssText = `
        position: fixed; top: 10px; left: 10px; background-color: #282c34;
        color: #61dafb; padding: 12px 18px; border-radius: 8px;
        font-family: 'Fira Code', 'Courier New', monospace; font-size: 14px;
        z-index: 2147483647; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        display: flex; align-items: center; gap: 15px; max-width: 600px;
        white-space: pre-wrap; word-break: break-word; /* Allow long locators to wrap */
    `;
    
    const locatorText = document.createElement('code');
    locatorText.textContent = locator;
    locatorText.style.cssText = 'user-select: all; flex: 1;'; // flex: 1 allows text to take available space

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.style.cssText = `
        background-color: #0065ff; color: white; border: none; padding: 6px 10px;
        border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap;
        transition: background-color 0.2s ease;
    `;
    copyButton.onmouseover = () => copyButton.style.backgroundColor = '#0052cc';
    copyButton.onmouseout = () => copyButton.style.backgroundColor = '#0065ff';
    copyButton.onclick = () => {
        navigator.clipboard.writeText(locator).then(() => {
            copyButton.textContent = 'Copied!';
            copyButton.style.backgroundColor = '#28a745'; // Green on copy
            setTimeout(() => { 
                copyButton.textContent = 'Copy'; 
                copyButton.style.backgroundColor = '#0065ff'; // Restore original color
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy locator: ', err);
            copyButton.textContent = 'Error!';
            copyButton.style.backgroundColor = '#dc3545'; // Red on error
            setTimeout(() => { 
                copyButton.textContent = 'Copy'; 
                copyButton.style.backgroundColor = '#0065ff';
            }, 1500);
        });
    };
    
    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.cssText = `
        position: absolute; top: 5px; right: 5px; background: none; border: none;
        color: #bbb; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 5px;
        transition: color 0.2s ease;
    `;
    closeButton.onmouseover = () => closeButton.style.color = '#fff';
    closeButton.onmouseout = () => closeButton.style.color = '#bbb';
    closeButton.onclick = hideLocatorDisplay;
    
    locatorDisplayDiv.appendChild(locatorText);
    locatorDisplayDiv.appendChild(copyButton);
    locatorDisplayDiv.appendChild(closeButton);
    document.body.appendChild(locatorDisplayDiv);
}

/**
 * Hides the locator display div if it exists.
 */
function hideLocatorDisplay() {
    if (locatorDisplayDiv) {
        locatorDisplayDiv.remove();
        locatorDisplayDiv = null;
    }
}

// Listener for messages from the extension's background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "togglePickingMode") {
        if (isPickingMode) {
            disablePickingMode();
            sendResponse({ status: "disabled" });
        } else {
            enablePickingMode(request.framework);
            sendResponse({ status: "enabled" });
        }
        return true; // Indicates that the response will be sent asynchronously
    }
});

// Initialize by ensuring picking mode is off and display is hidden when content script loads
disablePickingMode();
hideLocatorDisplay();