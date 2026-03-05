---
name: agent-browser
description: Use when interacting with web pages — testing UI, checking rendered output, filling forms, clicking buttons, taking screenshots, or any browser automation. Replaces Playwright MCP. Trigger when user asks to open a page, verify UI, test frontend, take screenshots, or automate browser actions.
---

# agent-browser — Browser Automation via CLI

Use `agent-browser` (installed globally) instead of Playwright MCP for all browser interactions.

## Project-Specific Setup

This project uses **HTTPS with self-signed certificates** on `https://localhost:3000`.
Always pass `--ignore-https-errors` when accessing local pages.

```bash
agent-browser --ignore-https-errors open https://localhost:3000
```

## Core Workflow

### 1. Navigate

```bash
agent-browser open <url>
agent-browser --ignore-https-errors open https://localhost:3000
```

### 2. Inspect (AI-friendly)

```bash
agent-browser snapshot              # Full accessibility tree with @refs
agent-browser snapshot -i           # Interactive elements only (buttons, inputs, links)
agent-browser snapshot -c           # Compact (remove empty structural nodes)
agent-browser snapshot -s ".sidebar" # Scope to CSS selector
```

### 3. Interact

```bash
agent-browser click @e5             # Click by snapshot ref
agent-browser fill @e3 "hello"      # Clear + type into input
agent-browser type @e3 "append"     # Append text (no clear)
agent-browser press Enter            # Press key
agent-browser select @e4 "option1"  # Select dropdown
agent-browser check @e6             # Check checkbox
agent-browser scroll down 300       # Scroll
agent-browser hover @e2             # Hover
```

### 4. Screenshot

```bash
agent-browser screenshot            # Viewport screenshot (stdout path)
agent-browser screenshot page.png   # Save to file
agent-browser screenshot --full     # Full page
agent-browser screenshot --annotate # Numbered labels + legend (for vision)
```

### 5. Extract Data

```bash
agent-browser get text @e1          # Text content of element
agent-browser get html @e1          # Inner HTML
agent-browser get value @e1         # Input value
agent-browser get url               # Current URL
agent-browser get title             # Page title
agent-browser get count ".item"     # Count matching elements
agent-browser get box @e1           # Bounding box {x,y,w,h}
```

### 6. Check State

```bash
agent-browser is visible @e1
agent-browser is enabled @e1
agent-browser is checked @e1
```

### 7. Wait

```bash
agent-browser wait @e1              # Wait for element to appear
agent-browser wait 2000             # Wait 2 seconds
agent-browser wait --load networkidle  # Wait for network idle
```

### 8. Find + Act (semantic locators)

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Login" click
agent-browser find placeholder "Email" fill "user@example.com"
agent-browser find testid "save-btn" click
```

### 9. JavaScript Eval

```bash
agent-browser eval "document.title"
agent-browser eval "localStorage.getItem('token')"
```

### 10. Diff (regression detection)

```bash
agent-browser diff snapshot           # Compare current vs last snapshot
agent-browser diff screenshot --baseline  # Visual diff
```

## Command Chaining

Commands can be chained with `&&` (browser persists via daemon):

```bash
agent-browser --ignore-https-errors open https://localhost:3000 && \
  agent-browser wait --load networkidle && \
  agent-browser snapshot -i
```

## Auth Flow Example

```bash
# Login to the app
agent-browser --ignore-https-errors open https://localhost:3000 && \
  agent-browser wait --load networkidle && \
  agent-browser snapshot -i
# Then use @refs from snapshot output:
agent-browser fill @e1 "user@example.com" && \
  agent-browser fill @e2 "password" && \
  agent-browser click @e3
```

## Session Management

```bash
agent-browser session               # Show current session
agent-browser session list          # List active sessions
agent-browser close                 # Close browser
```

## Tabs

```bash
agent-browser tab list              # List open tabs
agent-browser tab new               # New tab
agent-browser tab 2                 # Switch to tab 2
agent-browser tab close             # Close current tab
```

## Network Inspection

```bash
agent-browser network requests                    # View requests
agent-browser network requests --filter "/api/"   # Filter by pattern
agent-browser network route "/api/slow" --abort   # Block requests
```

## Console & Errors

```bash
agent-browser console               # View console logs
agent-browser errors                 # View page errors
```

## Key Flags

| Flag | Purpose |
|------|---------|
| `--ignore-https-errors` | Skip cert validation (required for local HTTPS) |
| `--headed` | Show browser window (visible mode) |
| `--full` / `-f` | Full page screenshot |
| `--annotate` | Labeled screenshot with numbered legend |
| `--json` | JSON output |
| `-i` | Interactive elements only (snapshot) |
| `-c` | Compact snapshot |
| `-s <sel>` | Scope snapshot to CSS selector |
| `-d <n>` | Limit snapshot tree depth |
| `--session <name>` | Isolated browser session |
| `--profile <path>` | Persistent browser profile |

## Rules

- **Always use `--ignore-https-errors`** when accessing `https://localhost:3000`
- Prefer `snapshot -i` over full snapshot for faster, focused output
- Use `@ref` notation from snapshot output for reliable element targeting
- Chain commands with `&&` for multi-step flows
- Use `wait --load networkidle` after navigation for SPAs
- Close browser with `agent-browser close` when done
