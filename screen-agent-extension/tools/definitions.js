/**
 * CDP-backed browser tool definitions and execution engine.
 *
 * Same tool names as Playwright MCP (browser_snapshot, browser_click, etc.)
 * but powered by chrome.debugger → CDP commands:
 *   Accessibility.getFullAXTree → snapshot
 *   Accessibility.queryAXTree → locate by ref
 *   DOM.getBoxModel → element bounding box
 *   Input.dispatchMouseEvent → click/hover at box center
 *   Input.insertText → type text
 *   Input.dispatchKeyEvent → press keys
 *   Page.navigate / navigateToHistoryEntry / captureScreenshot / enable
 *   Runtime.evaluate → JS execution
 *   Network.enable → buffered request tracking
 *   Log.enable → buffered console message tracking
 *
 * Architecture:
 *   background.js attaches chrome.debugger to the active tab, enables CDP
 *   domains, and collects buffered events. It calls executeCdpTool() here
 *   for every browser tool invocation.
 *
 * Re-exports executeFileTool from files.js (local file I/O).
 */

import { executeFileTool } from "./files.js";

// ── Module-level state (cleared per turn by background.js) ────────────────

/** Buffered console messages from Runtime.consoleAPICalled + Log.entryAdded */
let bufferedConsoleMessages = [];

/** Buffered network requests from Network.requestWillBeSent */
let bufferedNetworkRequests = [];

// ── Input Sanitization ────────────────────────────────────────────────────

/**
 * Sanitize a numeric value from the LLM.
 *
 * LLMs (especially qwen) sometimes send numbers as strings with commas
 * (e.g. "226,207") or other garbage. Extracts the first valid numeric
 * segment before any comma.
 *
 * @param {*} val - The raw value from the LLM's tool call arguments
 * @returns {number} The sanitized number, or NaN if irrecoverable
 */
