import { Response, Request } from "express";
import * as colyseus from "colyseus";
import { matchMaker } from "colyseus";
import cors from "cors";
import { playground } from "@colyseus/playground";
import { monitor } from "@colyseus/monitor";
import basicAuth from "express-basic-auth";
import { Mutex } from "async-mutex";
import { GameApi } from "../cyber/abstract/GameApi";

const mutex = new Mutex();

export function initializeExpress(app: any) {
  //
  app.use(cors());

  if (process.env.NODE_ENV !== "production") {
    app.use("/", playground);
  }

  app.get("/", (req: Request, res: Response) => {
    res.send("Hello world from cyber!!");
  });

  app.get("/getRoom", async (req: Request, res: Response) => {
    try {
      const data = await colyseus.matchMaker.query({
        roomId: req.query.roomId as string,
      });

      res.json({ success: true, room: data[0] });
    } catch (err) {
      res.json({
        success: false,
      });
    }
  });

  app.get("/getRooms", async (req: Request, res: Response) => {
    try {
      const data = await colyseus.matchMaker.query();

      data.sort((a, b) => {
        return b.clients - a.clients;
      });

      res.json({ success: true, rooms: data });
    } catch (err) {
      res.json({
        success: false,
      });
    }
  });

  app.post("/join", async (req: Request, res: Response) => {
    try {
      await mutex.runExclusive(async () => {
        //
        let { type } = req.query;

        if (!type) type = "cyber-game";

        try {
          const rooms = await matchMaker.query({
            name: type as string,
          });

          if (!req.body?.gameId) {
            //
            return res.status(400).json({
              success: false,
              message: "Invalid request",
            });
          }

          const [room] = rooms
            .filter(
              (room) =>
                !room.private &&
                !room.locked &&
                room.metadata.gameId === req.body.gameId &&
                room.clients < room.maxClients
            )
            .sort((a, b) => b.clients - a.clients);

          let reservation = null;

          if (room) {
            console.log("/join existing", {
              gameId: req.body.gameId,
              userId: req.body.userId,
              username: req.body.username,
              roomType: type as string,
            });

            reservation = await matchMaker.joinById(room.roomId, req.body, {});
            //
          } else {
            const roomOpts = {
              gameId: req.body.gameId,
              userId: req.body.userId,
              username: req.body.username,
              roomType: type as string,
              gameData: null,
            };

            console.log("/join new", roomOpts);

            const gameData = await GameApi.loadGameData({
              id: req.body.gameId,
              draft: true,
            });

            roomOpts.gameData = gameData;

            reservation = await matchMaker.create(type as string, roomOpts, {});
          }

          res.json({
            success: true,
            reservation,
          });
        } catch (err) {
          //
          console.log("errr", err, type, req.body);

          res.status(500).json({
            success: false,
            message: "Unexpected Server error while joining room",
          });
        }
      });
    } catch (err) {
      console.log("err", err);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  });

  const basicAuthMiddleware = basicAuth({
    users: {
      admin: process.env.MONITOR_PASSWORD,
    },
    challenge: true,
  });

  app.use(
    "/monitor",
    basicAuthMiddleware,
    monitor({
      columns: [
        "roomId",
        "name",
        "clients",
        "maxClients",
        { metadata: "gameId" },
        { metadata: "name" },
        "locked",
        "elapsedTime",
      ],
    })
  );
}
