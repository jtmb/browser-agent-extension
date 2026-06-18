/**
 * Node.js test harness for Screen Agent pure logic.
 *
 * Tests the core library functions from lib/lmstudio.js, tools/definitions.js,
 * and tools/get_page_elements.js that don't depend on chrome.* APIs.
 *
 * Run:  node test.js
 */

import { buildSystemPrompt, buildMessages, parseToolCallsFromReasoning, DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from "./lib/lmstudio.js";
import { getToolDefinitions, toNumber } from "./tools/definitions.js";
import { getElementsScript, formatElementsForLLM } from "./tools/get_page_elements.js";

// ── Simple test runner (Node 18+) ──────────────────────────────────────

var passed = 0;
var failed = 0;
var tests = [];

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || "assertEqual failed") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function assertDeepEqual(actual, expected, msg) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error((msg || "assertDeepEqual failed") + ":\n  expected: " + e + "\n  actual:   " + a);
  }
}

async function run() {
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    try {
      await t.fn();
      console.log("  \u2713 " + t.name);
      passed++;
    } catch (err) {
      console.log("  \u2717 " + t.name);
      console.log("    " + err.message);
      failed++;
    }
  }
  console.log("\n" + passed + " passed, " + failed + " failed, " + tests.length + " total");
  if (failed > 0) process.exit(1);
}

// ── lib/lmstudio.js ────────────────────────────────────────────────────

test("buildSystemPrompt returns default prompt (describe-only)", function () {
  var prompt = buildSystemPrompt();
  assert(typeof prompt === "string", "Should return a string");
  assert(prompt.length > 100, "Prompt should be reasonably long");
  assert(prompt.indexOf("browser automation agent") >= 0, "Should mention browser automation agent role");
  assert(prompt.indexOf("OBSERVE-ONLY") >= 0, "Should mention observe-only mode by default");
  assert(prompt.indexOf("take_screenshot") >= 0, "Should mention take_screenshot tool");
  assert(prompt.indexOf("click_element") < 0, "Should NOT mention click_element in describe-only mode");
});

test("buildSystemPrompt — toolMode enabled mentions all tools", function () {
  var prompt = buildSystemPrompt({ toolMode: true });
  assert(prompt.indexOf("click_element") >= 0, "Should mention click_element tool");
  assert(prompt.indexOf("type_text") >= 0, "Should mention type_text tool");
  assert(prompt.indexOf("scroll") >= 0, "Should mention scroll tool");
  assert(prompt.indexOf("OBSERVE-ONLY") < 0, "Should NOT mention observe-only in tool mode");
});

test("buildSystemPrompt accepts custom prompt", function () {
  var custom = "Custom system prompt";
  var prompt = buildSystemPrompt({ customPrompt: custom });
  assert(prompt.indexOf(custom) === 0, "Custom prompt should be first");
  assert(prompt.indexOf("TOOL INSTRUCTIONS") > 0 || prompt.indexOf("YOUR TOOLS") > 0,
    "Tool instructions should be appended after custom prompt");
});

test("buildMessages — basic user message, no screenshot", function () {
  var messages = buildMessages({
    userMessage: "Hello",
    history: [],
  });
  assert(messages.length >= 2, "Should have at least system + user messages");
  assertEqual(messages[0].role, "system", "First message should be system");
  assertEqual(messages[1].role, "user", "Second message should be user");
  // Content is always wrapped in contentParts array (text blocks)
  assert(Array.isArray(messages[1].content), "Content should be an array");
  assertEqual(messages[1].content.length, 1, "Should have exactly one text part");
  assertEqual(messages[1].content[0].type, "text", "Part should be text type");
  assertEqual(messages[1].content[0].text, "Hello", "User content should match");
});

