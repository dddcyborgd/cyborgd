import config from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
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
    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    initializeExpress(app);
  },

  beforeListen: () => {
    /**
     * Before before gameServer.listen() is called.
     */
  },
});
