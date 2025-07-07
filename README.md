# Playwright Locator Assistant


The ultimate browser extension for generating and verifying stable Playwright locators on the fly. This tool is designed for QA engineers and developers who want to write more resilient and readable tests, faster.

---

## Why This Extension?

In modern web development, writing stable end-to-end tests is a challenge. CSS selectors are brittle, and manually crafting the perfect Playwright locator can be time-consuming. This extension solves that problem by embedding Playwright's best practices directly into your browser.

It follows the official locator priority, ensuring you always get the most resilient locator possible, preferring user-facing attributes over implementation details.

## ✨ Features

*   **🚀 Intelligent Locator Generation:** Click on any element, and the extension automatically generates the best possible locator based on Playwright's recommended priority:
    1.  `data-testid`
    2.  `getByRole` (with accessible name)
    3.  `getByText`, `getByLabel`, `getByPlaceholder`, etc.
    4.  Smart `getByRole` (when unique without a name)
    5.  `CSS` selector as a last resort (with a warning).

*   **🔗 Smart Locator Chaining:** For elements that aren't unique on their own, the extension finds a stable parent and creates a readable and robust chained locator (e.g., `page.getByRole('list').getByRole('listitem', { name: 'User 1' })`).

*   **✅ Instant Locator Verifier:** Manually write and test a locator directly in the popup. The verifier understands **both CSS and Playwright syntax** (`getByRole`, `getByText`, etc.) and instantly highlights all matching elements on the page, showing you a live count.

*   **🐍 Pytest & JS Support:** Toggle between Python (`pytest`) and JavaScript (`playwright-test`) syntax for the generated locators.

*   **💡 Lightweight & Fast:** Built with performance in mind to not slow down your browsing or debugging sessions.


## 🛠️ How to Use

1.  **Install the Extension:**
    *  

2.  **To Generate a Locator:**
    *   Click the extension icon in your browser toolbar.
    *   Select your desired framework (Pytest or JS).
    *   Click the "Pick Element" button.
    *   The popup will close. Click on any element on the web page.
    *   A notification will appear with the best locator, which is also copied to your popup.

3.  **To Verify a Locator:**
    *   Click the extension icon.
    *   In the "Verify Selector" section, type any CSS selector or Playwright locator (e.g., `getByRole('button')`).
    *   Click the "Check Selector" button.
    *   The matching elements will be highlighted on the page, and the count will be displayed in the popup.

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features, find a bug, or want to improve the code, feel free to open an issue or submit a pull request.

## 📄 License

This project is licensed under the MIT License.
