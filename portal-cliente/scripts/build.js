"use strict";
const fs = require("fs");
const path = require("path");
const { assets, config } = require("../policy");
const project = path.resolve(__dirname, "..");
const source = path.resolve(project, "../public");
// O diretório de saída é próprio deste projeto; nunca copiar public/ inteiro.
function build(output = path.join(project, "dist")) {
  const saved = JSON.parse(
    fs.readFileSync(path.join(project, "vercel.json"), "utf8"),
  );
  if (JSON.stringify(saved) !== JSON.stringify(config()))
    throw new Error(
      "vercel.json diverge da política pública. Execute node scripts/build.js --config.",
    );
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, "assets"), { recursive: true });
  fs.copyFileSync(
    path.join(source, "portal.html"),
    path.join(output, "index.html"),
  );
  fs.copyFileSync(
    path.join(project, "404.html"),
    path.join(output, "404.html"),
  );
  for (const asset of assets)
    fs.copyFileSync(
      path.join(source, "assets", asset),
      path.join(output, "assets", asset),
    );
  return output;
}
if (require.main === module) {
  if (process.argv.includes("--config"))
    fs.writeFileSync(
      path.join(project, "vercel.json"),
      JSON.stringify(config(), null, 2) + "\n",
    );
  else console.log("Portal estático gerado em " + build());
}
module.exports = { build };
