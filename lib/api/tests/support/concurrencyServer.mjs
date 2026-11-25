import app from "../../dist/index.js";

const port = Number(process.env.PORT);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`concurrency server ready on ${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
