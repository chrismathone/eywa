/** Snapshot current changed application/SQL files, including untracked feature files. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const output = process.argv[2];
if (!output) throw new Error("Review manifest output path required");
const git = args => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
const base = "b7a43db4bfce21d866e7c1b7270dd119ef67e164";
const files = [...new Set([...git(["diff", base, "--name-only", "-z"]), ...git(["ls-files", "--others", "--exclude-standard", "-z"])])]
  .filter(file => file.startsWith("src/") || file.startsWith("supabase/")).sort();
const manifest = files.map(file => ({ file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }));
writeFileSync(output, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ files: files.length, digest: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") }));
