import * as path from "node:path";
import * as vscode from "vscode";
import { WorkspaceController } from "./controllers/WorkspaceController";
import { Logger } from "./services/Logger";
import { ChatViewProvider } from "./views/ChatViewProvider";

let controller: WorkspaceController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const configuration = vscode.workspace.getConfiguration("opencodeRaineye");
  const logger = new Logger(configuration.get<"debug" | "info" | "warn" | "error">("logLevel", "info"));
  const folder = activeWorkspaceFolder();
  const workspacePath = folder?.uri.fsPath ?? process.cwd();
  const workspaceName = folder?.name ?? path.basename(workspacePath);
  controller = new WorkspaceController(context, logger, workspacePath, workspaceName);
  const provider = new ChatViewProvider(context, controller, logger);

  context.subscriptions.push(
    logger,
    controller,
    provider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("opencodeRaineye.openSidebar", () => provider.reveal("chat")),
    vscode.commands.registerCommand("opencodeRaineye.newChat", async () => {
      await provider.reveal("chat");
      await controller?.handle({ type: "new-session" });
    }),
    vscode.commands.registerCommand("opencodeRaineye.showHistory", () => provider.reveal("history")),
    vscode.commands.registerCommand("opencodeRaineye.openSettings", () => provider.reveal("settings")),
    vscode.commands.registerCommand("opencodeRaineye.reconnect", () => controller?.handle({ type: "reconnect" })),
    vscode.commands.registerCommand("opencodeRaineye.openTui", () => controller?.handle({ type: "open-tui" })),
    vscode.commands.registerCommand("opencodeRaineye.insertFileReference", async () => {
      const attachment = await controller?.insertActiveFileReference();
      if (!attachment) return;
      await provider.reveal("chat");
      provider.insertAttachment(attachment);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("opencodeRaineye.logLevel")) return;
      logger.setLevel(vscode.workspace.getConfiguration("opencodeRaineye").get("logLevel", "info"));
    }),
  );

  logger.info("RainEye activated", { workspacePath });
  void controller.start();
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri) {
    const folder = vscode.workspace.getWorkspaceFolder(editorUri);
    if (folder) return folder;
  }
  return vscode.workspace.workspaceFolders?.[0];
}
