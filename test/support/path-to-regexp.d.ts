// Next ships path-to-regexp compiled without types; the header tests use it to match next.config sources.
declare module "next/dist/compiled/path-to-regexp" {
  export function match(source: string, o?: { decode?: (s: string) => string }): (path: string) => false | { params: Record<string, string> }
}