export function toNumber(val) {
  if (typeof val === "number") {
    return Math.floor(val);
  }
  if (typeof val === "string") {
    const cleaned = val.split(",")[0].trim();
    const n = parseInt(cleaned, 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// ── Re-exports ────────────────────────────────────────────────────────────

export { executeFileTool };

// ── Buffer API (called by background.js) ──────────────────────────────────

/**
 * Clear all buffered CDP events at the start of a new turn.
 * Called by background.js when attaching the debugger.
 */
export function clearBufferedEvents() {
  bufferedConsoleMessages = [];
  bufferedNetworkRequests = [];
}

/**
 * Push a console message into the buffer.
 * Called from chrome.debugger.onEvent in background.js.
 *
 * @param {object} msg - CDP Runtime.consoleAPICalled or Log.entryAdded event
 */
export function pushConsoleMessage(msg) {
  // Cap the buffer to avoid unbounded growth
  if (bufferedConsoleMessages.length > 200) bufferedConsoleMessages.shift();
  bufferedConsoleMessages.push(msg);
}

/**
 * Push a network request into the buffer.
 * Called from chrome.debugger.onEvent in background.js.
 *
 * @param {object} req - CDP Network.requestWillBeSent event
 */
export function pushNetworkRequest(req) {
  // Cap the buffer to avoid unbounded growth
  if (bufferedNetworkRequests.length > 500) bufferedNetworkRequests.shift();
  bufferedNetworkRequests.push(req);
}

// ── CDP Tool Definitions (OpenAI function-calling format) ─────────────────

/**
 * Get the complete set of CDP-backed browser tool definitions.
 *
 * These match the Playwright MCP tool names so the Settings UI labels
 * and enabled-tools lists remain unchanged.
 *
 * @returns {object[]} OpenAI-formatted tool definitions for browser tools
 */
export function getCdpToolDefinitions() {
  return [
    // ── Observation ───────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_snapshot",
        description:
          "Capture accessibility snapshot of the current page. " +
          "Use this at the start of every turn to see what's on screen. " +
          "Returns an accessibility tree with ref=backendDOMNodeId identifiers " +
          "that can be used with browser_click, browser_type, browser_hover, etc.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_take_screenshot",
        description:
          "Take a JPEG screenshot of the current page (quality 50). " +
          "Returns a base64-encoded image. Prefer browser_snapshot for " +
          "understanding page structure — use this only when visual inspection is required.",
        parameters: {
          type: "object",
          properties: {
            element: {
              type: "string",
              description: "Human-readable description of the element to screenshot. Omit for full page.",
            },
            ref: {
              type: "string",
              description: "Accessibility ref to screenshot a specific element (e.g. '42'). Omit for full page.",
            },
          },
        },
      },
    },

    // ── Navigation ────────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_navigate",
        description:
          "Navigate to a URL. Use this to go to a new page. " +
          "After navigating, call browser_snapshot to see the new page state.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The full URL to navigate to." },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "browser_navigate_back",
        description:
          "Go back to the previous page. Use this after navigating somewhere " +
          "and wanting to return.",
        parameters: { type: "object", properties: {} },
      },
    },

    // ── Interaction: Click ────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_click",
        description:
          "Click on an element identified by its 'ref' from the accessibility snapshot. " +
          "Always use the 'ref' parameter — it's the backendDOMNodeId shown as [ref=N] " +
          "in the browser_snapshot output. The click happens at the element's center.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "The ref identifier from browser_snapshot (e.g. '42'). Required.",
            },
            element: {
              type: "string",
              description: "Human-readable description of the element being clicked (for logging).",
            },
            doubleClick: {
              type: "boolean",
              description: "Set to true for a double-click. Default is false (single click).",
            },
            button: {
              type: "string",
              enum: ["left", "right", "middle"],
              description: "Mouse button to click with. Default is 'left'.",
            },
          },
          required: ["ref", "element"],
        },
      },
    },

    // ── Interaction: Type ─────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_type",
        description:
          "Type text into an input element identified by its 'ref'. " +
          "First focuses the element, then inserts the text. " +
          "Use browser_snapshot to find the ref first.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "The ref identifier of the input element from browser_snapshot (e.g. '42'). Required.",
            },
            text: {
              type: "string",
              description: "The text to type into the input.",
            },
            submit: {
              type: "boolean",
              description: "Whether to press Enter after typing. Default is false.",
            },
            element: {
              type: "string",
              description: "Human-readable description of the element (for logging).",
            },
          },
          required: ["ref", "text", "element"],
        },
      },
    },

    // ── Interaction: Press Key ────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_press_key",
        description:
          "Press a key or key combination. Use this for keyboard shortcuts, " +
          "Enter, Escape, Tab, arrow keys, etc.",
        parameters: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Key name (e.g., 'Enter', 'Escape', 'Tab', 'ArrowDown', 'Control+a', 'Alt+F4').",
            },
          },
          required: ["key"],
        },
      },
    },

    // ── Interaction: Hover ────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_hover",
        description:
          "Hover over an element identified by its 'ref'. " +
          "Use this to trigger hover effects like dropdowns, tooltips, or menus.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "The ref identifier from browser_snapshot (e.g. '42'). Required.",
            },
            element: {
              type: "string",
              description: "Human-readable description of the element (for logging).",
            },
          },
          required: ["ref", "element"],
        },
      },
    },

    // ── Interaction: Drag ─────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_drag",
        description:
          "Drag an element from one ref to another. Use this for " +
          "drag-and-drop operations like moving items or rearranging lists.",
        parameters: {
          type: "object",
          properties: {
            fromRef: {
              type: "string",
              description: "The ref of the element to drag. Required.",
            },
            toRef: {
              type: "string",
              description: "The ref of the drop target. Required.",
            },
            fromElement: {
              type: "string",
              description: "Human description of the dragged element (for logging).",
            },
            toElement: {
              type: "string",
              description: "Human description of the drop target (for logging).",
            },
          },
          required: ["fromRef", "toRef", "fromElement", "toElement"],
        },
      },
    },

    // ── Wait ──────────────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_wait_for",
        description:
          "Wait for a specified amount of time (in milliseconds), then " +
          "re-capture the page snapshot. Use this when a page needs time to " +
          "load content after an interaction.",
        parameters: {
          type: "object",
          properties: {
            time: {
              type: "number",
              description: "Time to wait in milliseconds (e.g. 1000 for 1 second).",
            },
          },
          required: ["time"],
        },
      },
    },

    // ── Evaluate JS ───────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_evaluate",
        description:
          "Evaluate JavaScript in the page context. " +
          "Use for reading page state, extracting data, or manipulating the DOM. " +
          "The expression runs in the page's JavaScript context and can access document/window. " +
          "Returns the JSON-serialized result. " +
          "Prefer browser_snapshot for understanding page structure — use this only " +
          "when you need specific data from the page's JavaScript.",
        parameters: {
          type: "object",
          properties: {
            function: {
              type: "string",
              description: "JavaScript expression to evaluate (e.g. 'document.title', 'window.location.href').",
            },
            ref: {
              type: "string",
              description: "Optional: ref of an element to pass as the 'element' variable in the expression.",
            },
          },
          required: ["function"],
        },
      },
    },

    // ── Console Messages (buffered) ───────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_console_messages",
        description:
          "Retrieve console messages logged by the page since the last snapshot. " +
          "Use this to detect JavaScript errors, debug output, or warnings. " +
          "Returns up to 200 most recent console.log/error/warn/info entries.",
        parameters: { type: "object", properties: {} },
      },
    },

    // ── Network Requests (buffered) ───────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_network_requests",
        description:
          "Retrieve network requests made by the page since the last snapshot. " +
          "Use this to check what API calls or assets the page loaded. " +
          "Returns up to 500 most recent requests with URL, method, and type.",
        parameters: { type: "object", properties: {} },
      },
    },

    // ── Dialog handling ───────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_handle_dialog",
        description:
          "Handle a JavaScript dialog (alert, confirm, prompt) on the page. " +
          "Use this after clicking something that triggers a dialog.",
        parameters: {
          type: "object",
          properties: {
            accept: {
              type: "boolean",
              description: "Whether to accept (true) or dismiss (false) the dialog.",
            },
            promptText: {
              type: "string",
              description: "Text to enter if the dialog is a prompt. Ignored for alerts and confirms.",
            },
          },
          required: ["accept"],
        },
      },
    },

    // ── Select option ─────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_select_option",
        description:
          "Select an option in a <select> dropdown by its label or value. " +
          "Use this for setting dropdown/select inputs. Identify by ref from snapshot.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "The ref of the <select> element. Required.",
            },
            element: {
              type: "string",
              description: "Human-readable description of the select (for logging).",
            },
            values: {
              type: "array",
              items: { type: "string" },
              description: "Array of option values or labels to select.",
            },
          },
          required: ["ref", "values", "element"],
        },
      },
    },

    // ── File upload ───────────────────────────────────────────────────
    {
      type: "function",
      function: {
        name: "browser_file_upload",
        description:
          "Upload a file via a file input. Identify the input by ref from snapshot.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "The ref of the file input. Required.",
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Array of absolute file paths to upload.",
            },
          },
          required: ["ref", "paths"],
        },
      },
    },
  ];
}