test("buildMessages — with screenshot + elementsText", function () {
  var messages = buildMessages({
    userMessage: "What do you see?",
    history: [],
    screenshotBase64: "abc123base64",
    screenshotMime: "image/jpeg",
    elementsText: "[0]  <button>  (100,200)  80x30  \"Click me\"",
  });
  assertEqual(messages[1].role, "user", "User message should exist");
  assert(Array.isArray(messages[1].content), "Content should be an array (vision format)");
  assert(messages[1].content.length >= 3, "Should have elements text + image + user text parts");
  assertEqual(messages[1].content[0].type, "text", "First part should be text (elements list)");
  assert(messages[1].content[0].text.indexOf("[0]") >= 0, "First part should contain element listing");
  assertEqual(messages[1].content[1].type, "image_url", "Second part should be image_url");
  assert(
    messages[1].content[1].image_url.url.indexOf("data:image/jpeg;base64,") === 0,
    "Image URL should be a base64 data URI"
  );
  assertEqual(messages[1].content[2].type, "text", "Third part should be text");
  assertEqual(messages[1].content[2].text, "What do you see?", "Text should match user message");
});

test("buildMessages — with conversation history", function () {
  var history = [
    { role: "user", content: "Previous question" },
    { role: "assistant", content: "Previous answer" },
  ];
  var messages = buildMessages({
    userMessage: "Follow up",
    history: history,
  });
  // History messages preserved as-is
  assertEqual(messages[1].role, "user");
  assertEqual(messages[1].content, "Previous question");
  assertEqual(messages[2].role, "assistant");
  assertEqual(messages[2].content, "Previous answer");
  // Latest user message is wrapped in contentParts array
  assertEqual(messages[3].role, "user");
  assert(Array.isArray(messages[3].content), "Latest user content should be array");
  assertEqual(messages[3].content[messages[3].content.length - 1].text, "Follow up");
});

test("buildMessages — preserves correct message count", function () {
  var history = [
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "Q2" },
    { role: "assistant", content: "A2" },
  ];
  var messages = buildMessages({ userMessage: "Q3", history: history });
  assertEqual(messages.length, 6, "Should have system + history + new user message");
});

// ── lib/lmstudio.js — parseToolCallsFromReasoning ─────────────────────

test("parseToolCallsFromReasoning — XML format single tool", function () {
  var reasoning = "I should wait first.\n<tool_call>\n<function=wait>\n<parameter=ms>\n1000\n</parameter>\n</function>\n</tool_call>";
  var calls = parseToolCallsFromReasoning(reasoning);
  assertEqual(calls.length, 1, "Should extract exactly one tool call");
  assertEqual(calls[0].type, "function", "Type should be function");
  assertEqual(calls[0].function.name, "wait", "Function name should be wait");
  var args = JSON.parse(calls[0].function.arguments);
  assertEqual(args.ms, 1000, "ms should be 1000 (number)");
});

test("parseToolCallsFromReasoning — XML format multi-param", function () {
  var reasoning = "<tool_call>\n<function=navigate>\n<parameter=url>\nhttps://google.com\n</parameter>\n</function>\n</tool_call>";
  var calls = parseToolCallsFromReasoning(reasoning);
  assertEqual(calls.length, 1, "Should extract one tool call");
  assertEqual(calls[0].function.name, "navigate", "Function name should be navigate");
  var args = JSON.parse(calls[0].function.arguments);
  assertEqual(args.url, "https://google.com", "url should match");
});

test("parseToolCallsFromReasoning — JSON format", function () {
  var reasoning = "Let me click.\n<tool_call>\n{\"name\":\"click_element\",\"arguments\":{\"index\":5}}\n</tool_call>";
  var calls = parseToolCallsFromReasoning(reasoning);
  assertEqual(calls.length, 1, "Should extract one tool call");
  assertEqual(calls[0].function.name, "click_element", "Function name should be click_element");
  var args = JSON.parse(calls[0].function.arguments);
  assertEqual(args.index, 5, "index should be 5");
});

test("parseToolCallsFromReasoning — multiple tool calls", function () {
  var reasoning = "Doing A then B.\n<tool_call>\n<function=wait>\n<parameter=ms>\n500\n</parameter>\n</function>\n</tool_call>\nsome text\n<tool_call>\n{\"name\":\"take_screenshot\",\"arguments\":{}}\n</tool_call>";
  var calls = parseToolCallsFromReasoning(reasoning);
  assertEqual(calls.length, 2, "Should extract two tool calls");
  assertEqual(calls[0].function.name, "wait", "First should be wait");
  assertEqual(calls[1].function.name, "take_screenshot", "Second should be take_screenshot");
});

