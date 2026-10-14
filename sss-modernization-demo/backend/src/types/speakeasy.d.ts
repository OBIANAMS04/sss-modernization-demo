// STORY-003: speakeasy ships no type declarations and @types/speakeasy is not installed, so this declares
// only the part mfaService uses (RFC 6238 time-based codes) rather than adding a dependency for types.
declare module 'speakeasy' {
  interface TotpVerifyOptions {
    secret: string;
    encoding: 'base32';
    token: string;
    /** Whole steps accepted either side of the current one. */
    window: number;
    /** Seconds per step. */
    step: number;
    /** Seconds since the epoch to check against; now if left out. */
    time: number;
  }

  interface TotpFunction {
    /** The step offset (negative: earlier) at which the token is valid, or undefined if it is not valid inside the window. */
    verifyDelta(options: TotpVerifyOptions): { delta: number } | undefined;
  }

  export const totp: TotpFunction;
}
