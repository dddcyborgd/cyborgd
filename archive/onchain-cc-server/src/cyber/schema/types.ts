import {
  Schema,
  defineTypes,
  type,
  ArraySchema,
  MapSchema,
} from "@colyseus/schema";
import { createArray } from "./ArrayImpl";
import { createMap } from "./MapImpl";

interface XY {
  x: number;
  y: number;
}

interface XYZ {
  x: number;
  y: number;
  z: number;
}

type Construcor<T> = new () => T;
type SchemaCons = new () => Schema;
type ColyseusType =
  | "string"
  | "number"
  | "boolean"
  | SchemaCons
  | [ColyseusType]
  | { map: ColyseusType };

const IS_PARAM_VAL = Symbol("isParamVal");

function isParam(val: any): val is Param {
  return val && val[IS_PARAM_VAL];
}

function isEntityType(val: any) {
  return (
    typeof val === "function" && State.prototype.isPrototypeOf(val.prototype)
  );
}

interface ParamBase<T> {
  [IS_PARAM_VAL]: boolean;
  defaultValue: T;
}

interface StringParam extends ParamBase<string> {
  type: "string";
}

interface NumberParam extends ParamBase<number> {
  type: "number";
}

interface BooleanParam extends ParamBase<boolean> {
  type: "boolean";
}

interface XYParam extends ParamBase<XY> {
  type: "vec2";
}

interface XYZParam extends ParamBase<XYZ> {
  type: "vec3";
}

interface ObjectParam<T> extends ParamBase<T> {
  type: "group";
  schema: Record<string, Param>;
  entityType?: new () => T;
}

interface ArrayParam<T> extends ParamBase<Array<T>> {
  type: "array";
  itemType: T;
}

interface MapParam<T> extends ParamBase<Map<string, T>> {
  type: "map";
  itemType: T;
}

type Param =
  | StringParam
  | NumberParam
  | BooleanParam
  | XYParam
  | XYZParam
  | ObjectParam<any>
  | ArrayParam<any>
  | MapParam<any>;

export class P {
  //
  static String(val = ""): string {
    return {
      defaultValue: val,
      [IS_PARAM_VAL]: true,
      type: "string",
    } as unknown as string;
  }

  static Number(val = 0): number {
    return {
      defaultValue: val,
      [IS_PARAM_VAL]: true,
      type: "number",
    } as unknown as number;
  }

  static Boolean(val = false): boolean {
    return {
      defaultValue: val,
      [IS_PARAM_VAL]: true,
      type: "boolean",
    } as unknown as boolean;
  }

  static XY(x = 0, y = 0): Vec2 {
    return {
      [IS_PARAM_VAL]: true,
      type: "vec2",
      defaultValue: { x, y },
    } as any;
  }

  static XYZ(x = 0, y = 0, z = 0): Vec3 {
    return {
      [IS_PARAM_VAL]: true,
      type: "vec3",
      defaultValue: { x, y, z },
    } as any;
  }

  static Object<T>(schemaOrType: T | Construcor<T>): T {
    //
    let schema = null;
    let entityType = null;

    if (typeof schemaOrType === "function") {
      //
      if (!isEntityType(schemaOrType)) {
        throw new Error(schema.name + " is not an Entity");
      }

      entityType = schemaOrType;
    } else if (schemaOrType instanceof State) {
      //

      entityType = schemaOrType.constructor as any;
    } else {
      schema = schemaOrType;
    }

    return {
      [IS_PARAM_VAL]: true,
      type: "group",
      schema,
      entityType,
    } as unknown as T;
  }

  static Array<T>(itemType: T | Construcor<T>, init?: Array<T>): Array<T> {
    //
    if (typeof itemType === "function") {
      itemType = P.Object(itemType);
    }

    return {
      [IS_PARAM_VAL]: true,
      type: "array",
      itemType,
      defaultValue: init,
    } as unknown as any;
  }

  static Map<T>(
    itemType: T | Construcor<T>,
    init?: Record<string, T>
  ): Map<string, T> {
    //
    if (typeof itemType === "function") {
      itemType = P.Object(itemType);
    }

    return {
      [IS_PARAM_VAL]: true,
      type: "map",
      itemType,
      defaultValue: init,
    } as unknown as any;
  }
}

interface EntityInfo {
  cSchema: new () => Schema;
  params: Record<string, Param>;
}

const infoCache = new WeakMap<Function, EntityInfo>();

const parseCtx = new WeakMap();

const PARSE_OBJ = Symbol("@@cyber/parse");

function getParams(klass: Function) {
  //
  // console.log("getParams", klass.name);

  // start parsing
  const params: any = {};
  // console.log("set parseCtx", klass.name);
  let inst: any;
  try {
    parseCtx.set(klass, true);
    inst = new (klass as any)();
  } catch (e) {
    console.error(e);
    return null;
  } finally {
    // console.log("delete parseCtx", klass.name);
    parseCtx.delete(klass);
  }
  Object.keys(inst).forEach((field) => {
    //
    let val = inst[field];
    if (isEntityType(val) || val instanceof State) {
      val = P.Object(val);
    }
    if (!isParam(val)) return;
    params[field] = val;
  });
  // console.log("params", params);
  return params;
}