test("parseToolCallsFromReasoning — empty / no tool calls", function () {
  var calls = parseToolCallsFromReasoning("Just some thinking, no tools.");
  assertEqual(calls.length, 0, "Should return empty array");
  calls = parseToolCallsFromReasoning("");
  assertEqual(calls.length, 0, "Empty string should return empty");
});

test("parseToolCallsFromReasoning — boolean values", function () {
  var reasoning = "<tool_call>\n<function=some_tool>\n<parameter=flag>\ntrue\n</parameter>\n<parameter=other>\nfalse\n</parameter>\n</function>\n</tool_call>";
  var calls = parseToolCallsFromReasoning(reasoning);
  assertEqual(calls.length, 1, "Should extract one tool call");
  var args = JSON.parse(calls[0].function.arguments);
  assertEqual(args.flag, true, "flag should be true (boolean)");
  assertEqual(args.other, false, "other should be false (boolean)");
});

// ── tools/definitions.js ───────────────────────────────────────────────

test("getToolDefinitions returns all tools", function () {
  var tools = getToolDefinitions();
  assert(tools.length >= 12, "Should have at least 12 tool definitions, got " + tools.length);
});

test("getToolDefinitions — all tools have required fields", function () {
  var tools = getToolDefinitions();
  for (var i = 0; i < tools.length; i++) {
    var tool = tools[i];
    assertEqual(tool.type, "function", "Tool should have type 'function': " + tool.function.name);
    assert(typeof tool.function.name === "string", "Tool should have a name");
    assert(typeof tool.function.description === "string", "Tool should have a description: " + tool.function.name);
    assert(tool.function.parameters, "Tool should have parameters: " + tool.function.name);
    assertEqual(tool.function.parameters.type, "object", "Tool params should be type 'object': " + tool.function.name);
  }
});

test("getToolDefinitions — click_element requires index", function () {
  var tools = getToolDefinitions();
  var clickTool = tools.find(function (t) { return t.function.name === "click_element"; });
  assert(clickTool, "click_element tool should exist");
  assertDeepEqual(
    clickTool.function.parameters.required,
    ["index"],
    "click_element tool should require index"
  );
});

test("getToolDefinitions — click_coords requires x,y", function () {
  var tools = getToolDefinitions();
  var coordTool = tools.find(function (t) { return t.function.name === "click_coords"; });
  assert(coordTool, "click_coords tool should exist");
  assertDeepEqual(
    coordTool.function.parameters.required,
    ["x", "y"],
    "click_coords tool should require x and y"
  );
});

test("getToolDefinitions — take_screenshot has no required params", function () {
  var tools = getToolDefinitions();
  var ssTool = tools.find(function (t) { return t.function.name === "take_screenshot"; });
  assert(ssTool, "take_screenshot tool should exist");
  var reqs = ssTool.function.parameters.required;
  assert(!reqs || reqs.length === 0, "take_screenshot should have no required params");
});

test("getToolDefinitions — web_search exists and requires query", function () {
  var tools = getToolDefinitions();
  var wsTool = tools.find(function (t) { return t.function.name === "web_search"; });
  assert(wsTool, "web_search tool should exist");
  assert(wsTool.function.description.length > 20, "web_search should have a description");
  assertDeepEqual(
    wsTool.function.parameters.required,
    ["query"],
    "web_search tool should require query"
  );
  assertEqual(
    wsTool.function.parameters.properties.query.type,
    "string",
    "query parameter should be string type"
  );
});

test("getToolDefinitions — write_file exists and requires name/content", function () {
  var tools = getToolDefinitions();
  var wfTool = tools.find(function (t) { return t.function.name === "write_file"; });
  assert(wfTool, "write_file tool should exist");
  assertDeepEqual(
    wfTool.function.parameters.required,
    ["name", "content"],
    "write_file should require name and content"
  );
});

test("getToolDefinitions — read_file exists and requires name", function () {
  var tools = getToolDefinitions();
  var rfTool = tools.find(function (t) { return t.function.name === "read_file"; });
  assert(rfTool, "read_file tool should exist");
  assertDeepEqual(
    rfTool.function.parameters.required,
    ["name"],
    "read_file should require name"
  );
});

