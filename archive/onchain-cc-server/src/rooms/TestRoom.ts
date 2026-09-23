import { Client, ClientArray, Room } from "colyseus";
import { State, P } from "../cyber/schema/types";
import { RoomState } from "../cyber/schema/RoomState";

class Player extends State {
  sessionId = P.String("");
  uid = P.String("");
  name = P.String("");
  position = P.XYZ(0, 0);

  update() {
    //
    this.position.x = Math.random() * 100;
  }
}

class MyState extends RoomState {
  pos = P.XYZ();
}

// console.log("State", State.$$impl);

export class TestRoom extends Room {
  //
  _state: MyState;

  onCreate(options: any): void | Promise<any> {
    console.log("TestRoom created!", options);
    this._state = new MyState();
    this.setState(this._state.$$cInst);

    this.setSimulationInterval(() => {
      // this._state.update();
    }, 1000);
  }

  autoInc = 0;

  onJoin(client: Client, options?: any, auth?: any) {
    //
    console.log("client joined!", client.sessionId);

    this._state.addPlayer({ sessionId: client.sessionId });
  }

  onLeave(client: Client, consented: boolean) {
    console.log("client left!", client.sessionId);
    this._state.removePlayer(client.sessionId);
  }
}
