import { EventEmitter } from "events";
import { parentPort, isMainThread } from "worker_threads";
import { RoomEvent, RoomEvents, SpaceEvent, SpaceEvents } from "./types";

if (!isMainThread) {
  //
  parentPort.setMaxListeners(100);
}

function noop() {}

export type Callback = (value: any) => void;

export type Listener = (
  message: any,
  resolve: Callback | null,
  reject: Callback | null
) => void;

export class Room {
  //
  static _nbLogs = 0;
  static log(...args: any[]) {
    //
    this._nbLogs++;
    if (this._nbLogs > 50) return;
    console.log(...args);
  }

  static {
    if (!isMainThread) {
      parentPort.on("message", (message: any) => {
        // const nbListeners = Room._emitter.listenerCount(message.type);
        // this.log("worker msg", message.type, nbListeners);

        //
        let resolve = null;
        let reject = null;

        if (message.msgId) {
          //
          resolve = (value: any) => {
            this.postMessage(message.msgId, { success: true, value });
          };

          reject = (error: any) => {
            this.postMessage(message.msgId, { success: false, error });
          };
        }

        Room._emitter.emit(message.type, message.message, resolve, reject);
      });

      // Handle uncaught errors in the worker
      process.on("uncaughtException", (error) => {
        console.error("Uncaught Exception in worker:", error);
        this.postMessage(SpaceEvents.ERROR, error);
      });

      // Handle unhandled promise rejections in the worker
      process.on("unhandledRejection", (reason, promise) => {
        console.error("Unhandled Rejection in worker:", reason);
        this.postMessage(SpaceEvents.ERROR, reason);
      });
    }
  }

  static _emitter = new EventEmitter();

  static on(type: RoomEvent, cb: Listener): () => void {
    //
    this._emitter.on(type, cb);

    return () => {
      this._emitter.off(type, cb);
    };
  }

  static once(type: RoomEvent, cb: Listener): () => void {
    //
    this._emitter.once(type, cb);

    return () => {
      this._emitter.off(type, cb);
    };
  }

  static postMessage(type: SpaceEvent, message: any) {
    parentPort.postMessage({ type, message });
  }

  static send(type: any, data: any, sessionId: string) {
    //
    Room.postMessage(SpaceEvents.SEND, { type, data, sessionId });
  }

  static broadcast(type: any, data: any, exclude?: string[]) {
    Room.postMessage(SpaceEvents.BROADCAST, { type, data, exclude });
  }
}
