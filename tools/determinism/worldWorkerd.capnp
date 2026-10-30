# The World's worker for a local workerd. worldCheck.ts serves it with infra's
# workerd binary.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ (name = "main", worker = .world) ],
  sockets = [ (name = "http", address = "127.0.0.1:8796", http = (), service = "main") ],
);

const world :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "out/worldWorker.js") ],
  compatibilityDate = "2026-10-01",
);
