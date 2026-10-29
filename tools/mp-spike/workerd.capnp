# The spike's worker for a local workerd, the runtime of Workers and Durable
# Objects. crossEngine.ts serves it with infra/node_modules/.bin/workerd.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ (name = "main", worker = .spike) ],
  sockets = [ (name = "http", address = "127.0.0.1:8799", http = (), service = "main") ],
);

const spike :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "out/worker.js") ],
  compatibilityDate = "2026-10-01",
);
