// One-shot maintenance script: move inline base64 message images out of
// state.json into the attachment directory, leaving only gateway file
// references in the transcript. Run while the service is stopped:
//
//   VAULT_PATH=/srv/forward-assistant/data/vault node server/migrate-attachments.mjs
//
import { AssistantStateStore } from './state-store.mjs';

const vaultPath = process.env.VAULT_PATH || process.cwd();
const store = new AssistantStateStore(vaultPath);
const result = await store.migrateMessageAttachmentsToFiles();
console.log(`[migrate-attachments] scanned=${result.scanned} converted=${result.converted} inline-bytes-freed=${result.bytes}`);
