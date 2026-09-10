import { EventEmitter } from "node:events";
import type { AgentUpdateStateDto, AlertDto, MetricSample } from "@beacon/shared";

/** In-process bus so the hub, the alert engine and the REST layer stay decoupled. */
export interface BeaconEvents {
  sample: { deviceId: string; sample: MetricSample };
  alert: AlertDto;
  device_status: { deviceId: string; status: "online" | "offline"; lastSeenAt: number | null };
  agent_update: { deviceId: string; state: AgentUpdateStateDto };
}

/** Thin typed wrapper — composition avoids fighting EventEmitter's own overloads. */
class Bus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  emit<K extends keyof BeaconEvents>(event: K, payload: BeaconEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof BeaconEvents>(event: K, listener: (payload: BeaconEvents[K]) => void): () => void {
    const wrapped = (payload: unknown) => listener(payload as BeaconEvents[K]);
    this.emitter.on(event, wrapped);
    return () => {
      this.emitter.off(event, wrapped);
    };
  }
}

export const bus = new Bus();
