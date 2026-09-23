import {
  Schema,
  type,
  MapSchema,
  DefinitionType,
  PrimitiveType,
  ArraySchema,
} from "@colyseus/schema";

export type EntityState =
  | number
  | string
  | boolean
  | { type: "map"; schema: EntityState }
  | { type: "object"; schema: Record<string, EntityState> }
  | { type: "array"; schema: EntityState };

interface EntityInfo {
  type: DefinitionType;
  create: () => any;
  assign: (current: any, val: any) => any;
}

export class ExtSchema extends Schema {
  //
  static $$entities: Record<string, EntityInfo>;

  constructor() {
    //
    super();

    const entities = this.$getEntities();

    Object.keys(entities).forEach((key) => {
      //
      this[key] = new ExtMapSchema(entities[key]);
    });
  }

  $getEntities() {
    return (this.constructor as typeof ExtSchema).$$entities;
  }

  $setEntityData(key: string, id: string, value: any) {
    //
    const map = this[key] as ExtMapSchema;
    map.$set(id, value);
  }

  $getEntityData(key: string, id: string) {
    //
    const map = this[key] as MapSchema;
    const val = map.get(id);
    if (val != null && val.toJSON != null) {
      return val.toJSON();
    }
    return val;
  }
}

export class ExtMapSchema extends MapSchema {
  //
  private $$cache: Record<string, any> = {};

  constructor(public $$info: EntityInfo) {
    super();
  }

  $set(id: string, data: any) {
    //
    if (this.$$cache[id] === data) {
      return;
    }

    this.$$cache[id] = data;

    let current = this.get(id);

    if (current == null) {
      this.set(id, createValue(data, this.$$info));
    } else {
      let newVal = this.$$info.assign(current, data);
      if (newVal !== current) {
        this.set(id, newVal);
      }
    }
  }

  $assign(val: Record<string, any>) {
    //
    if (val !== this.$$cache) {
      Object.keys(val).forEach((id) => {
        this.$set(id, val[id]);
      });
      this.forEach((_, id) => {
        if (val[id] == null) {
          this.delete(id);
        }
      });
      this.$$cache = val;
    }
    return this;
  }
}

export class ExtArraySchema extends ArraySchema {
  //
  private $$cache: any[] = [];

  constructor(public $$info: EntityInfo) {
    super();
  }

  $set(index: number, data: any) {
    //
    if (this.$$cache[index] === data) return;

    this.$$cache[index] = data;
    let current = this.at(index);
    if (current == null) {
      this.setAt(index, createValue(data, this.$$info));
    } else {
      let newVal = this.$$info.assign(current, data);
      if (newVal !== current) {
        this.setAt(index, newVal);
      }
    }
  }

  $assign(values: any[]) {
    //
    if (values === this.$$cache) return this;

    const minLen = Math.min(this.length, values.length);

    for (let i = 0; i < minLen; i++) {
      const current = this.at(i);
      const dataVal = values[i];
      if (dataVal == this.$$cache[i]) continue;
      const newVal = this.$$info.assign(current, values[i]);
      if (newVal !== current) {
        this.setAt(i, newVal);
      }
    }

    if (this.length > values.length) {
      this.length = values.length;
    }

    for (let i = minLen; i < values.length; i++) {
      let newVal = createValue(values[i], this.$$info);
      this.push(newVal);
    }

    this.$$cache = values;
    return this;
  }
}

export let debug = {
  enabled: false,
};

function log(...args: any[]) {
  //
  if (debug.enabled) {
    console.log(...args);
  }
}

function createValue(value: any, info: EntityInfo) {
  //
  let current = info.create();
  let newVal = info.assign(current, value);
  return newVal;
}

export function register(
  entitiesSchema: typeof ExtSchema,
  entityType: string,
  entityState: EntityState
) {
  //
  const info = getColysuesType(entityState);

  entitiesSchema["$$entities"] = entitiesSchema["$$entities"] || {};

  type({ map: info.type as PrimitiveType })(
    entitiesSchema.prototype,
    entityType
  );

  (entitiesSchema as typeof ExtSchema).$$entities[entityType] = info;
}

function createObjectSchema(state: Record<string, EntityState>): EntityInfo {
  //
  const keys = Object.keys(state);
  const entities: Record<string, EntityInfo> = {};

  let schema = class EntitySchema extends Schema {
    //
    _netVersion: number;

    private $$cache: Record<string, any> = {};

    constructor() {
      super();
      for (let i = 0; i < keys.length; i++) {
        const field = keys[i];
        this[field] = entities[field].create();
      }

      this._netVersion = 0;
    }

    $set(key: string, value: any) {
      if (this.$$cache[key] === value) {
        return;
      }
      this.$$cache[key] = value;
      let current = this[key];
      let newVal = entities[key].assign(current, value);
      if (newVal !== current) {
        this[key] = newVal;
      }
    }

    $assign(data: Record<string, any>) {
      //
      if (data !== this.$$cache) {
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          this.$set(key, data[key]);
        }
        if (data._netVersion != null) {
          this._netVersion = data._netVersion;
        }

        this.$$cache = data;
      }
      return this;
    }
  };

  type("number")(schema.prototype, "_netVersion");

  Object.keys(state).forEach((field) => {
    //
    const val = state[field];
    const info = getColysuesType(val);
    entities[field] = info;
    type(info.type)(schema.prototype, field);
  });

  return {
    type: schema,
    create: () => new schema(),
    assign: (self, val) => self.$assign(val),
  };
}

function getColysuesType(val: EntityState): EntityInfo {
  //
  if (isPrim(val)) {
    //
    return {
      type: typeof val as PrimitiveType,
      create: () => val,
      assign: (_, val) => val,
    };
  }
  if (val.type === "object") {
    //
    return createObjectSchema(val.schema);
  }

  if (val.type === "map") {
    //
    const info = getColysuesType(val.schema);

    if (!isPrimColyseus(info.type)) {
      //
      throw new Error("Invalid map item type " + info.type);
    }

    return {
      type: { map: info.type },
      create: () => new ExtMapSchema(info),
      assign: (self, val) => self.$assign(val),
    };
  }

  if (val.type === "array") {
    //
    const info = getColysuesType(val.schema);

    if (!isPrimColyseus(info.type)) {
      //
      throw new Error("Invalid array item type " + info.type);
    }

    return {
      type: [info.type],
      create: () => new ExtArraySchema(info),
      assign: (self, val) => self.$assign(val),
    };
  }

  throw new Error("Invalid type");
}

function isPrim(val: EntityState) {
  //
  return (
    typeof val === "number" ||
    typeof val === "string" ||
    typeof val === "boolean"
  );
}

function isPrimColyseus(type: DefinitionType): type is PrimitiveType {
  //
  return typeof type === "string" || typeof type === "function";
}