// ── Accessibility Tree Formatting ─────────────────────────────────────────

/**
 * Walk the CDP Accessibility.getFullAXTree result and produce a
 * Playwright-compatible text representation.
 *
 * Format: "- role \"name\" [ref=backendDOMNodeId]"
 * Indentation indicates nesting depth.
 * Root node is skipped (it's always "RootWebArea" and clutters output).
 *
 * @param {object[]} axNodes - CDP AXNode array from Accessibility.getFullAXTree
 * @returns {string} Formatted accessibility tree text
 */
export function formatAXTree(axNodes) {
  if (!axNodes || axNodes.length === 0) return "(empty accessibility tree)";

  // Build a map: nodeId → node for quick lookup
  const nodeMap = new Map();
  for (const node of axNodes) {
    nodeMap.set(node.nodeId, node);
  }

  /** Recursive formatter */
  function formatNode(node, depth) {
    let lines = [];

    // Build the text representation
    const role = (node.role?.value || "unknown").toLowerCase();
    const name = node.name?.value || "";
    const ref = node.backendDOMNodeId;

    if (ref !== undefined && ref !== null) {
      const displayName = name ? `"${name.replace(/"/g, '\\"')}"` : "";
      const prefix = "  ".repeat(depth);
      if (displayName) {
        lines.push(`${prefix}- ${role} ${displayName} [ref=${ref}]`);
      } else {
        lines.push(`${prefix}- ${role} [ref=${ref}]`);
      }
    } else {
      const displayName = name ? `"${name.replace(/"/g, '\\"')}"` : "";
      const prefix = "  ".repeat(depth);
      if (displayName) {
        lines.push(`${prefix}- ${role} ${displayName}`);
      } else {
        lines.push(`${prefix}- ${role}`);
      }
    }

    // Walk children
    if (node.childIds && node.childIds.length > 0) {
      for (const childId of node.childIds) {
        const child = nodeMap.get(childId);
        if (child) {
          lines = lines.concat(formatNode(child, depth + 1));
        }
      }
    }

    return lines;
  }

  // Find root node (nodeId 0 or first node without a parent)
  const rootNode = nodeMap.get(0) || axNodes[0];

  // Skip "RootWebArea" — start from its children
  if (rootNode && rootNode.childIds && rootNode.childIds.length > 0) {
    let result = [];
    for (const childId of rootNode.childIds) {
      const child = nodeMap.get(childId);
      if (child) {
        result = result.concat(formatNode(child, 0));
      }
    }
    return result.join("\n");
  }

  // Fallback — render the whole tree
  return formatNode(rootNode, 0).join("\n");
}

