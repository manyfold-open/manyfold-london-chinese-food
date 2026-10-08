// Tests run in Node but are type-checked with the Workers types, whose ImportMeta has no url.
interface ImportMeta {
  readonly url: string;
}
