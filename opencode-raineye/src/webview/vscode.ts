import type { WebviewToHostMessage } from "../shared/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

export function post(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}
