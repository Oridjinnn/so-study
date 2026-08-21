// Minimal module declarations for pdfmake's UMD build, which ships no types.
// Only the surface we use is described.
declare module "pdfmake/build/pdfmake" {
  interface PdfmakeInstance {
    vfs: Record<string, string>;
    createPdf: (docDefinition: unknown) => {
      getBuffer: (cb: (buffer: Buffer) => void, options?: unknown) => void;
    };
  }
  const pdfMake: PdfmakeInstance;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}
