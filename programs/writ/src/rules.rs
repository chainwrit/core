//! The policy engine.
//!
//! Every spending rule lives here as pure logic with no Solana account
//! plumbing, so it can be read, reasoned about and unit-tested on its own. The
//! `pay` instruction is a thin wrapper: it loads state, calls [`evaluate`], and
//! moves tokens only if the answer is `Ok`.
//!
//! Keeping the rules pure is deliberate. The security claim of this program is
//! that a payment outside the mandate is impossible, and that claim is only as
//! good as the tests behind these functions.

use anchor_lang::prelude::*;

use crate::{WritError, MAX_TASK_ID_LEN, WINDOW_SECONDS};

/// The mutable spend state of a mandate, as stored on-chain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpendState {
    pub revoked: bool,
    pub expires_at: i64,
    pub max_per_payment: u64,
    pub daily_limit: u64,
    pub spent_in_window: u64,
    pub window_start: i64,
}

/// What the agent is asking to do.
#[derive(Clone, Copy, Debug)]
pub struct PaymentRequest<'a> {
    pub amount: u64,
    pub merchant: Pubkey,
    pub task_id: &'a str,
}

/// The new spend state to commit when a payment is allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Approval {
    pub window_start: i64,
    pub spent_in_window: u64,
}

/// Decide whether a payment is allowed under the mandate.
///
/// Returns the state to commit on approval, or the specific rule that rejected
/// it. This function never mutates anything: a rejected payment leaves the
/// mandate exactly as it was.
pub fn evaluate(
    state: SpendState,
    merchants: &[Pubkey],
    request: PaymentRequest<'_>,
    now: i64,
) -> std::result::Result<Approval, WritError> {
    if request.amount == 0 {
        return Err(WritError::ZeroAmount);
    }
    if request.task_id.len() > MAX_TASK_ID_LEN {
        return Err(WritError::TaskIdTooLong);
    }
    if state.revoked {
        return Err(WritError::MandateRevoked);
    }
    if now >= state.expires_at {
        return Err(WritError::MandateExpired);
    }
    if request.amount > state.max_per_payment {
        return Err(WritError::ExceedsPerPaymentLimit);
    }
    if !merchants.contains(&request.merchant) {
        return Err(WritError::MerchantNotAllowed);
    }

    // Roll the window forward if the previous one has fully elapsed. Spend
    // inside an open window accumulates; a new window starts from zero.
    let (window_start, spent_so_far) = if now.saturating_sub(state.window_start) >= WINDOW_SECONDS {
        (now, 0u64)
    } else {
        (state.window_start, state.spent_in_window)
    };

    let spent_after = spent_so_far
        .checked_add(request.amount)
        .ok_or(WritError::MathOverflow)?;

    if spent_after > state.daily_limit {
        return Err(WritError::ExceedsDailyLimit);
    }

    Ok(Approval {
        window_start,
        spent_in_window: spent_after,
    })
}
