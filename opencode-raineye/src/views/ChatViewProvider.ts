import * as vscode from "vscode";
import { WorkspaceController } from "../controllers/WorkspaceController";
import { Logger } from "../services/Logger";
import {
  AttachmentView,
  HostToWebviewMessage,
  isWebviewMessage,
  ViewSection,
} from "../shared/protocol";

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "opencodeRaineye.chat";

  private view?: vscode.WebviewView;
  private readonly pendingAttachments: AttachmentView[] = [];
  private readonly stateSubscription: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: WorkspaceController,
    private readonly logger: Logger,
  ) {
    this.stateSubscription = controller.onDidChange((snapshot) => this.post({ type: "snapshot", snapshot }));
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    };
    webview.html = this.html(webview);

    webview.onDidReceiveMessage(async (value: unknown) => {
      if (!isWebviewMessage(value)) {
        this.logger.warn("Ignored invalid webview message", value);
        return;
      }
      try {
        const attachment = await this.controller.handle(value);
        if (attachment) this.post({ type: "insert-reference", attachment });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("Webview action failed", error);
        this.post({ type: "toast", level: "error", message });
      }
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    });

    this.post({ type: "snapshot", snapshot: this.controller.state });
    for (const attachment of this.pendingAttachments.splice(0)) this.post({ type: "insert-reference", attachment });
  }

  async reveal(section: ViewSection = "chat"): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.opencodeRaineye");
    await this.controller.navigate(section);
    this.view?.show?.(true);
    if (section === "chat") this.post({ type: "focus-composer" });
  }

  insertAttachment(attachment: AttachmentView): void {
    if (!this.view) {
      this.pendingAttachments.push(attachment);
      return;
    }
    this.post({ type: "insert-reference", attachment });
    this.post({ type: "focus-composer" });
  }

  dispose(): void {
    this.stateSubscription.dispose();
  }

  private post(message: HostToWebviewMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "app.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "app.css"));
    const nonce = createNonce();
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${styleUri}" />
    <title>RainEye</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
