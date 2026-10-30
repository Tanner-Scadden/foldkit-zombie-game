# The harness's worker for a local workerd, the runtime of Workers and
# Durable Objects. crossEngine.ts serves it with infra's workerd binary.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ (name = "main", worker = .harness) ],
  sockets = [ (name = "http", address = "127.0.0.1:8797", http = (), service = "main") ],
);

const harness :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "out/worker.js") ],
  compatibilityDate = "2026-10-01",
);
