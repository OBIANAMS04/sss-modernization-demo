// STORY-003: qrcode ships no type declarations and @types/qrcode is not installed; only toDataURL is used.
declare module 'qrcode' {
  interface QrOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    /** Width of the empty border, in modules. */
    margin?: number;
    /** Width of the image in pixels. */
    width?: number;
  }

  /** A PNG as a data: URL, ready for an <img src>. */
  export function toDataURL(text: string, options?: QrOptions): Promise<string>;
}
