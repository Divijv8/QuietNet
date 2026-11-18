# QuietNet

A lightweight Chrome extension that tracks the time you spend on websites and displays it in a clean, simple dashboard — so you can see where your browsing time actually goes.

## Features

- Automatically tracks active time spent on every website
- Displays a per-site time breakdown in the popup dashboard
- Persists data across sessions using Chrome's storage API
- Detects idle state to avoid counting inactive time
- Works silently in the background with no page modifications

## Project Structure

```
QuietNet/
├── background.js      # Service worker — tracks active tab and records time
├── popup.html         # Extension popup UI
├── popup.js           # Loads and renders time data in the popup
├── style.css          # Popup styles
├── manifest.json      # Chrome Extension Manifest V3 config
└── images/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Installation

Since this extension is not published on the Chrome Web Store, load it manually:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the `QuietNet` folder

The extension icon will appear in your toolbar. Click it to view your browsing time dashboard.

## Permissions Used

| Permission | Reason |
|---|---|
| `tabs` | Detect the currently active tab and its URL |
| `storage` | Persist time data across browser sessions |
| `idle` | Detect when the user is inactive to pause tracking |
| `history` | Access browsing context for accurate tracking |
| `<all_urls>` | Monitor time across all websites |

## Tech Stack

- Manifest V3 (Chrome Extension)
- Vanilla JavaScript
- HTML / CSS
