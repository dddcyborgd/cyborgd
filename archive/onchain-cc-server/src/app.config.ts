import config from "@colyseus/tools";
import { rooms } from "./rooms";
import { initializeExpress } from "./express";

export default config({
  initializeGameServer: (gameServer) => {
    /**
     * Define your room handlers:
     */
    Object.keys(rooms).forEach((key) => {
      gameServer.define(key, rooms[key]);
    });
  },

  initializeExpress: (app) => {
    //
    initializeExpress(app);
  },

  beforeListen: () => {
    /**
     * Before before gameServer.listen() is called.
     */
  },
});
