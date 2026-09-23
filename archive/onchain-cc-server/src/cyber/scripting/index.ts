import * as serverEnv from "../";

import * as ColyseusSchema from "@colyseus/schema";
import vm from "node:vm";
import path from "node:path";
import { ScriptData } from "./ScriptData";

const libsNS = {
  OO_SERVER: "@oo/server",
  COLYSEUS_SCHEMA: "@colyseus/schema",
};

export class ScriptFactory {
  //
  /**
   * Modules are scripts added by the game. We need to evaluate them before we
   * can get their exports
   */

  private imports: Record<string, any> = {};

  private scripts: Record<string, ScriptData> = {};

  init(gameData: any) {
    //
    const prelude = this.initPrelude();

    Object.assign(this.imports, prelude);

    let serverModule: ScriptData;

    Object.values(gameData.components).forEach((mod: any) => {
      //
      if (mod.type === "script") {
        //
        this.scripts[mod.uri] = mod;

        if (mod.name === "server") {
          //
          serverModule = mod;
        }
      }
    });

    if (serverModule == null) return null;

    let exports = this.runModule(serverModule);

    let klass = exports.default;

    const isServerClass = serverEnv.GameSession.prototype.isPrototypeOf(
      klass?.prototype
    );

    if (!isServerClass) {
      console.error(
        "Server module does not extend GameSession. Please extend GameSession"
      );
      return null;
    }

    return klass;
  }

  // private _stack: ScriptResource[] = [];

  private runModule(script: ScriptData) {
    //
    let exports = {} as any;

    this.imports[script.uri] = exports;

    const require = this.require;

    this.loadScript({
      content: script.emit.code,
      require,
      exports,
      uri: script.uri,
    });

    return exports;
  }

  loadScript(opts: {
    content: string;
    require: any;
    exports: any;
    uri: string;
  }) {
    // Wrap the script content in a function
    const wrappedScript = `(function(exports, require, module, __filename, __dirname) {
      ${opts.content}
    })`;

    // Compile the script
    const compiledScript = vm.runInThisContext(wrappedScript);

    const scriptPath = path.resolve(opts.uri);

    const dirname = path.dirname(scriptPath);

    // Create a new module and execute the compiled script
    const module = compiledScript.call(
      opts.exports,
      opts.exports,
      opts.require,
      { exports: opts.exports },
      scriptPath,
      dirname
    );

    // const fn = new Function("exports", "require", opts.content);

    // fn(opts.exports, opts.require);

    return opts.exports;
  }

  initPrelude() {
    //
    const prelude = {
      [libsNS.OO_SERVER]: serverEnv,
      [libsNS.COLYSEUS_SCHEMA]: ColyseusSchema,
    };

    return prelude;
  }

  require = (uri: string) => {
    //
    let imp = this.imports[uri];

    if (imp == null) {
      //
      let script = this.scripts[uri];

      if (script == null) {
        console.error(`Module ${uri} not found`);
        return {};
      }

      imp = this.runModule(script);
    }

    return imp;
  };

  private static _instance: ScriptFactory;

  static get instance() {
    //
    if (ScriptFactory._instance == null) {
      //
      ScriptFactory._instance = new ScriptFactory();
    }

    return ScriptFactory._instance;
  }
}
