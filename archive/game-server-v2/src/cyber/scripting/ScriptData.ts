export interface ScriptEmit {
  /**
   * Scipt compiled code
   */
  code?: string;

  /**
   * Script dts file
   */
  dts?: string;

  /**
   * Minified code, this is set when publishing
   */
  minified?: string;
}

export interface ScriptData {
  /**
   * Component type
   */
  type: "script";

  /**
   * if not provided, an auto id will be generated
   */
  id: string;

  /**
   * name for the component. Defaults to ""
   */
  name: string;

  /**
   * flag for external scripts (eg npm packages, etc.)
   */
  external?: boolean;

  /**
   * Script source type
   */
  source?: "npm" | null;

  /**
   * Script source code (uncompiled)
   */
  code: string;

  uri?: string;

  emit?: ScriptEmit;
}