// ── Element Resolution (ref → center coordinates) ─────────────────────────

/**
 * Get the center coordinates (x, y) of a DOM element by its backendNodeId.
 *
 * Uses DOM.getBoxModel to get the element's bounding box, then computes center.
 * Falls back to Content Quads if box model is unavailable.
 *
 * @param {object} debuggee - CDP debuggee { tabId }
 * @param {number} backendNodeId - The DOM backend node ID
 * @returns {Promise<{x: number, y: number}>} Center coordinates
 */
async function getElementCenter(debuggee, backendNodeId) {
  // Try box model first
  let boxModel;
  try {
    const result = await chrome.debugger.sendCommand(debuggee, "DOM.getBoxModel", {
      backendNodeId,
    });
    boxModel = result?.model;
  } catch {
    // Box model may fail for non-visible elements
  }

  if (boxModel?.content) {
    // content is an array of 8 numbers: [x1,y1, x2,y2, x3,y3, x4,y4]
    // We want the center of the bounding rectangle
    const xs = [boxModel.content[0], boxModel.content[2], boxModel.content[4], boxModel.content[6]];
    const ys = [boxModel.content[1], boxModel.content[3], boxModel.content[5], boxModel.content[7]];

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: Math.round((minX + maxX) / 2),
      y: Math.round((minY + maxY) / 2),
    };
  }

  // Fallback: use content quads
  try {
    const quadsResult = await chrome.debugger.sendCommand(debuggee, "DOM.getContentQuads", {
      backendNodeId,
    });
    if (quadsResult?.quads && quadsResult.quads.length > 0) {
      const quad = quadsResult.quads[0];
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];

      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return {
        x: Math.round((minX + maxX) / 2),
        y: Math.round((minY + maxY) / 2),
      };
    }
  } catch {
    // Quads may also fail
  }

  throw new Error(`Could not resolve coordinates for backend node ${backendNodeId}. Element may not be visible.`);
}

// ── CDP Tool Execution ────────────────────────────────────────────────────

/**
 * Execute a CDP-backed browser tool against the debugger-attached tab.
 *
 * Dispatches to the appropriate CDP command based on the tool name.
 * All browser tools return { success: boolean, summary?: string, text?: string }.
 * For snapshot tools, text is the formatted accessibility tree or screenshot data.
 *
 * @param {string} toolName - CDP tool name (e.g., "browser_snapshot")
 * @param {object} args - Parsed arguments from the LLM's tool call
 * @param {object} debuggee - CDP debuggee { tabId } for the attached tab
 * @param {object} [options] - Extra options
 * @param {object[]} [options.consoleMessages] - Buffered console messages (for browser_console_messages)
 * @param {object[]} [options.networkRequests] - Buffered network requests (for browser_network_requests)
 * @returns {Promise<object>} Result object with { success, summary?, text?, displayText? }
 */
