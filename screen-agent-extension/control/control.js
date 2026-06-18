/**
 * Control page script — connects to the Screen Agent extension via
 * externally_connectable and sends direct action commands.
 */

const EXTENSION_ID = ""; // Auto-detected — leave blank for unpacked extension

const statusEl = document.getElementById("status");
const cmdEl = document.getElementById("cmd");
const outputEl = document.getElementById("output");

let port = null;

// ── Connection ────────────────────────────────────────────────────────────

/**
 * Connect to the extension. For unpacked extensions, the ID is derived
 * from the public key in manifest. We try to find it via chrome.runtime.sendMessage
 * first, then fall back to a connect attempt.
 */
async function connect() {
  // Try to find the extension by sending a test message
  // For unpacked extensions loaded via "Load unpacked", the ID is stable
  // We'll try a connect and if it fails, show the error
  try {
    port = chrome.runtime.connect(EXTENSION_ID || undefined, { name: "control-page" });
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      statusEl.textContent = "Disconnected — waiting for extension...";
      statusEl.className = "status disconnected";
      port = null;
      // Auto-reconnect after 1 second
      setTimeout(connect, 1000);
    });
    statusEl.textContent = "Connected to Screen Agent extension";
    statusEl.className = "status connected";
  } catch (err) {
    statusEl.textContent = "Failed to connect: " + err.message + " — is the extension loaded?";
    statusEl.className = "status disconnected";
    setTimeout(connect, 2000);
  }
}

// ── Message Handling ───────────────────────────────────────────────────────

function handleMessage(msg) {
  const ts = new Date().toLocaleTimeString();
  const json = JSON.stringify(msg, null, 2);
  const cls = msg.ok ? "ok" : "err";
  outputEl.innerHTML += '<div class="entry"><span class="ts">' + ts + '</span> <span class="' + cls + '">' + json.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</span></div>\n';
  outputEl.scrollTop = outputEl.scrollHeight;
}

// ── Commands ───────────────────────────────────────────────────────────────

function sendCmd() {
  if (!port) {
    outputEl.innerHTML += '<div class="entry"><span class="err">Not connected — reload the extension and page</span></div>\n';
    return;
  }
  try {
    const cmd = JSON.parse(cmdEl.value);
    outputEl.innerHTML += '<div class="entry"><span class="ts">→</span> ' + JSON.stringify(cmd) + '</div>\n';
    port.postMessage(cmd);
  } catch (e) {
    outputEl.innerHTML += '<div class="entry"><span class="err">Invalid JSON: ' + e.message + '</span></div>\n';
  }
}

function setCmd(action, a, b) {
  const cmd = { action };
  if (action === "click_element") cmd.index = a;
  else if (action === "click_coords") { cmd.x = a; cmd.y = b; }
  else if (action === "scroll") cmd.pixels = a;
  else if (action === "navigate") cmd.url = a;
  else if (action === "wait") cmd.ms = a;
  cmdEl.value = JSON.stringify(cmd);
}

function clearOutput() {
  outputEl.innerHTML = "";
}

// ── Init ───────────────────────────────────────────────────────────────────

connect();

// Also allow Ctrl+Enter to send
cmdEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) {
    e.preventDefault();
    sendCmd();
  }
});
