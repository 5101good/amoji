declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "amoji-schema" {
  /** Amoji 0.1 `#/$defs/pack`, compiled at build time; `errors` follows Ajv. */
  export const validatePackSchema: ((value: unknown) => boolean) & {
    errors?: Array<{ instancePath: string; message?: string }> | null;
  };
}
declare module 'amoji-homepage' {
  const template: string;
  export default template;
}
