declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
}

declare module "word-extractor" {
  interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(opts?: { includeFooters?: boolean }): string;
  }
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>;
  }
}
