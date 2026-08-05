import { setListeningMode } from "./core/listening-mode-command";

export default async function main() {
  await setListeningMode("anc");
}
