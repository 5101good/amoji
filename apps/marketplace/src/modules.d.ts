declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "amoji-schema" {
  export function validate01(value: unknown): boolean;
  export function validate02(value: unknown): boolean;
}