export async function executeCdpTool(toolName, args, debuggee, options = {}) {
  switch (toolName) {
    // ── Observation ───────────────────────────────────────────────────
    case "browser_snapshot": {
      const result = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
      const axNodes = result?.nodes || [];
      const text = formatAXTree(axNodes);
      return {
        success: true,
        summary: `Page snapshot — ${axNodes.length} accessibility nodes captured`,
        text,
        displayText: text,
      };
    }

    case "browser_take_screenshot": {
      let clip;
      if (args.ref) {
        // Capture a specific element
        try {
          const refNum = parseInt(String(args.ref), 10);
          const boxModel = await chrome.debugger.sendCommand(debuggee, "DOM.getBoxModel", {
            backendNodeId: refNum,
          });
          if (boxModel?.model?.content) {
            const c = boxModel.model.content;
            const xs = [c[0], c[2], c[4], c[6]];
            const ys = [c[1], c[3], c[5], c[7]];
            clip = {
              x: Math.min(...xs),
              y: Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
              scale: 1,
            };
          }
        } catch {
          // Fall through to full-page screenshot
        }
      }

      const params = { format: "jpeg", quality: 50 };
      if (clip) params.clip = clip;

      const result = await chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", params);
      return {
        success: true,
        summary: `Screenshot captured (${result.data ? Math.round(result.data.length / 1024) : 0} KB JPEG)`,
        text: result.data || "",
        displayText: args.element
          ? `[Screenshot of ${args.element}]`
          : "[Page screenshot]",
      };
    }

    // ── Navigation ────────────────────────────────────────────────────
    case "browser_navigate": {
      const url = String(args.url || "").trim();
      if (!url) return { success: false, error: "No URL provided" };

      const result = await chrome.debugger.sendCommand(debuggee, "Page.navigate", {
        url,
      });

      // Re-snapshot after navigation so the caller gets fresh state
      let snapshotText = "";
      try {
        // Brief wait for page to start loading
        await sleep(500);
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Snapshot may fail during navigation — non-fatal
      }

      return {
        success: true,
        summary: `Navigated to ${url}`,
        text: snapshotText,
        displayText: snapshotText || `Navigated to ${url}`,
      };
    }

    case "browser_navigate_back": {
      try {
        await chrome.debugger.sendCommand(debuggee, "Page.navigateToHistoryEntry", {
          entryId: -1,
        });
      } catch {
        // Fallback: use JavaScript
        await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
          expression: "history.back()",
        });
      }

      let snapshotText = "";
      try {
        await sleep(500);
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        summary: "Navigated back",
        text: snapshotText,
        displayText: snapshotText || "Navigated back",
      };
    }

    // ── Click ─────────────────────────────────────────────────────────
    case "browser_click": {
      const ref = args.ref !== undefined ? parseInt(String(args.ref), 10) : null;
      if (ref === null || isNaN(ref)) {
        return { success: false, error: "No valid ref provided for click" };
      }

      const { x, y } = await getElementCenter(debuggee, ref);
      const button = args.button || "left";
      const clickCount = args.doubleClick ? 2 : 1;

      // mousePressed
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button,
        clickCount,
      });

      // Small delay for realism
      await sleep(20);

      // mouseReleased
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button,
        clickCount,
      });

      // Re-snapshot after click so user/LLM sees new page state
      let snapshotText = "";
      try {
        await sleep(200);
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        summary: `Clicked ${args.element || `ref=${ref}`} at (${x}, ${y})`,
        text: snapshotText,
        displayText: snapshotText || `Clicked ${args.element || `ref=${ref}`} at (${x}, ${y})`,
      };
    }

    // ── Type ──────────────────────────────────────────────────────────
    case "browser_type": {
      const ref = args.ref !== undefined ? parseInt(String(args.ref), 10) : null;
      const text = String(args.text || "");
      if (ref === null || isNaN(ref)) {
        return { success: false, error: "No valid ref provided for type" };
      }
      if (!text) {
        return { success: false, error: "No text provided to type" };
      }

      // Click on the element to focus it
      const { x, y } = await getElementCenter(debuggee, ref);

      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });

      await sleep(100);

      // Type the text character by character using insertText
      // (Input.insertText types the whole string at once — simplest)
      await chrome.debugger.sendCommand(debuggee, "Input.insertText", {
        text,
      });

      if (args.submit) {
        await sleep(50);
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      }

      let snapshotText = "";
      try {
        await sleep(200);
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        summary: `Typed "${text}" into ${args.element || `ref=${ref}`}`,
        text: snapshotText,
        displayText: snapshotText || `Typed "${text}" into ${args.element || `ref=${ref}`}`,
      };
    }

    // ── Press Key ─────────────────────────────────────────────────────
    case "browser_press_key": {
      const key = String(args.key || "");
      if (!key) return { success: false, error: "No key specified" };

      // Parse key and modifiers (e.g., "Control+a" → ctrlKey=true, key="a")
      const parts = key.toLowerCase().split("+");
      const mainKey = parts.pop();
      const modifiers = {
        ctrlKey: parts.includes("control") || parts.includes("ctrl"),
        altKey: parts.includes("alt"),
        shiftKey: parts.includes("shift"),
        metaKey: parts.includes("meta") || parts.includes("cmd") || parts.includes("command"),
      };

      // Key name → CDP key mapping
      const keyName = keyMapping(mainKey);

      // For compound keys like Escape/Enter/Tab, we send keyDown/keyUp
      // For character keys, we can use insertText or key events
      if (["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown",
           "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "F1",
           "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"].includes(keyName)) {
        // Special key: dispatch keyDown + keyUp
        const vkCode = virtualKeyCode(keyName);
        const eventParams = {
          type: "keyDown",
          key: keyName,
          code: keyName,
          windowsVirtualKeyCode: vkCode,
          ...modifiers,
        };
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", eventParams);
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
          ...eventParams,
          type: "keyUp",
        });
      } else {
        // Character key: insert the text
        await chrome.debugger.sendCommand(debuggee, "Input.insertText", {
          text: modifiers.shiftKey ? mainKey.toUpperCase() : mainKey,
        });
      }

      let snapshotText = "";
      if (keyName === "Enter") {
        try {
          await sleep(500);
          const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
          snapshotText = formatAXTree(snapResult?.nodes || []);
        } catch {
          // Non-fatal
        }
      }

      return {
        success: true,
        summary: `Pressed key: ${key}`,
        text: snapshotText,
        displayText: snapshotText || `Pressed key: ${key}`,
      };
    }

    // ── Hover ─────────────────────────────────────────────────────────
    case "browser_hover": {
      const ref = args.ref !== undefined ? parseInt(String(args.ref), 10) : null;
      if (ref === null || isNaN(ref)) {
        return { success: false, error: "No valid ref provided for hover" };
      }

      const { x, y } = await getElementCenter(debuggee, ref);

      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });

      // Brief wait for hover effects (dropdowns, tooltips) to appear
      await sleep(300);

      let snapshotText = "";
      try {
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        summary: `Hovered over ${args.element || `ref=${ref}`} at (${x}, ${y})`,
        text: snapshotText,
        displayText: snapshotText || `Hovered over ${args.element || `ref=${ref}`}`,
      };
    }

    // ── Drag ──────────────────────────────────────────────────────────
    case "browser_drag": {
      const fromRef = args.fromRef !== undefined ? parseInt(String(args.fromRef), 10) : null;
      const toRef = args.toRef !== undefined ? parseInt(String(args.toRef), 10) : null;
      if (fromRef === null || isNaN(fromRef) || toRef === null || isNaN(toRef)) {
        return { success: false, error: "Valid fromRef and toRef are required" };
      }

      const fromCoords = await getElementCenter(debuggee, fromRef);
      const toCoords = await getElementCenter(debuggee, toRef);

      // Move to start position
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: fromCoords.x,
        y: fromCoords.y,
      });
      await sleep(50);

      // Press and hold
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: fromCoords.x,
        y: fromCoords.y,
        button: "left",
      });

      // Move in small steps toward destination for realism
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const dx = fromCoords.x + (toCoords.x - fromCoords.x) * t;
        const dy = fromCoords.y + (toCoords.y - fromCoords.y) * t;
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(dx),
          y: Math.round(dy),
          button: "left",
        });
        await sleep(20);
      }

      // Release
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: toCoords.x,
        y: toCoords.y,
        button: "left",
      });

      let snapshotText = "";
      try {
        await sleep(300);
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        summary: `Dragged ${args.fromElement || `ref=${fromRef}`} to ${args.toElement || `ref=${toRef}`}`,
        text: snapshotText,
        displayText: snapshotText || `Dragged ${args.fromElement || `ref=${fromRef}`} to ${args.toElement || `ref=${toRef}`}`,
      };
    }

    // ── Wait ──────────────────────────────────────────────────────────
    case "browser_wait_for": {
      const time = parseInt(String(args.time || "0"), 10);
      if (time <= 0) return { success: false, error: "Invalid wait time" };

      await sleep(Math.min(time, 30000)); // Cap at 30 seconds

      let snapshotText = "";
      try {
        const snapResult = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
        snapshotText = formatAXTree(snapResult?.nodes || []);
      } catch {
        // Non-fatal
      }

      return {
        success: true,
        summary: `Waited ${time}ms`,
        text: snapshotText,
        displayText: snapshotText || `Waited ${time}ms`,
      };
    }

    // ── Evaluate JS ───────────────────────────────────────────────────
    case "browser_evaluate": {
      const expression = String(args.function || "");
      if (!expression) return { success: false, error: "No JavaScript expression provided" };

      let result;
      try {
        result = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
          expression: expression,
          returnByValue: true,
          awaitPromise: true,
          timeout: 10000,
        });
      } catch (evalErr) {
        return {
          success: false,
          error: `JavaScript evaluation failed: ${evalErr.message}`,
        };
      }

      let value;
      if (result?.exceptionDetails) {
        return {
          success: false,
          error: `JavaScript exception: ${JSON.stringify(result.exceptionDetails.text || result.exceptionDetails)}`,
        };
      }
      if (result?.result?.value !== undefined) {
        value = result.result.value;
      } else if (result?.result?.description) {
        value = result.result.description;
      } else {
        value = "(no return value)";
      }

      // Stringify complex values for display
      let displayValue = value;
      if (typeof value === "object" && value !== null) {
        try {
          displayValue = JSON.stringify(value, null, 2);
        } catch {
          displayValue = String(value);
        }
      }

      return {
        success: true,
        summary: `Evaluated JavaScript (${Math.min(String(displayValue).length, 100)} chars)`,
        text: String(displayValue),
        displayText: `[JS Result]\n${String(displayValue)}`,
        rawValue: value,
      };
    }

    // ── Console Messages (buffered) ───────────────────────────────────
    case "browser_console_messages": {
      const messages = options.consoleMessages || bufferedConsoleMessages;
      if (messages.length === 0) {
        return { success: true, summary: "No console messages captured", text: "(none)" };
      }

      const lines = messages.map((msg) => {
        const type = msg.type === "log" ? "info" : (msg.type || "log");
        const text = (msg.text || msg.args?.map((a) => a.value ?? a.description).join(" ") || "");
        const truncated = text.length > 500 ? text.slice(0, 497) + "..." : text;
        return `  [${type}] ${truncated}`;
      });

      const text = `${messages.length} console messages:\n${lines.join("\n")}`;

      return {
        success: true,
        summary: `${messages.length} console messages`,
        text,
        displayText: text,
      };
    }

    // ── Network Requests (buffered) ───────────────────────────────────
    case "browser_network_requests": {
      const requests = options.networkRequests || bufferedNetworkRequests;
      if (requests.length === 0) {
        return { success: true, summary: "No network requests captured", text: "(none)" };
      }

      const lines = requests.map((req) => {
        const method = req.request?.method || "GET";
        const url = req.request?.url || "";
        const type = req.type || "";
        const truncated = url.length > 200 ? url.slice(0, 197) + "..." : url;
        return `  ${method} ${truncated} [${type}]`;
      });

      const text = `${requests.length} network requests:\n${lines.join("\n")}`;

      return {
        success: true,
        summary: `${requests.length} network requests`,
        text,
        displayText: text,
      };
    }

    // ── Dialog handling ───────────────────────────────────────────────
    case "browser_handle_dialog": {
      const accept = args.accept !== false; // default true
      const promptText = args.promptText || "";

      try {
        if (accept && promptText) {
          await chrome.debugger.sendCommand(debuggee, "Page.handleJavaScriptDialog", {
            accept: true,
            promptText,
          });
        } else if (accept) {
          await chrome.debugger.sendCommand(debuggee, "Page.handleJavaScriptDialog", {
            accept: true,
          });
        } else {
          await chrome.debugger.sendCommand(debuggee, "Page.handleJavaScriptDialog", {
            accept: false,
          });
        }
      } catch (err) {
        return { success: false, error: `Failed to handle dialog: ${err.message}` };
      }

      return {
        success: true,
        summary: accept
          ? (promptText ? `Accepted dialog with text "${promptText}"` : "Accepted dialog")
          : "Dismissed dialog",
      };
    }

    // ── Select option ─────────────────────────────────────────────────
    case "browser_select_option": {
      const ref = args.ref !== undefined ? parseInt(String(args.ref), 10) : null;
      const values = args.values || [];
      if (ref === null || isNaN(ref) || values.length === 0) {
        return { success: false, error: "Valid ref and values array are required" };
      }

      // Set the select element's value via JavaScript
      const valuesJson = JSON.stringify(values);
      const expression = `
        (() => {
          const els = document.querySelectorAll('select');
          for (const el of els) {
            for (const opt of el.options) {
              if (${valuesJson}.includes(opt.value) || ${valuesJson}.includes(opt.text)) {
                opt.selected = true;
              }
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return 'ok';
        })()
      `;

      try {
        await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
      } catch (err) {
        return { success: false, error: `Failed to select option: ${err.message}` };
      }

      return {
        success: true,
        summary: `Selected ${JSON.stringify(values)} in ${args.element || `ref=${ref}`}`,
      };
    }

    // ── File upload ───────────────────────────────────────────────────
    case "browser_file_upload": {
      const ref = args.ref !== undefined ? parseInt(String(args.ref), 10) : null;
      const paths = args.paths || [];
      if (ref === null || isNaN(ref) || paths.length === 0) {
        return { success: false, error: "Valid ref and paths array are required" };
      }

      // File upload via CDP requires DOM.setFileInputFiles
      try {
        await chrome.debugger.sendCommand(debuggee, "DOM.setFileInputFiles", {
          files: paths,
          backendNodeId: ref,
        });
      } catch (err) {
        return { success: false, error: `Failed to upload files: ${err.message}. File uploads require the full path to each file.` };
      }

      return {
        success: true,
        summary: `Uploaded ${paths.length} file(s): ${paths.join(", ")}`,
      };
    }

    default:
      return { success: false, error: `Unknown CDP browser tool: ${toolName}` };
  }
}

