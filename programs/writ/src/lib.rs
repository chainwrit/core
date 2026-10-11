//! Writ — on-chain spending mandates for autonomous AI agents.
//!
//! An AI agent that can pay for things is only as trustworthy as the content it
//! reads. A prompt injection hidden in a web page can tell an agent to send
//! money to an attacker, and on-chain payments are final.
//!
//! Writ moves the spending rules off the agent and onto the chain. The human
//! signs a mandate: which merchants may be paid, how much per payment, how much
//! per day, and until when. Funds live in a vault owned by a program-derived
//! address with no private key. The agent can only *request* a payment; the
//! program decides whether it happens.
//!
//! The guarantee: even if the agent is manipulated, its host server is
//! compromised and its signing key is stolen, an attacker cannot move funds
//! outside the mandate.

use anchor_lang::prelude::*;

// Placeholder program id. `anchor keys sync` replaces this with the keypair in
// target/deploy once you build locally.
declare_id!("6cc4F1dBC34KwyJFphJqAJfuSudNhUA6W2UNozUsVqrT");

/// Maximum number of merchant addresses a single mandate may allow.
pub const MAX_MERCHANTS: usize = 10;

/// Maximum length, in bytes, of the task tag attached to a payment.
pub const MAX_TASK_ID_LEN: usize = 32;

/// Length of the rolling spend window, in seconds.
pub const WINDOW_SECONDS: i64 = 86_400;

#[program]
pub mod writ {
    use super::*;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// A human's signed statement of what one agent may spend.
#[account]
pub struct Mandate {
    /// The human who created the mandate and owns the funds.
    pub owner: Pubkey,
    /// The agent's signing key. Only this key may request payments.
    pub agent: Pubkey,
    /// The token the mandate is denominated in (USDC in practice).
    pub mint: Pubkey,
    /// The vault token account holding the funds.
    pub vault: Pubkey,
    /// Ceiling on any single payment.
    pub max_per_payment: u64,
    /// Ceiling on total spend inside a rolling 24-hour window.
    pub daily_limit: u64,
    /// Spend so far inside the current window.
    pub spent_in_window: u64,
    /// When the current window opened.
    pub window_start: i64,
    /// After this timestamp the mandate pays nothing.
    pub expires_at: i64,
    /// Set by the owner to stop all payments immediately.
    pub revoked: bool,
    /// Lifetime spend, for reporting.
    pub total_spent: u64,
    /// Lifetime payment count, for reporting.
    pub payment_count: u64,
    /// Addresses this agent is allowed to pay.
    pub merchants: Vec<Pubkey>,
    pub bump: u8,
}

impl Mandate {
    pub const SPACE: usize = 8   // discriminator
        + 32  // owner
        + 32  // agent
        + 32  // mint
        + 32  // vault
        + 8   // max_per_payment
        + 8   // daily_limit
        + 8   // spent_in_window
        + 8   // window_start
        + 8   // expires_at
        + 1   // revoked
        + 8   // total_spent
        + 8   // payment_count
        + 4 + (32 * MAX_MERCHANTS) // merchants
        + 1; // bump
}
