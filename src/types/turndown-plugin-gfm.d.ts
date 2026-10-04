// turndown-plugin-gfm ships no types. Same situation as markdown-it-task-lists
// (see shims.d.ts): a minimal declaration for the one entry point we use.
declare module "turndown-plugin-gfm" {
  export const gfm: (service: unknown) => void;
  export const tables: (service: unknown) => void;
  export const strikethrough: (service: unknown) => void;
  export const taskListItems: (service: unknown) => void;
}