// ── Combined Tool Definitions ─────────────────────────────────────────────

/**
 * Get all tool definitions (CDP browser + local) filtered by an optional
 * set of enabled tool names.
 *
 * @param {Set<string>|string[]} [filter] - Optional set/array of enabled tool names
 * @param {object[]} localToolDefs - Local tool definitions from lib/mcp-tools.js
 * @returns {object[]} OpenAI-formatted tool definitions
 */
export function getAllToolDefinitions(filter, localToolDefs = []) {
  const cdpTools = getCdpToolDefinitions();
  const allTools = [...cdpTools, ...localToolDefs];

  if (filter && (Array.isArray(filter) || filter instanceof Set)) {
    const filterSet = filter instanceof Set ? filter : new Set(filter);
    return allTools.filter((t) => filterSet.has(t.function.name));
  }

  return allTools;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Promise-based sleep.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map a key name to a standardized CDP key name.
 * Handles common LLM-provided key names.
 *
 * @param {string} rawKey - Raw key name from the LLM
 * @returns {string} Standardized key name
 */
function keyMapping(rawKey) {
  const map = {
    "enter": "Enter",
    "return": "Enter",
    "esc": "Escape",
    "escape": "Escape",
    "tab": "Tab",
    "backspace": "Backspace",
    "delete": "Delete",
    "del": "Delete",
    "up": "ArrowUp",
    "arrowup": "ArrowUp",
    "down": "ArrowDown",
    "arrowdown": "ArrowDown",
    "left": "ArrowLeft",
    "arrowleft": "ArrowLeft",
    "right": "ArrowRight",
    "arrowright": "ArrowRight",
    "pageup": "PageUp",
    "pagedown": "PageDown",
    "home": "Home",
    "end": "End",
    "space": " ",
    " ": " ",
  };

  if (rawKey.length === 1) return rawKey;
  return map[rawKey] || rawKey.charAt(0).toUpperCase() + rawKey.slice(1);
}

/**
 * Get the Windows virtual key code for a special key name.
 * These are approximate — CDP is flexible about this field.
 *
 * @param {string} keyName - Standardized key name
 * @returns {number} Virtual key code
 */
function virtualKeyCode(keyName) {
  const codes = {
    "Enter": 13,
    "Escape": 27,
    "Tab": 9,
    "Backspace": 8,
    "Delete": 46,
    "ArrowUp": 38,
    "ArrowDown": 40,
    "ArrowLeft": 37,
    "ArrowRight": 39,
    "PageUp": 33,
    "PageDown": 34,
    "Home": 36,
    "End": 35,
    "F1": 112,
    "F2": 113,
    "F3": 114,
    "F4": 115,
    "F5": 116,
    "F6": 117,
    "F7": 118,
    "F8": 119,
    "F9": 120,
    "F10": 121,
    "F11": 122,
    "F12": 123,
  };
  return codes[keyName] || 0;
}

