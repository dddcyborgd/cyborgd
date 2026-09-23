import { ArraySchema } from "@colyseus/schema";
import { cinst, centity } from "./types";

class ArrayImpl<T> {
  //
  $$cInst: ArraySchema<T>;

  constructor(public $$values: T[] = []) {
    //
    this.$$cInst = new ArraySchema<T>(...$$values.map(cinst));
  }

  push = (...values: T[]) => {
    this.$$cInst.push(...values.map(cinst));
    return this.$$values.push(...values);
  };

  pop = () => {
    this.$$cInst.pop();
    return this.$$values.pop();
  };

  shift = () => {
    this.$$cInst.shift();
    return this.$$values.shift();
  };

  unshift = (...items: T[]) => {
    this.$$cInst.unshift(...items.map(cinst));
    return this.$$values.unshift(...items);
  };

  splice = (start: any, deleteCount?: any, ...rest: any[]): T[] => {
    this.$$cInst.splice(start, deleteCount, ...rest.map(cinst));
    return this.$$values.splice(start, deleteCount, ...rest);
  };

  fill = (value: T, start?: number, end?: number) => {
    this.$$cInst.fill(cinst(value), start, end);
    return this.$$values.fill(value, start, end);
  };

  reverse = () => {
    this.$$cInst.reverse();
    this.$$values.reverse();
    return this as any;
  };

  sort = (compareFn?: (a: T, b: T) => number) => {
    this.$$cInst.sort((a, b) => compareFn(centity(a), centity(b)));
    this.$$values.sort(compareFn);
    return this;
  };
}

export function createArray(values: any[]) {
  //
  const arr = new ArrayImpl(values);

  return new Proxy(arr.$$values, {
    //
    get(target: any, prop: any) {
      //
      if (
        prop == "length" ||
        (typeof prop === "string" && !isNaN(prop as any))
      ) {
        return arr.$$values[prop];
      }

      // if the method us overridden in arr, call it otherwise default to target.$$values
      return arr[prop] ?? arr.$$values[prop];
    },
    set(target: any, prop: any, value: any) {
      //
      arr.$$values[prop] = value;

      if (
        prop == "length" ||
        (typeof prop === "string" && !isNaN(prop as any))
      ) {
        arr.$$cInst[prop] = cinst(value);
        return true;
      }

      return true;
    },
  });
}
