import assert from "assert";
import { defineTypes, MapSchema, type } from "@colyseus/schema";
import { ExtensibleSchema } from "../src/cyber/schema/RoomState";
import { debug } from "../src/cyber/schema/register";

let MyState: typeof ExtensibleSchema;

describe("RegisterEntity", () => {
  beforeEach(() => {
    MyState = class MyState extends ExtensibleSchema {};
  });

  it("should extend schema with a number prop", () => {
    //
    MyState.$$registerEntity("Entity", 3);
    const state = new MyState();
    assert.deepEqual(state.$$registeredEntities, ["Entity"]);

    state.$$setEntityData("Entity", "e1", 10);
    assert.equal(state.$$getEntity("Entity", "e1"), 10);
  });

  it("should extend schema with a string prop", () => {
    //
    MyState.$$registerEntity("Entity", "");
    const state = new MyState();
    state.$$setEntityData("Entity", "e1", "hello");
    assert.equal(state.$$getEntity("Entity", "e1"), "hello");
  });

  it("should extend schema with a boolean prop", () => {
    //
    MyState.$$registerEntity("Entity", false);
    const state = new MyState();
    state.$$setEntityData("Entity", "e1", true);
    assert.equal(state.$$getEntity("Entity", "e1"), true);
  });

  it("should extend schema with a string prop", () => {
    //
    MyState.$$registerEntity("Entity", "");
    const state = new MyState();
    state.$$setEntityData("Entity", "e1", "hello");
    assert.equal(state.$$getEntity("Entity", "e1"), "hello");
  });

  it("should extend schema with an object prop", () => {
    //
    MyState.$$registerEntity("Entity", {
      type: "object",
      schema: {
        name: "",
        score: { type: "object", schema: { val: 0 } },
      },
    });

    const state = new MyState();
    const json = { name: "sossou", score: { val: 10 } };
    state.$$setEntityData("Entity", "e1", json);
    assert.deepEqual(state.$$getEntity("Entity", "e1"), {
      name: "sossou",
      score: { val: 10 },
    });
  });

  it("should extend schema with an map (dictionary) prop", () => {
    //
    MyState.$$registerEntity("Entity", {
      type: "map",
      schema: 0,
    });

    const state = new MyState();
    state.$$setEntityData("Entity", "e1", { k1: 10, k2: 20 });
    assert.deepEqual(state.$$getEntity("Entity", "e1"), { k1: 10, k2: 20 });
  });

  it("should extend schema with an array prop", () => {
    //
    MyState.$$registerEntity("Entity", {
      type: "array",
      schema: 0,
    });

    const state = new MyState();
    let json = [10, 20];
    state.$$setEntityData("Entity", "e1", json);
    assert.deepEqual(state.$$getEntity("Entity", "e1"), json);

    json = json.concat([30, 40]);
    state.$$setEntityData("Entity", "e1", json);
    assert.deepEqual(state.$$getEntity("Entity", "e1"), json);
  });

  it("should extend schema with a complex prop", () => {
    //
    MyState.$$registerEntity("Entity", {
      type: "object",
      schema: {
        num: 0,
        scores: {
          type: "map",
          schema: { type: "object", schema: { name: "", val: 0 } },
        },
      },
    });

    const state = new MyState();

    const json = {
      num: 10,
      scores: {
        p1: { name: "luffy", val: 100 },
        p2: { name: "kaidu", val: 200 },
      },
    };
    //debug.enabled = true;
    state.$$setEntityData("Entity", "e1", json);
    const stored = state.$$getEntity("Entity", "e1");
    assert.deepEqual(stored, json);
  });
});
