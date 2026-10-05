import { writeFile } from "node:fs/promises";
import { session } from "./local-auth.mjs";
const destination = process.argv[2];
if (!destination) throw new Error("Synthetic state output path required");
const actor = Number(process.argv[3] ?? 22);
await writeFile(destination, JSON.stringify({ cookies: [{
  name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session(actor))).toString("base64url")}`,
  domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax", expires: -1,
}], origins: [] }, null, 2));
console.log(`Synthetic local state written for actor ${actor}`);
