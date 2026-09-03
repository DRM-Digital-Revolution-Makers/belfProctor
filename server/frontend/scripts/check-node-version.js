import process from "node:process";

const [major, minor, patch] = process.versions.node.split(".").map(Number);

if (major !== 22 || minor < 22 || (minor === 22 && patch < 2)) {
  console.error(
    `BelfProctor requires Node.js >=22.22.2 <23 (current: ${process.versions.node}). ` +
      "Use the version declared in the repository .nvmrc.",
  );
  process.exit(1);
}
