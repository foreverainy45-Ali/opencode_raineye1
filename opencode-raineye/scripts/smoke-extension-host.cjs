const Module = require("node:module");
const path = require("node:path");

// Keep activation smoke deterministic even when real OpenCode servers are
// listening on the developer machine. Discovery behavior has separate tests.
global.fetch = async () => new Response(undefined, { status: 404 });

class FakeEventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }

  fire(value) {
    for (const listener of this.listeners) listener(value);
  }

  dispose() {
    this.listeners.clear();
  }
}

const commands = new Set();
const views = new Set();
const disposable = () => ({ dispose() {} });
const output = {
  appendLine() {},
  show() {},
  dispose() {},
};
const workspacePath = path.resolve(__dirname, "../..");
const vscodeMock = {
  EventEmitter: FakeEventEmitter,
  Uri: {
    file: (fsPath) => ({ fsPath, path: fsPath }),
    joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts), path: path.join(base.fsPath, ...parts) }),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  window: {
    activeTextEditor: undefined,
    terminals: [],
    createOutputChannel: () => output,
    registerWebviewViewProvider: (id) => {
      views.add(id);
      return disposable();
    },
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showQuickPick: async (items) => items[0],
  },
  workspace: {
    workspaceFolders: [{ name: "smoke", uri: { fsPath: workspacePath, path: workspacePath } }],
    getWorkspaceFolder: () => undefined,
    getConfiguration: () => ({
      get: (_key, fallback) => fallback,
      update: async () => undefined,
    }),
    onDidChangeConfiguration: () => disposable(),
  },
  commands: {
    registerCommand: (id) => {
      commands.add(id);
      return disposable();
    },
    executeCommand: async () => undefined,
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require("../dist/extension.js");
const context = {
  extensionUri: { fsPath: path.resolve(__dirname, ".."), path: path.resolve(__dirname, "..") },
  subscriptions: [],
  workspaceState: {
    get: (_key, fallback) => fallback,
    update: async () => undefined,
  },
};

extension.activate(context);

const expectedCommands = [
  "opencodeRaineye.openSidebar",
  "opencodeRaineye.newChat",
  "opencodeRaineye.showHistory",
  "opencodeRaineye.openSettings",
  "opencodeRaineye.reconnect",
  "opencodeRaineye.openTui",
  "opencodeRaineye.insertFileReference",
];
const missingCommands = expectedCommands.filter((id) => !commands.has(id));
if (missingCommands.length) throw new Error(`Commands were not registered: ${missingCommands.join(", ")}`);
if (!views.has("opencodeRaineye.chat")) throw new Error("WebviewView provider was not registered");

extension.deactivate();
console.log(`Extension activation smoke passed (${commands.size} commands, ${views.size} view)`);