test("getToolDefinitions — list_files exists and has no required params", function () {
  var tools = getToolDefinitions();
  var lfTool = tools.find(function (t) { return t.function.name === "list_files"; });
  assert(lfTool, "list_files tool should exist");
  assert(lfTool.function.parameters.type === "object", "list_files params should be an object");
  assert(
    Object.keys(lfTool.function.parameters.properties || {}).length === 0,
    "list_files should have no properties"
  );
});


test("toNumber — handles plain integers", function () {
  assertEqual(toNumber(5), 5);
  assertEqual(toNumber(0), 0);
  assertEqual(toNumber(-3), -3);
});

test("toNumber — handles string integers", function () {
  assertEqual(toNumber("5"), 5);
  assertEqual(toNumber("0"), 0);
  assertEqual(toNumber("-3"), -3);
});

test("toNumber — handles float strings (truncates)", function () {
  assertEqual(toNumber("3.14"), 3);
  assertEqual(toNumber("7.9"), 7);
});

test("toNumber — handles float numbers (truncates)", function () {
  assertEqual(toNumber(3.14), 3);
  assertEqual(toNumber(7.9), 7);
});

test("toNumber — handles comma-formatted LLM garbage", function () {
  assertEqual(toNumber("226,207"), 226);
  assertEqual(toNumber("50,100"), 50);
});

test("toNumber — handles null/undefined/bad input", function () {
  assertEqual(toNumber(null), 0);
  assertEqual(toNumber(undefined), 0);
  assertEqual(toNumber(""), 0);
  assertEqual(toNumber("abc"), 0);
});

// ── tools/get_page_elements.js ─────────────────────────────────────────

test("getElementsScript returns a string", function () {
  var script = getElementsScript();
  assert(typeof script === "string", "Should return a string");
  assert(script.length > 200, "Script should be reasonably long");
  assert(script.indexOf("JSON.stringify") >= 0, "Should serialize elements to JSON");
  assert(script.indexOf("querySelectorAll") >= 0, "Should query the DOM");
  assert(script.indexOf("getBoundingClientRect") >= 0, "Should get element positions");
});

test("formatElementsForLLM formats element array", function () {
  var elements = [
    { index: 0, tag: "a", kind: "link", text: "Home", href: "/", x: 10, y: 20, w: 80, h: 30 },
    { index: 1, tag: "button", kind: "button", text: "Submit", href: "", x: 100, y: 200, w: 120, h: 40 },
  ];
  var formatted = formatElementsForLLM(elements);
  assert(formatted.indexOf("[0]") >= 0, "Should include index 0");
  assert(formatted.indexOf("[1]") >= 0, "Should include index 1");
  assert(formatted.indexOf("<a>") >= 0, "Should include tag a");
  assert(formatted.indexOf("<button>") >= 0, "Should include tag button");
  assert(formatted.indexOf("Home") >= 0, "Should include text Home");
  assert(formatted.indexOf("Submit") >= 0, "Should include text Submit");
  assert(formatted.indexOf("80x30") >= 0, "Should include dimensions");
  assert(formatted.indexOf("120x40") >= 0, "Should include dimensions");
});

test("formatElementsForLLM handles empty array", function () {
  var formatted = formatElementsForLLM([]);
  assert(typeof formatted === "string", "Should return a string");
});

test("formatElementsForLLM — each line has coordinates", function () {
  var elements = [
    { index: 0, tag: "input", kind: "text", text: "", href: "", x: 0, y: 0, w: 100, h: 30 },
  ];
  var formatted = formatElementsForLLM(elements);
  assert(formatted.indexOf("(0,0)") >= 0, "Should include coordinate position");
});

// ── Constants ──────────────────────────────────────────────────────────

test("DEFAULT_BASE_URL is set correctly", function () {
  assertEqual(DEFAULT_BASE_URL, "http://127.0.0.1:1234/v1");
});

test("DEFAULT_MODEL is set correctly", function () {
  assertEqual(DEFAULT_MODEL, "qwen/qwen3.5-9b");
});

test("DEFAULT_MAX_TOKENS is reasonable", function () {
  assert(DEFAULT_MAX_TOKENS >= 256 && DEFAULT_MAX_TOKENS <= 32768, "max tokens should be in reasonable range");
});

// ── Run ────────────────────────────────────────────────────────────────

run();