// let count = 0;

export class State {
  //
  $$cInst: Schema;

  private $$values: Record<string, any> = {};

  get $$einfo() {
    return infoCache.get(this.constructor);
  }

  constructor() {
    // if (count > 3) {
    //   console.log("Count exceeded");
    //   return;
    // }

    // count++;
    // is parsing
    if (parseCtx.has(this.constructor)) {
      // console.error("Already parsing", this.constructor.name);
      // @ts-ignore
      return;
    }

    let info = infoCache.get(this.constructor);

    // already parsed
    if (info == null) {
      //
      // console.log("Parsing", this.constructor.name);

      // Not parsed yet
      const params = getParams(this.constructor);

      if (!params) {
        throw new Error("Failed to get params");
      }

      info = {
        cSchema: null,
        params,
      };

      infoCache.set(this.constructor, info);

      // console.log("Creating schema", this.constructor.name);

      createSchema(info);
    }

    this.$$cInst = new info.cSchema();

    (this.$$cInst as any).$$entity = this;

    // console.log("Schema created", this.constructor.name);

    Object.keys(info.params).forEach((field) => {
      //
      const def = getDefValue(info.params[field]);

      this.$$values[field] = def;

      this.$$cInst[field] = def?.$$cInst ?? def;

      Object.defineProperty(this, field, {
        get() {
          return this.$$values[field];
        },
        set(value) {
          // skip class initializers
          if (isParam(value)) {
            //
            value = getDefValue(value);
          }

          if (this.$$values[field] === value) return;

          this.$$values[field] = value;
          this.$$cInst[field] = value?.$$cInst ?? value;
        },
      });
    });
  }

  assign(source: any): this {
    //
    Object.keys(this.$$einfo.params).forEach((field) => {
      //
      this[field] = source[field];
    });

    return this;
  }

  clone(): this {
    //
    const target = new (this.constructor as any)();

    target.assign(this);

    return target;
  }
}

function createSchema(info: EntityInfo) {
  //
  if (info.cSchema != null) return;

  let cSchema = class EntitySchema extends Schema {};

  info.cSchema = cSchema;

  Object.keys(info.params).forEach((field) => {
    //
    const param = info.params[field];
    if (!isParam(param)) return;
    const ctype = getColysuesType(param);
    // console.log("createSchema", field);
    type(ctype)(cSchema.prototype, field);
    // console.log("createSchema", field, "done");
  });
}

function getColysuesType(schema: Param) {
  //
  if (
    schema.type === "string" ||
    schema.type === "number" ||
    schema.type === "boolean"
  ) {
    //
    return schema.type;
    //
  } else if (schema.type === "vec2") {
    //
    const val = new Vec2();

    return val.$$einfo.cSchema;
    //
  } else if (schema.type === "vec3") {
    //
    const val = new Vec3();

    return val.$$einfo.cSchema;
    //
  } else if (schema.type === "group") {
    //
    if (schema.entityType) {
      //
      const objClass = schema.entityType as any;

      let info = infoCache.get(objClass);

      if (info == null) {
        //
        let val = new objClass();

        info = infoCache.get(objClass);
      }

      return info.cSchema;
      //
    } else {
      //
      const entityType = class ObjEntity extends State {};

      const info: EntityInfo = {
        cSchema: null,
        params: schema.schema as any,
      };

      infoCache.set(entityType, info);

      createSchema(info);

      schema.entityType = entityType;

      return info.cSchema;
    }
    //
  } else if (schema.type === "array") {
    //
    const ctype = getColysuesType(schema.itemType);

    return [ctype];
    //
  } else if (schema.type === "map") {
    //
    const ctype = getColysuesType(schema.itemType);

    return {
      map: ctype,
    };
    //
  } else {
    throw new Error("Invalid schema type");
  }
}

function getDefValue(schema: Param) {
  //

  if (
    schema.type === "string" ||
    schema.type === "number" ||
    schema.type === "boolean"
  ) {
    //
    return schema.defaultValue;
    //
  } else if (schema.type === "vec2") {
    //
    return new Vec2();
    //
  } else if (schema.type === "vec3") {
    //
    return new Vec3();
    //
  } else if (schema.type === "group") {
    //
    if (!schema.entityType) {
      //
      throw new Error("group not parsed");
    }

    return new (schema.entityType as any)();

    //
  } else if (schema.type === "array") {
    //
    return createArray(schema.defaultValue);
    //
  } else if (schema.type === "map") {
    //
    return createMap(schema.itemType.entityType ?? null);
    //
  } else {
    throw new Error("Invalid schema type");
  }
}

export class Vec2 extends State {
  x = P.Number(0);
  y = P.Number(0);

  copy(val: XY) {
    this.x = val.x;
    this.y = val.y;
  }
}

export class Vec3 extends State {
  x = P.Number(0);
  y = P.Number(0);
  z = P.Number(0);

  copy(val: XYZ) {
    this.x = val.x;
    this.y = val.y;
    this.z = val.z;
  }
}

export function cinst(val: any) {
  return val?.$$cInst ?? val;
}

export function centity(val: any) {
  return val?.$$values ?? val;
}
