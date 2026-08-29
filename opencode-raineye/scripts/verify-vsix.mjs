import { access, readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

const input = process.argv[2]
if (!input) throw new Error("Usage: node scripts/verify-vsix.mjs <path-to-vsix>")

const path = resolve(input)
await access(path)
const info = await stat(path)
if (info.size < 10_000) throw new Error(`VSIX is unexpectedly small: ${info.size} bytes`)
const manifestPath = new URL("../package.json", import.meta.url)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.publisher ?? "")) {
  throw new Error(`Invalid extension publisher: ${String(manifest.publisher)}`)
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name ?? "")) {
  throw new Error(`Invalid extension name: ${String(manifest.name)}`)
}
const extensionId = `${manifest.publisher}.${manifest.name}`
console.log(`Verified VSIX: ${path} (${info.size} bytes, ${extensionId})`)
