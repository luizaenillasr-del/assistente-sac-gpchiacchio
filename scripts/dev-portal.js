"use strict";
// Simulação local das rotas versionadas da Vercel. Não publica nem acessa produção.
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { build } = require("../portal-cliente/scripts/build");
const configuration = require("../portal-cliente/vercel.json");
function createPortalApp({
  backendUrl = "http://127.0.0.1:3000",
  outputDir,
} = {}) {
  const target = new URL(backendUrl);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  )
    throw new Error("O simulador aceita somente backend HTTP local.");
  const directory = outputDir || build();
  const app = express();
  app.use((req, res) => {
    for (const route of configuration.routes) {
      if (route.handle === "filesystem") {
        const file = path.resolve(directory, "." + req.path);
        if (
          file.startsWith(directory + path.sep) &&
          fs.existsSync(file) &&
          fs.statSync(file).isFile() &&
          ["GET", "HEAD"].includes(req.method)
        )
          return res.sendFile(file);
        continue;
      }
      const match = req.path.match(new RegExp(route.src));
      if (!match || (route.methods && !route.methods.includes(req.method)))
        continue;
      if (route.headers) res.set(route.headers);
      if (route.continue) continue;
      if (route.status) res.status(route.status);
      const destination = route.dest.replace(
        /\$(\d+)/g,
        (_, n) => match[Number(n)] || "",
      );
      if (destination.startsWith("https://")) {
        const remote = new URL(destination);
        const proxy = http.request(
          new URL(
            remote.pathname + new URL(req.originalUrl, "http://local").search,
            target,
          ),
          {
            method: req.method,
            headers: { ...req.headers, host: target.host },
          },
          (response) => {
            res.status(response.statusCode);
            // Conservar as proteções do portal, mesmo se o backend definir política mais ampla.
            for (const [name, value] of Object.entries(response.headers)) {
              if (
                value !== undefined &&
                ![
                  "connection",
                  "content-security-policy",
                  "referrer-policy",
                ].includes(name)
              )
                res.setHeader(name, value);
            }
            response.pipe(res);
          },
        );
        proxy.setTimeout(20000, () =>
          proxy.destroy(new Error("Backend local indisponível.")),
        );
        proxy.on("error", () => {
          if (!res.headersSent)
            res
              .status(502)
              .json({ sucesso: false, erro: "Backend local indisponível." });
        });
        req.pipe(proxy);
        return;
      }
      return res.sendFile(path.join(directory, destination));
    }
    res.sendStatus(404);
  });
  return app;
}
if (require.main === module) {
  const port = Number(process.env.PORTAL_PORT || 3001);
  createPortalApp({
    backendUrl: process.env.SAC_LOCAL_URL || "http://127.0.0.1:3000",
  }).listen(port, "127.0.0.1", () =>
    console.log("Portal público local em http://127.0.0.1:" + port),
  );
}
module.exports = { createPortalApp };
