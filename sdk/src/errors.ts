// Custom error codes start at 6000 and follow the order of ChainwritError in
// programs/chainwrit/src/lib.rs. Keep the two in sync.
export const PROGRAM_ERRORS = [
  ["MerchantNotAllowed", "Merchant is not on this mandate's allowlist"],
  ["ExceedsPerPaymentLimit", "Payment is larger than the mandate's per-payment cap"],
  ["ExceedsDailyLimit", "Payment would exceed the mandate's rolling 24-hour cap"],
  ["MandateExpired", "The mandate has expired"],
  ["MandateRevoked", "The mandate has been revoked by its owner"],
  ["NotMandateAgent", "Signer is not the agent named in this mandate"],
  ["NotMandateOwner", "Signer is not the owner of this mandate"],
  ["WrongMint", "Token mint does not match the mandate"],
  ["WrongVault", "Vault does not match the mandate"],
  ["ZeroAmount", "Amount must be greater than zero"],
  ["InvalidLimit", "Limits must be positive and the daily cap at least the per-payment cap"],
  ["EmptyMerchantList", "A mandate must allow at least one merchant"],
  ["TooManyMerchants", "Too many merchants for one mandate"],
  ["ExpiryInPast", "Expiry must be in the future"],
  ["TaskIdTooLong", "Task id is too long"],
  ["InsufficientVaultBalance", "The vault does not hold enough tokens"],
  ["MathOverflow", "Arithmetic overflow"],
] as const;

export type ProgramErrorName = (typeof PROGRAM_ERRORS)[number][0];

export interface DecodedError {
  code: number | null;
  name: string;
  message: string;
}

export function errorFromCode(code: number): DecodedError {
  const entry = PROGRAM_ERRORS[code - 6000];
  if (entry) return { code, name: entry[0], message: entry[1] };
  return { code, name: "Unknown", message: `Program returned custom error ${code}` };
}

/**
 * Pull a program error out of whatever shape it arrives in: an AnchorError
 * from simulation, a SendTransactionError with logs, or the raw `meta.err`
 * of a confirmed-but-failed transaction.
 */
export function decodeError(err: unknown): DecodedError {
  const e = err as any;

  const anchorCode = e?.error?.errorCode?.number;
  if (typeof anchorCode === "number") return errorFromCode(anchorCode);

  const custom = e?.InstructionError?.[1]?.Custom ?? e?.err?.InstructionError?.[1]?.Custom;
  if (typeof custom === "number") return errorFromCode(custom);

  const text = [e?.message, ...(e?.logs ?? e?.transactionLogs ?? [])].join("\n");
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) return errorFromCode(parseInt(hex[1], 16));
  const named = text.match(/Error Number: (\d+)/);
  if (named) return errorFromCode(Number(named[1]));

  return { code: null, name: "Unknown", message: e?.message ?? String(err) };
}
